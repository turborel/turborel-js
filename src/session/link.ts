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
import type { Offer } from './told.js';
import { type Notice, type NoticeHandler, Told } from './told.js';
import { compressFrames, received } from '../codec/compress.js';
import { HEADER_BYTES, MAX_BODY, decodeHeader } from '../codec/frame.js';
import { type Reply, decodeReply } from '../codec/replies.js';
import { type Request, encodeRequest } from '../codec/requests.js';
import { TurborelError, apiMisuse, connectionFailure } from '../error.js';
import type { Mechanism } from '../auth/mechanism.js';
import type { FrameStream } from '../transport/frames.js';
import type { Target } from '../transport/target.js';

/** The protocol's version, Hello's first field. */
export const VERSION = 1;

/** How long a connection waits to connect, begin TLS and for each step of its login, unless told: 30 seconds. */
export const CONNECT_WITHIN = 30_000;

/** How long Terminate waits for the server to close, if the read timeout sets no limit: 60 seconds. */
export const TERMINATE_WITHIN = 60_000;

/** The SQLSTATE class of a connection exception, which loses the connection. */
const CONNECTION_CLASS = '08';
/** SQLSTATE 08003, connection does not exist, which names another connection and loses none. */
const ANOTHER_CONNECTION = '08003';
/** The SQLSTATE class of invalid authorization, which loses a connection being made. */
const AUTHORIZATION_CLASS = '28';
/** The SQLSTATE class of a warning. */
const WARNING_CLASS = '01';
/** SQLCODE of a connection exception. */
const SQLCODE_CONNECTION = -919;

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
const DURING_COPY: ReadonlySet<Request['kind']> = new Set(['copyData', 'copyEnd', 'ping']);

/** The capability each request with one needs, by its kind. */
const NEEDED: Readonly<Partial<Record<Request['kind'], string>>> = {
  describe: cap.DESCRIBE,
  ping: cap.PING,
  reset: cap.RESET,
  changeUser: cap.CHANGE_USER,
  copyIn: cap.COPY,
  copyData: cap.COPY,
  copyEnd: cap.COPY,
};

/**
 * The capabilities `request` needs granted, its tail fields' among them.
 *
 * @param request - the request
 * @returns their names
 */
export function capabilitiesOf(request: Request): string[] {
  const needed: string[] = [];
  const own = NEEDED[request.kind];
  if (own !== undefined) needed.push(own);
  if ((request.kind === 'query' || request.kind === 'execute') && request.attributes.length > 0)
    needed.push(cap.QUERY_ATTRIBUTES);
  if (request.kind === 'query' && request.multi) needed.push(cap.MULTI_STATEMENT);
  if ((request.kind === 'execute' || request.kind === 'fetch' || request.kind === 'close') && request.cursor !== 0) {
    needed.push(cap.CURSORS);
  }
  return needed;
}

/**
 * Whether `failure` loses the connection it came on: a connection
 * exception but 08003, or credentials refused as the connection is made.
 *
 * @param failure - the failure
 * @returns true if the server closes the connection after it
 */
export function endsConnection(failure: TurborelError): boolean {
  const another = failure.sqlstate === ANOTHER_CONNECTION;
  const connecting = failure.sqlcode === SQLCODE_CONNECTION && failure.sqlstate.startsWith(AUTHORIZATION_CLASS);
  return (failure.sqlstate.startsWith(CONNECTION_CLASS) && !another) || connecting;
}

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
        // Renewed as a reset renews it: no transaction is active.
        [this.#active, this.#warning] = [false, undefined];
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
   *
   * @returns the reply
   * @throws {@link TurborelError} 08006 if the connection is lost or a reply is malformed
   */
  async receive(): Promise<Reply> {
    for (;;) {
      const reply = await this.#next();
      if (reply.kind === 'notice') this.told.notice(noticeOf(reply));
      else if (reply.kind === 'status') this.told.settings.set(reply.name, reply.value);
      else return this.#noted(reply);
    }
  }

  /** @returns the next reply decoded, inflated first if compressed and compression was granted */
  async #next(): Promise<Reply> {
    if (this.#lost !== undefined) throw this.#lost;
    try {
      const frame = await this.#stream.next(this.#maxBody, this.#wait());
      const held = received(frame, this.#compressFrom !== undefined, this.#maxBody);
      return decodeReply(held.kind, held.body);
    } catch (e) {
      // A reply that cannot be read, whatever failed reading it, loses the
      // connection as a malformed message does (RULES.md D8).
      throw this.#lostBy(e instanceof TurborelError ? e : connectionFailure(`a reply cannot be read: ${String(e)}`, e));
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

  /**
   * The value of a session setting as the server last told it, with no round trip.
   *
   * @param name - the setting, as SESSION.TIME_ZONE, or a status, as AUTHORIZATION
   * @returns its value, empty for a null, or undefined if the server told none of that name
   */
  setting(name: string): string | undefined {
    return this.told.settings.get(name);
  }

  /** @returns every setting the server told, by name */
  settings(): ReadonlyMap<string, string> {
    return new Map(this.told.settings);
  }

  /**
   * Takes each notice from now on as it comes; none, they are kept, the last 64.
   *
   * @param handler - what takes them, or undefined to keep them
   */
  setNoticeHandler(handler: NoticeHandler | undefined): void {
    this.told.handler = handler;
  }

  /** @returns the notices kept, taken */
  takeNotices(): Notice[] {
    return this.told.notices.splice(0);
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
   * SESSION.COMMIT_AT_END says and closed it, waiting at most the read
   * timeout, else 60 seconds.
   *
   * @throws {@link TurborelError} the server's failure, as a commit that fails as the session ends; 08006 if it does not close in time
   */
  async terminate(): Promise<void> {
    await this.#send({ kind: 'terminate' });
    const rest = await this.#stream.closed(this.#maxBody, this.#timeouts.read ?? TERMINATE_WITHIN);
    this.#lost ??= connectionFailure('the connection was terminated');
    if (rest.byteLength < HEADER_BYTES) return;
    const { kind, length } = decodeHeader(rest.subarray(0, HEADER_BYTES), this.#maxBody);
    const reply = decodeReply(kind, rest.subarray(HEADER_BYTES, HEADER_BYTES + length));
    if (reply.kind === 'error') throw reply.failure;
    if (reply.kind !== 'notice' && reply.kind !== 'status' && reply.kind !== 'pong') {
      throw connectionFailure('the server answered Terminate');
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
