/**
 * The client's side of `scram-sha-256` and `scram-sha-256-plus`
 * (`[PROTOCOL Mechanisms]`, `[CLIENT Connecting]`), as turborel-client's
 * `scram.rs` makes it: the client proves it knows the password, never
 * sending it, and takes the server only once it has proved it knows the
 * user's verifier. Over TLS it binds the exchange to the connection: over
 * TLS 1.3 by `tls-exporter`, else by `tls-server-end-point`, the hash of
 * the certificate the server presented.
 *
 * @packageDocumentation
 */

import { randomBytes } from 'node:crypto';

import { endPoint } from './end-point.js';
import type { KeyCache } from './key-cache.js';
import type { Mechanism, TlsChannel } from './mechanism.js';
import {
  type Channel,
  MECHANISM,
  MECHANISM_PLUS,
  ScramClient,
  type ServerFirst,
  deriveKeys,
  encode64,
  refused,
} from './scram-exchange.js';
import { connectionFailure } from '../error.js';

/** The bytes of a nonce, as turborel's `NONCE_BYTES`. */
const NONCE_BYTES = 18;

/** Whether SCRAM binds its exchange to the TLS channel: where it can, never, or always. */
export type ChannelBinding = 'disable' | 'prefer' | 'require';

/** How a SCRAM mechanism behaves beyond its password. */
export interface ScramOptions {
  /** Send it over plain TCP too, for a server whose SERVER.SCRAM_WITHOUT_TLS is ON. */
  readonly inTheClear?: boolean;
  /** Whether it binds its exchange to the TLS channel, `prefer` by default. */
  readonly channelBinding?: ChannelBinding;
  /** A cache its keys are kept in and taken from. */
  readonly cache?: KeyCache;
}

/** The client's side of SCRAM-SHA-256, of a user's password. */
export class Scram implements Mechanism {
  readonly #password: string;
  readonly #clear: boolean;
  readonly #binding: ChannelBinding;
  readonly #cache: KeyCache | undefined;
  #channel: Channel = { kind: 'unbound' };
  #exchange: ScramClient | undefined;
  #used: { salt: Uint8Array; iterations: number } | undefined;

  /**
   * The proof of `password`.
   *
   * @param password - the password, as its UTF-8, with no SASLprep, as turborel takes it
   * @param options - whether it goes over plain TCP, how it binds, and its key cache
   */
  constructor(password: string, options: ScramOptions = {}) {
    this.#password = password;
    this.#clear = options.inTheClear ?? false;
    this.#binding = options.channelBinding ?? 'prefer';
    this.#cache = options.cache;
  }

  /** @returns `scram-sha-256-plus` once bound, else `scram-sha-256` */
  get name(): string {
    return this.#channel.kind === 'endPoint' || this.#channel.kind === 'exporter' ? MECHANISM_PLUS : MECHANISM;
  }

  /** @returns whether its exchange overheard lets the password be guessed: unless sent in the clear by choice */
  get secret(): boolean {
    return !this.#clear;
  }

  /**
   * Binds to the channel's `tls-exporter` over TLS 1.3, else its
   * certificate's `tls-server-end-point`, else able to bind but offered
   * none; under `disable`, nothing.
   *
   * @param channel - what the handshake gave
   */
  bind(channel: TlsChannel): void {
    if (this.#binding === 'disable') return;
    if (channel.exporter !== undefined) {
      this.#channel = { kind: 'exporter', data: channel.exporter };
      return;
    }
    const hashed = channel.certificate === undefined ? undefined : endPoint(channel.certificate);
    this.#channel = hashed === undefined ? { kind: 'unoffered' } : { kind: 'endPoint', data: hashed };
  }

  /** @returns client-first, of a new nonce, bound as `bind` said; the next connection binds afresh */
  initial(): Uint8Array {
    const exchange = new ScramClient(this.#channel);
    this.#channel = { kind: 'unbound' };
    this.#exchange = exchange;
    this.#used = undefined;
    return exchange.first(encode64(randomBytes(NONCE_BYTES)));
  }

  /**
   * client-final to server-first; then nothing to server-final, once the
   * server's signature is right. A failure forgets the keys the cache gave.
   *
   * @param challenge - server-first or server-final
   * @returns the answer
   */
  async answer(challenge: Uint8Array): Promise<Uint8Array> {
    try {
      const exchange = this.#exchange;
      if (exchange === undefined) throw connectionFailure('SCRAM was not begun');
      const final = challenge[0] === 'v'.charCodeAt(0) || challenge[0] === 'e'.charCodeAt(0);
      if (final && challenge[1] === '='.charCodeAt(0)) {
        exchange.verify(challenge);
        return new Uint8Array(0);
      }
      return await this.#prove(exchange, challenge);
    } catch (e) {
      this.refused();
      throw e;
    }
  }

  /**
   * client-final, answering server-first.
   *
   * @param exchange - the exchange
   * @param challenge - server-first
   * @returns the proof
   */
  async #prove(exchange: ScramClient, challenge: Uint8Array): Promise<Uint8Array> {
    if (this.#binding === 'require' && !exchange.bound) {
      throw refused('channel binding is required, and this connection is not bound');
    }
    const first: ServerFirst = exchange.read(challenge);
    const keys =
      this.#cache === undefined
        ? await deriveKeys(this.#password, first.salt, first.iterations)
        : await this.#cache.derived(this.#password, first.salt, first.iterations);
    this.#used = { salt: first.salt, iterations: first.iterations };
    return exchange.prove(first, keys);
  }

  /** Refuses Ready unless the server proved it knows the user's verifier. */
  ready(): void {
    if (this.#exchange?.verified !== true)
      throw connectionFailure("the server did not prove it knows the user's verifier");
  }

  /** Forgets the keys the cache gave an exchange that failed. */
  refused(): void {
    const used = this.#used;
    this.#used = undefined;
    if (used !== undefined) this.#cache?.forget(this.#password, used.salt, used.iterations);
  }

  /** @returns never the password */
  toString(): string {
    return 'Scram(..)';
  }
}
