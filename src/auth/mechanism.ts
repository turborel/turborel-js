/**
 * A client's side of the mechanisms of authentication
 * (`[PROTOCOL Mechanisms]`, `[CLIENT Connecting]`), as turborel-client's
 * `mechanism.rs` has them: what a connection proves its user by, its name,
 * its first bytes and its answer to each challenge. `trust`, `password`
 * and `certificate` are here; SCRAM's is `scram.ts`.
 *
 * @packageDocumentation
 */

import { connectionFailure } from '../error.js';

/** What a TLS connection's handshake gives a mechanism to bind itself to. */
export interface TlsChannel {
  /** The certificate the server presented, its chain's first, as DER. */
  readonly certificate?: Uint8Array;
  /** The connection's `tls-exporter` keying material, over TLS 1.3 alone [RFC 9266 §2]. */
  readonly exporter?: Uint8Array;
}

/** A client's side of a mechanism of authentication. */
export interface Mechanism {
  /** The mechanism's name, as the server knows it. */
  readonly name: string;
  /** Whether what it sends gives away what proves the user, or lets it be guessed: if so, it is never sent over plain TCP. */
  readonly secret: boolean;
  /** @returns the bytes sent with Hello */
  initial(): Uint8Array;
  /**
   * The answer to the server's challenge.
   *
   * @param challenge - the challenge's bytes
   * @returns the answer's bytes
   */
  answer(challenge: Uint8Array): Promise<Uint8Array>;
  /** Refuses to end the exchange as the server sends Ready, if the server has not proved itself, as SCRAM's must. */
  ready(): void;
  /**
   * Takes the TLS channel of the connection about to carry it, before `name` and `initial`.
   *
   * @param channel - what the handshake gave
   */
  bind(channel: TlsChannel): void;
  /** Forgets what it learnt of an exchange the server refused. */
  refused(): void;
}

/** The name of the mechanism `trust`. */
export const TRUST = 'trust';
/** The name of the mechanism `password`. */
export const PASSWORD = 'password';
/** The name of the mechanism `certificate`. */
export const CERTIFICATE = 'certificate';

/** A mechanism whose exchange is Hello alone, accepted or refused at once. */
abstract class AtOnce implements Mechanism {
  /** The mechanism's name, as the server knows it. */
  abstract readonly name: string;
  /** Whether what it sends is secret: of these, only a password's is. */
  readonly secret: boolean = false;

  /** @returns no bytes */
  initial(): Uint8Array {
    return new Uint8Array(0);
  }

  /**
   * Has no answer to a challenge.
   *
   * @returns never
   */
  answer(): Promise<Uint8Array> {
    return Promise.reject(connectionFailure(`${this.name} has no answer to a challenge`));
  }

  /** Ends at Ready, the server having nothing to prove. */
  ready(): void {
    // Nothing is proved of the server by this mechanism.
  }

  /** Binds nothing. */
  bind(): void {
    // Nothing of the channel is bound by this mechanism.
  }

  /** Keeps nothing. */
  refused(): void {
    // Nothing is kept of an exchange by this mechanism.
  }
}

/** The client's side of `trust`: nothing to prove, so a server takes it only from a client of its own machine. */
export class Trust extends AtOnce {
  /** `trust`. */
  readonly name = TRUST;
}

/** The client's side of `certificate`: nothing sent, the TLS client certificate proving the user its common name names. */
export class Certificate extends AtOnce {
  /** `certificate`. */
  readonly name = CERTIFICATE;
}

/** The client's side of `password`: the password sent whole, so only over TLS, a Unix socket or a named pipe. */
export class Password extends AtOnce {
  /** `password`. */
  readonly name = PASSWORD;
  /** A password is secret, never sent over plain TCP. */
  override readonly secret = true;
  readonly #password: string;

  /** @param password - the password, sent as its UTF-8 */
  constructor(password: string) {
    super();
    this.#password = password;
  }

  /** @returns the password's UTF-8 */
  override initial(): Uint8Array {
    return new TextEncoder().encode(this.#password);
  }

  /** @returns never the password */
  override toString(): string {
    return 'Password(..)';
  }
}
