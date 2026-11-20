/**
 * The client's side of the SCRAM-SHA-256 exchange (RFC 5802 §3, §5, §7;
 * RFC 7677), as turborel-protocol's `scram/client.rs` makes it: its first
 * message, its proof answering the server's first, bound to its channel
 * as its GS2 header names, and the server's signature checked. The proof
 * is made from the keys a password derives (`Derived`), so a key cache
 * may keep them. Internal.
 *
 * @packageDocumentation
 */

import { createHash, createHmac, pbkdf2, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

import { TurborelError } from '../error.js';

/** SQLCODE of a connection exception, of credentials refused as the connection is made. */
const SQLCODE_CONNECTION = -919;

/** SQLSTATE 28000, invalid authorization specification. */
export const SQLSTATE_INVALID_AUTHORIZATION = '28000';

/** The mechanism's name. */
export const MECHANISM = 'scram-sha-256';
/** Its name bound to the TLS channel. */
export const MECHANISM_PLUS = 'scram-sha-256-plus';

/** The bytes of a key, SHA-256's. */
const KEY_BYTES = 32;

/** The GS2 headers [RFC 5802 §7]: no binding, able but not offered one, and the two bindings. */
const GS2_NONE = 'n,,';
const GS2_UNOFFERED = 'y,,';
const GS2_END_POINT = 'p=tls-server-end-point,,';
const GS2_EXPORTER = 'p=tls-exporter,,';

/** The HMAC labels of the client's and the server's keys [RFC 5802 §3]. */
const CLIENT_KEY = 'Client Key';
const SERVER_KEY = 'Server Key';

/** A nonce's characters: printable ASCII but the comma [RFC 5802 §7]. */
const NONCE = /^[\x21-\x2b\x2d-\x7e]+$/u;

/** Base 64 of RFC 4648 §4, padded. */
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;

/** The fields of server-first: its nonce, salt and iterations [RFC 5802 §7]. */
const SERVER_FIRST_FIELDS = 3;

/** The largest iteration count, a `u32`'s, as turborel reads it. */
const MAX_ITERATIONS = 0xffff_ffff;

/** The prefix of a server-final that refuses [RFC 5802 §7]. */
const REFUSED = 'e=';

/** PBKDF2, run off the event loop. */
const derive = promisify(pbkdf2);

/** What the exchange is bound to. */
export type Channel =
  { readonly kind: 'unbound' | 'unoffered' } | { readonly kind: 'endPoint' | 'exporter'; readonly data: Uint8Array };

/** The keys a password derives under a salt and iterations: ClientKey and ServerKey. */
export interface Derived {
  /** ClientKey. */
  readonly client: Uint8Array;
  /** ServerKey. */
  readonly server: Uint8Array;
}

/** The server's first message, read. */
export interface ServerFirst {
  /** The message itself. */
  readonly message: string;
  /** The nonce, the client's extended by the server's. */
  readonly both: string;
  /** The salt. */
  readonly salt: Uint8Array;
  /** The iterations. */
  readonly iterations: number;
}

/**
 * A refusal of the exchange: credentials refused (SQLSTATE 28000).
 *
 * @param why - what went wrong
 * @returns the failure
 */
export function refused(why: string): TurborelError {
  return new TurborelError(SQLCODE_CONNECTION, SQLSTATE_INVALID_AUTHORIZATION, `SCRAM: ${why}`);
}

/**
 * Base 64 of `bytes`.
 *
 * @param bytes - the bytes
 * @returns the text
 */
export function encode64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

/**
 * The bytes of base 64 text, if it is base 64.
 *
 * @param text - the text
 * @returns the bytes, or undefined
 */
export function decode64(text: string): Uint8Array | undefined {
  return BASE64.test(text) ? new Uint8Array(Buffer.from(text, 'base64')) : undefined;
}

/**
 * HMAC-SHA-256.
 *
 * @param key - the key
 * @param data - what is signed
 * @returns the tag
 */
export function hmac(key: Uint8Array | string, data: Uint8Array | string): Uint8Array {
  return new Uint8Array(createHmac('sha256', key).update(data).digest());
}

/**
 * SHA-256.
 *
 * @param data - what is hashed
 * @returns the hash
 */
function sha256(data: Uint8Array): Uint8Array {
  return new Uint8Array(createHash('sha256').update(data).digest());
}

/**
 * The keys `password` derives under `salt` and `iterations`, by PBKDF2.
 *
 * @param password - the password, as its UTF-8
 * @param salt - the salt
 * @param iterations - the iterations
 * @returns ClientKey and ServerKey
 */
export async function deriveKeys(password: string, salt: Uint8Array, iterations: number): Promise<Derived> {
  const salted = new Uint8Array(await derive(password, salt, iterations, KEY_BYTES, 'sha256'));
  return { client: hmac(salted, CLIENT_KEY), server: hmac(salted, SERVER_KEY) };
}

/**
 * The GS2 header of `channel`.
 *
 * @param channel - what the exchange is bound to
 * @returns its header
 */
function header(channel: Channel): string {
  switch (channel.kind) {
    case 'unbound':
      return GS2_NONE;
    case 'unoffered':
      return GS2_UNOFFERED;
    case 'endPoint':
      return GS2_END_POINT;
    case 'exporter':
      return GS2_EXPORTER;
  }
}

/**
 * The value of the attribute `name` of a field, `name=value`.
 *
 * @param field - the field
 * @param name - the attribute's letter
 * @returns its value
 */
function attribute(field: string | undefined, name: string): string {
  if (field === undefined) throw refused(`the attribute ${name} is missing`);
  if (!field.startsWith(`${name}=`)) throw refused(`the attribute ${name} was expected, not ${field}`);
  return field.slice(name.length + 1);
}

/** Decodes the server's messages as UTF-8, failing on any octet that is not. */
const UTF8 = new TextDecoder('utf-8', { fatal: true });

/**
 * The text of a message.
 *
 * @param bytes - its bytes
 * @returns its text
 */
function text(bytes: Uint8Array): string {
  try {
    return UTF8.decode(bytes);
  } catch {
    throw refused('a message is not UTF-8');
  }
}

/** The client's side of one exchange. */
export class ScramClient {
  private readonly channel: Channel;
  private readonly user: string;
  private bare = '';
  private nonce = '';
  private expected: Uint8Array | undefined;
  private done = false;

  /**
   * An exchange bound to `channel`.
   *
   * @param channel - what the exchange is bound to
   * @param user - the user client-first names; turborel takes Hello's, so the driver names none
   */
  constructor(channel: Channel, user = '') {
    this.channel = channel;
    this.user = user;
  }

  /** @returns whether it is bound to a TLS channel */
  get bound(): boolean {
    return this.channel.kind === 'endPoint' || this.channel.kind === 'exporter';
  }

  /** @returns whether the server's signature was right */
  get verified(): boolean {
    return this.done;
  }

  /**
   * client-first, of `nonce`, its user's name escaped as a saslname [RFC 5802 §5.1].
   *
   * @param nonce - the client's nonce
   * @returns the message
   */
  first(nonce: string): Uint8Array {
    this.nonce = nonce;
    this.bare = `n=${this.user.replaceAll('=', '=3D').replaceAll(',', '=2C')},r=${nonce}`;
    return new TextEncoder().encode(header(this.channel) + this.bare);
  }

  /**
   * server-first, read.
   *
   * @param bytes - the message
   * @returns its nonce, salt and iterations
   */
  read(bytes: Uint8Array): ServerFirst {
    if (this.nonce === '') throw refused("the server's first message came out of turn");
    const message = text(bytes);
    const fields = message.split(',');
    const [r, s, i] = fields;
    const [both, salt, iterations] = [attribute(r, 'r'), attribute(s, 's'), attribute(i, 'i')];
    if (fields.length > SERVER_FIRST_FIELDS) throw refused("the server's first message has more than it should");
    if (!NONCE.test(both) || both.length <= this.nonce.length || !both.startsWith(this.nonce)) {
      throw refused("the server's nonce does not extend the client's");
    }
    const decoded = decode64(salt);
    if (decoded === undefined) throw refused('the salt is not base 64');
    const count = /^[0-9]+$/u.test(iterations) ? Number(iterations) : 0;
    if (!Number.isSafeInteger(count) || count < 1 || count > MAX_ITERATIONS)
      throw refused('the iterations are no positive number');
    return { message, both, salt: decoded, iterations: count };
  }

  /**
   * client-final: the proof of `keys`, answering `first`.
   *
   * @param first - server-first, read
   * @param keys - the keys the password derives under its salt and iterations
   * @returns the message
   */
  prove(first: ServerFirst, keys: Derived): Uint8Array {
    const input = new Uint8Array([...new TextEncoder().encode(header(this.channel)), ...this.channelData()]);
    const withoutProof = `c=${encode64(input)},r=${first.both}`;
    const auth = `${this.bare},${first.message},${withoutProof}`;
    const signature = hmac(sha256(keys.client), auth);
    const proof = keys.client.map((b, i) => b ^ (signature[i] ?? 0));
    this.expected = hmac(keys.server, auth);
    return new TextEncoder().encode(`${withoutProof},p=${encode64(proof)}`);
  }

  /** @returns the channel's data, of a binding */
  private channelData(): Uint8Array {
    return this.channel.kind === 'endPoint' || this.channel.kind === 'exporter' ? this.channel.data : new Uint8Array(0);
  }

  /**
   * server-final: the server's signature checked.
   *
   * @param bytes - the message
   * @throws {@link TurborelError} 28000 if the server refused, or did not prove it knows the user
   */
  verify(bytes: Uint8Array): void {
    if (this.expected === undefined) throw refused("the server's final message came out of turn");
    const message = text(bytes);
    if (message.startsWith(REFUSED)) throw refused(`the server refused: ${message.slice(REFUSED.length)}`);
    const signature = decode64(attribute(message, 'v'));
    if (signature === undefined) throw refused("the server's signature is not base 64");
    if (signature.byteLength !== this.expected.byteLength || !timingSafeEqual(signature, this.expected)) {
      throw refused('the server did not prove it knows the user');
    }
    this.done = true;
  }
}
