/**
 * A connection's link to its server (`[PROTOCOL Opening a connection]`,
 * `[CLIENT Connecting]`), as turborel-client's `connection.rs`, `frames.rs`
 * and `told.rs` keep one: Hello sent, each Challenge answered until Ready,
 * the capabilities granted and the session's settings kept, then requests
 * sent and replies read one at a time, each Notice and Status before a
 * reply taken on the way, each statement's end noted. A connection failure
 * loses it: it takes no more. `connection.ts` runs statements over it.
 *
 * @packageDocumentation
 */

import * as cap from './capabilities.js';
import { capabilitiesOf, endsConnection } from './requests.js';
import type { Offer } from './told.js';
import { type Notice, Told } from './told.js';
import { compressFrames, received } from '../codec/compress.js';
import { HEADER_BYTES, MAX_BODY, decodeHeader } from '../codec/frame.js';
import { type Reply, completedHead, decodeReply, endsRequest } from '../codec/replies.js';
import { type Request, encodeRequest } from '../codec/requests.js';
import { TurborelError, apiMisuse, connectionFailure } from '../error.js';
import type { Mechanism } from '../auth/mechanism.js';
import type { FrameStream } from '../transport/frames.js';
import type { Target } from '../transport/target.js';

export { capabilitiesOf, endsConnection } from './requests.js';

/** The protocol's version, Hello's first field. */
export const VERSION = 1;

/** How long a connection waits to connect, begin TLS and for each step of its login, unless told: 30 seconds. */
export const CONNECT_WITHIN = 30_000;

/** How long Terminate waits for the server to close, if the read timeout sets no limit: 60 seconds. */
export const TERMINATE_WITHIN = 60_000;

/** The SQLSTATE class of a warning. */
const WARNING_CLASS = '01';

/** How long a connection waits on its server, in milliseconds; undefined for no limit. */
export interface Timeouts {
  /** To connect, begin TLS and for each step of the login: 30 seconds by default. */
  readonly connect: number | undefined;
  /** For each read or write after: no limit by default, as a statement may run as long as it must. */
  readonly read: number | undefined;
}

/** The timeouts a connection waits by unless told. */
export const DEFAULT_TIMEOUTS: Timeouts = { connect: CONNECT_WITHIN, read: undefined };

/** How a connection is opened beyond its stream, user and mechanism. */
export interface OpenOptions {
  /** What it asks for; every capability but compression by default. */
  readonly offer?: Offer;
  /** How long it waits; 30 seconds each step to log in, then no limit, by default. */
  readonly timeouts?: Timeouts;
  /** Where its server is, so it can be reached again to cancel. */
  readonly target?: Target;
  /** Whether its reads and writes after the login are bounded by its read timeout; a named pipe's are not. */
  readonly boundedReads?: boolean;
}

/** The requests a client sends while a copy is under way, until its CopyEnd. */
const DURING_COPY: ReadonlySet<Request['kind']> = new Set(['copyData', 'copyColumns', 'copyEnd', 'ping']);

/** A session of a server's, over one connection: its frames, its login and what the server told. */
export class Link {
  readonly #stream: FrameStream;
  /** What the server told, and what each request carries. */
  protected readonly told = new Told();
  readonly #target: Target | undefined;
  readonly #boundedReads: boolean;
  #timeouts: Timeouts;
  #maxBody = MAX_BODY;
  #authorization = '';
  #server = '';
  #key: Uint8Array | undefined;
  #compressFrom: number | undefined;
  #lost: TurborelError | undefined;
  #active = false;
  #copying = false;
  #warning: string | undefined;
  #loggingIn = true;

  /**
   * A connection over `stream`, not yet logged in.
   *
   * @param stream - its frames
   * @param options - its timeouts, target and whether its reads are bounded
   */
  protected constructor(stream: FrameStream, options: OpenOptions) {
    this.#stream = stream;
    this.#timeouts = options.timeouts ?? DEFAULT_TIMEOUTS;
    this.#target = options.target;
    this.#boundedReads = options.boundedReads ?? true;
  }

  /**
   * Logs in over its stream as `user`, proved by `mechanism`, the stream destroyed if it fails.
   *
   * @param user - the user, read by the server as an identifier
   * @param mechanism - what proves the user
   * @param offer - what it asks for
   * @throws {@link TurborelError} the server's refusal, as 28000 or 08004; 08006 if the connection is lost
   */
  protected async begin(user: string, mechanism: Mechanism, offer: Offer): Promise<void> {
    try {
      await this.#send({
        kind: 'hello',
        version: VERSION,
        user,
        mechanism: mechanism.name,
        initial: mechanism.initial(),
        capabilities: offer.capabilities,
        attributes: offer.attributes,
      });
      await this.#login(mechanism, offer);
    } catch (e) {
      this.#stream.destroy();
      throw e;
    }
  }

  /**
   * Answers each Challenge until Ready, or the server's refusal.
   *
   * @param mechanism - what proves the user
   * @param offer - what was asked for
   */
  async #login(mechanism: Mechanism, offer: Offer): Promise<void> {
    for (;;) {
      const reply = await this.receive();
      if (reply.kind === 'challenge') {
        await this.#send({ kind: 'answer', answer: await mechanism.answer(reply.challenge) });
      } else if (reply.kind === 'ready') {
        mechanism.ready();
        this.#ready(reply.authorization, reply.key, reply.capabilities, reply.server);
        this.#compressFrom = this.told.has(cap.COMPRESSION) ? offer.compressFrom : undefined;
        return;
      } else if (reply.kind === 'error') {
        mechanism.refused();
        throw this.#failed(reply.failure);
      } else {
        throw this.#lose('the server sent no Ready');
      }
    }
  }

  /**
   * Takes Ready's fields: the session's authorization, its cancel key, the capabilities granted and the server.
   *
   * @param authorization - the authorization identifier
   * @param key - the cancel key
   * @param granted - the capabilities granted
   * @param server - the server's product
   */
  #ready(authorization: string, key: Uint8Array, granted: readonly string[], server: string): void {
    [this.#authorization, this.#key, this.#server, this.#loggingIn] = [authorization, key, server, false];
    this.told.granted = cap.ALL_CAPABILITIES.filter((name) => granted.includes(name));
  }

  /**
   * Authenticates the connection again as `user` by `mechanism`, its
   * session renewed as that user's, as a reset renews it, under a new
   * cancel key; the capabilities stay those granted.
   *
   * @param user - the user, read by the server as an identifier
   * @param mechanism - what proves the user
   * @throws {@link TurborelError} the server's refusal, which closes the connection; 08006 if `change-user` was not granted, or the connection is lost
   */
  async changeUser(user: string, mechanism: Mechanism): Promise<void> {
    await this.#send({ kind: 'changeUser', user, mechanism: mechanism.name, initial: mechanism.initial() });
    for (;;) {
      const reply = await this.receive();
      if (reply.kind === 'challenge') {
        await this.#send({ kind: 'answer', answer: await mechanism.answer(reply.challenge) });
      } else if (reply.kind === 'ready') {
        mechanism.ready();
        [this.#authorization, this.#key, this.#server] = [reply.authorization, reply.key, reply.server];
        return;
      } else if (reply.kind === 'error') {
        throw this.#failed(reply.failure);
      } else {
        throw this.#lose('the server sent no Ready');
      }
    }
  }

  /** @returns the milliseconds the next wait may take: the connect timeout while logging in, then the read timeout */
  #wait(): number | undefined {
    if (this.#loggingIn) return this.#timeouts.connect;
    return this.#boundedReads ? this.#timeouts.read : undefined;
  }

  /**
   * Sends a request, compressed past the threshold once compression is
   * granted; refused before anything is sent if it needs a capability not
   * granted.
   *
   * @param request - the request
   */
  async #send(request: Request): Promise<void> {
    await this.#sendAll([request]);
  }

  /**
   * Sends requests at once, each compressed past the threshold once
   * compression is granted; refused before anything is sent if one needs
   * a capability not granted, or a copy is under way.
   *
   * @param requests - the requests
   */
  async #sendAll(requests: readonly Request[]): Promise<void> {
    if (this.#lost !== undefined) throw this.#lost;
    const frames: Uint8Array[] = [];
    for (const request of requests) {
      if (this.#copying && !DURING_COPY.has(request.kind)) {
        throw apiMisuse('a copy is under way: finish or abandon it before another request');
      }
      const missing = this.#loggingIn ? [] : capabilitiesOf(request).filter((name) => !this.told.has(name));
      if (missing.length > 0) throw connectionFailure(`the server did not grant ${missing.join(', ')}`);
      frames.push(encodeRequest(request));
    }
    for (const request of requests) {
      if (request.kind === 'copyIn' || request.kind === 'copyEnd') this.#copying = request.kind === 'copyIn';
    }
    const frame = frames.length === 1 ? (frames[0] ?? new Uint8Array(0)) : Buffer.concat(frames);
    const bytes = this.#compressFrom === undefined ? frame : compressFrames(frame, this.#compressFrom);
    try {
      await this.#stream.write(bytes, this.#wait());
    } catch (e) {
      throw this.#lostBy(e as TurborelError);
    }
  }

  /**
   * Sends requests at once, before any reply is read: a pipeline's window.
   *
   * @param requests - the requests
   * @throws {@link TurborelError} 08006 if the connection is lost, or a request needs a capability not granted
   */
  protected async sendAll(requests: readonly Request[]): Promise<void> {
    await this.#sendAll(requests);
  }

  /**
   * Sends a request (a later layer's entry, as statements').
   *
   * @param request - the request
   * @throws {@link TurborelError} 08006 if the connection is lost, or the request needs a capability not granted
   */
  async send(request: Request): Promise<void> {
    await this.#send(request);
  }

  /**
   * The server's next reply, each Notice and Status before it taken, a
   * compressed one inflated, a failure that ends the connection losing it.
   * A reply that holds a value the driver cannot take, its frame read
   * whole, fails its request alone: the rest of the request's replies are
   * read past first, unless `answer` says the request is answered by one
   * reply, and the connection goes on.
   *
   * @param answer - `replies`, of a request answered in a statement's order, by default; or `one`, by one reply
   * @returns the reply
   * @throws {@link TurborelError} 08006 if the connection is lost or a frame is malformed; TB916, or 0A000, for a value that cannot be taken
   */
  async receive(answer: 'replies' | 'one' = 'replies'): Promise<Reply> {
    for (;;) {
      const [kind, body] = await this.#frame();
      let reply: Reply;
      try {
        reply = decodeReply(kind, body);
      } catch (e) {
        const failure = this.#skipped(kind, body, e);
        if (answer === 'replies') await this.#drained(kind, body);
        throw failure;
      }
      const took = this.#took(reply);
      if (took !== undefined) return took;
    }
  }

  /**
   * `reply`, unless it is a Notice, a Status or a debugger's Event, which is taken; a reply of a statement, its end noted.
   *
   * @param reply - the reply
   * @returns it, or undefined if it was taken
   */
  #took(reply: Reply): Reply | undefined {
    if (reply.kind === 'notice') this.told.notice(noticeOf(reply));
    else if (reply.kind === 'status') this.told.settings.set(reply.name, reply.value);
    else if (reply.kind === 'event') this.told.events.push(reply.event);
    else return this.#noted(reply);
    return undefined;
  }

  /**
   * Whether a frame arrives within `ms`, none read; the connection kept if none does.
   *
   * @param ms - the milliseconds to wait, or undefined for no limit
   * @returns true once one has begun to arrive
   */
  async arrives(ms: number | undefined): Promise<boolean> {
    if (this.#lost !== undefined) throw this.#lost;
    try {
      return await this.#stream.arrives(ms);
    } catch (e) {
      throw this.#lostBy(e as TurborelError);
    }
  }

  /** @returns the next reply, read as `receive` reads one: undefined if it was a Notice, a Status or an Event, each taken */
  async takeUnasked(): Promise<Reply | undefined> {
    const [kind, body] = await this.#frame();
    let reply: Reply;
    try {
      reply = decodeReply(kind, body);
    } catch (e) {
      throw this.#skipped(kind, body, e);
    }
    return this.#took(reply);
  }

  /** @returns the next frame's kind and body, inflated first if compressed and compression was granted */
  async #frame(): Promise<[number, Uint8Array]> {
    if (this.#lost !== undefined) throw this.#lost;
    try {
      const frame = await this.#stream.next(this.#maxBody, this.#wait());
      const held = received(frame, this.#compressFrom !== undefined, this.#maxBody);
      return [held.kind, held.body];
    } catch (e) {
      throw this.#lostBy(e instanceof TurborelError ? e : connectionFailure(`a reply cannot be read: ${String(e)}`, e));
    }
  }

  /**
   * Takes a frame that did not decode: a malformed one loses the connection; one holding a value that cannot be taken does not, a Complete's head noted as its whole would be.
   *
   * @param kind - its kind
   * @param body - its body
   * @param e - why it did not decode
   * @returns the failure
   */
  #skipped(kind: number, body: Uint8Array, e: unknown): TurborelError {
    const failure = e instanceof TurborelError ? e : connectionFailure(`a reply cannot be read: ${String(e)}`, e);
    if (endsConnection(failure)) throw this.#lostBy(failure);
    const head = completedHead(kind, body);
    if (head !== undefined) this.#noted({ kind: 'complete', completion: head });
    return failure;
  }

  /**
   * Reads past the rest of a request's replies once one held a value that cannot be taken, up to the one that ends them, each taken or skipped as the first was.
   *
   * @param kind - the first's kind
   * @param body - its body
   */
  async #drained(kind: number, body: Uint8Array): Promise<void> {
    for (let [k, b] = [kind, body]; !endsRequest(k, b);) {
      [k, b] = await this.#frame();
      try {
        this.#took(decodeReply(k, b));
      } catch (e) {
        this.#skipped(k, b, e);
      }
    }
  }

  /**
   * `reply`, its end noted: whether a transaction is active after it, and a failure that ends the connection.
   *
   * @param reply - the reply
   * @returns it
   */
  #noted(reply: Reply): Reply {
    if (reply.kind === 'complete') {
      const c = reply.completion;
      [this.#active, this.#warning] = [c.active, c.sqlstate.startsWith(WARNING_CLASS) ? c.sqlstate : undefined];
      this.told.position = c.position ?? this.told.position;
      this.told.completed = c;
    } else if (reply.kind === 'error') [this.#active, this.#warning] = [reply.failure.active, undefined];
    else if (reply.kind === 'description') [this.#active, this.#warning] = [true, undefined];
    // Ready ends a login or a change of user, which renews the session as a
    // reset does.
    else if (reply.kind === 'ready') [this.#active, this.#warning] = [false, undefined];
    // A locator is valid within a transaction alone.
    else if (
      reply.kind === 'rows' ||
      reply.kind === 'suspended' ||
      reply.kind === 'lobData' ||
      reply.kind === 'lobLocator'
    )
      this.#active = true;
    if (reply.kind === 'error' && endsConnection(reply.failure)) this.#lostBy(reply.failure);
    return reply;
  }

  /**
   * `failure`, the connection lost if it ends it.
   *
   * @param failure - the server's failure
   * @returns it
   */
  #failed(failure: TurborelError): TurborelError {
    if (endsConnection(failure)) this.#lostBy(failure);
    return failure;
  }

  /**
   * Loses the connection, for a connection failure `message`.
   *
   * @param message - what went wrong
   * @returns the failure
   */
  #lose(message: string): TurborelError {
    return this.#lostBy(connectionFailure(message));
  }

  /**
   * Loses the connection for `failure`: it takes no more, and its socket is closed.
   *
   * @param failure - the failure
   * @returns the failure that lost it, the first
   */
  #lostBy(failure: TurborelError): TurborelError {
    this.#lost ??= failure;
    this.#stream.destroy();
    return failure;
  }

  /**
   * Fails `failure` as the server's, losing the connection if it ends it (a later layer's entry).
   *
   * @param failure - the server's failure
   * @returns it
   */
  failed(failure: TurborelError): TurborelError {
    return this.#failed(failure);
  }

  /**
   * Loses the connection, for a reply out of turn (a later layer's entry).
   *
   * @param message - what went wrong
   * @returns the failure
   */
  lose(message: string): TurborelError {
    return this.#lose(message);
  }

  /** @returns the session's authorization identifier, as Ready gave it */
  get authorization(): string {
    return this.#authorization;
  }

  /** @returns the server's product and version, as "turborel 0.0.0 (alpha)" */
  get server(): string {
    return this.#server;
  }

  /** @returns the capabilities granted, in Ready's order */
  get granted(): readonly string[] {
    return this.told.granted;
  }

  /**
   * Whether the server granted `name`.
   *
   * @param name - a capability's name
   * @returns true if Ready granted it
   */
  has(name: string): boolean {
    return this.told.has(name);
  }

  /** @returns whether the session's transaction is active, as the server last said */
  get inTransaction(): boolean {
    return this.#active;
  }

  /** @returns the SQLSTATE of the warning the last statement completed with, if it did: of a query too, once all its rows were read */
  get warning(): string | undefined {
    return this.#warning;
  }

  /** @returns whether the connection is lost, taking no more */
  get isLost(): boolean {
    return this.#lost !== undefined;
  }

  /** @returns where its server is, if it was reached at a target */
  get target(): Target | undefined {
    return this.#target;
  }

  /** @returns its cancel key, the client's secret, kept for a canceller alone */
  cancelKey(): Uint8Array | undefined {
    return this.#key?.slice();
  }

  /** @returns how long each read or write waits, in milliseconds; undefined for no limit */
  get readTimeout(): number | undefined {
    return this.#timeouts.read;
  }

  /**
   * How long each read or write of the server waits from now on.
   *
   * @param ms - the milliseconds, or undefined for no limit
   */
  setReadTimeout(ms: number | undefined): void {
    this.#timeouts = { ...this.#timeouts, read: ms };
  }

  /**
   * Takes replies of at most `bytes` bytes of body from now on; a longer one loses the connection.
   *
   * @param bytes - the longest body taken, 16 MiB unless this says
   */
  setMaxBody(bytes: number): void {
    this.#maxBody = bytes;
  }

  /**
   * Ends the connection, once the server has ended its session as
   * SESSION.COMMIT_AT_END says and closed it, a Notice or a Status before
   * its Error read past: waiting at most the read timeout, else 60
   * seconds, on a stream whose reads are bounded; on one opened unbounded,
   * as a named pipe is, as long as it must, as its maker set it.
   *
   * @throws {@link TurborelError} the server's failure, as a commit that fails as the session ends; 08006 if it does not close in time
   */
  async terminate(): Promise<void> {
    await this.#send({ kind: 'terminate' });
    const within = this.#boundedReads ? (this.#timeouts.read ?? TERMINATE_WITHIN) : undefined;
    const rest = await this.#stream.closed(this.#maxBody, within);
    this.#lost ??= connectionFailure('the connection was terminated');
    // A Notice or a Status comes before the session's end is told, an
    // Error if its commit failed: read a frame at a time, to the end.
    for (let at = 0; rest.byteLength - at >= HEADER_BYTES;) {
      const { kind, length } = decodeHeader(rest.subarray(at, at + HEADER_BYTES), this.#maxBody);
      const body = rest.subarray(at + HEADER_BYTES, at + HEADER_BYTES + length);
      if (body.byteLength < length) throw connectionFailure('the server closed within a reply to Terminate');
      at += HEADER_BYTES + length;
      const reply = decodeReply(kind, body);
      if (reply.kind === 'error') throw reply.failure;
      if (reply.kind !== 'notice' && reply.kind !== 'status' && reply.kind !== 'pong') {
        throw connectionFailure('the server answered Terminate');
      }
    }
  }

  /** Closes the connection at once, telling the server nothing. */
  destroy(): void {
    this.#lostBy(connectionFailure('the connection was closed'));
  }

  /** @returns where it reached, as whom, and whether it is lost: never its cancel key */
  toString(): string {
    return `Connection(${this.#authorization}${this.isLost ? ', lost' : ''})`;
  }
}

/**
 * The notice of a Notice reply.
 *
 * @param reply - the reply
 * @returns the notice
 */
function noticeOf(reply: Extract<Reply, { kind: 'notice' }>): Notice {
  return {
    sqlstate: reply.sqlstate,
    message: reply.message,
    ...(reply.diagnostics === undefined ? {} : { diagnostics: reply.diagnostics }),
  };
}
