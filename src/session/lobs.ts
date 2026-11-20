/**
 * Large objects over a connection (`[CLIENT Large objects]`), as
 * turborel-client's `lobs.rs` reads and writes them: one a result sends
 * by its locator read by ranges, or as a stream, a chunk a request; a new
 * one written a piece at a time and sent as a parameter by its locator. A
 * large object a result sends whole is read from the value itself.
 *
 * @packageDocumentation
 */

import { Readable } from 'node:stream';

import type { Link } from './link.js';
import type { Completion } from '../codec/replies.js';
import type { Request } from '../codec/requests.js';
import { type Lob, type LobKind, LobLocator } from '../codec/values.js';
import { connectionFailure } from '../error.js';

/** The most octets the server sends of a large object at once, and a writer appends: 256 KiB. */
export const CHUNK_OCTETS = 262_144;

/** The longest value sent whole for a large object parameter, as the server sends one whole by default: 64 KiB. */
export const LOB_INLINE_OCTETS = 65_536;

/** UTF-8, as a CLOB's octets are. */
const UTF8 = new TextEncoder();

/** The bits of a UTF-8 octet that mark one continuing a character, and what they are then. */
const CONTINUATION_MASK = 0xc0;
const CONTINUATION = 0x80;
/** The most octets of a UTF-8 character. */
const MAX_UTF8 = 4;
/** The fewest octets of a character of more than one. */
const MIN_MULTI = 2;
/** The shift that puts an octet's bits at the top of 32, to count its leading ones. */
const LEAD_SHIFT = 24;

/**
 * The server's completion of `request`.
 *
 * @param conn - the connection
 * @param request - the request
 * @returns the completion
 * @throws {@link TurborelError} the server's failure; 08006 if it sends another reply, or the connection is lost
 */
export async function completed(conn: Link, request: Request): Promise<Completion> {
  await conn.send(request);
  const reply = await conn.receive();
  if (reply.kind === 'complete') return reply.completion;
  throw reply.kind === 'error' ? conn.failed(reply.failure) : conn.lose('the server sent no completion');
}

/**
 * The octets of a large object held whole.
 *
 * @param lob - the large object
 * @returns its octets: a CLOB's UTF-8
 */
export function octetsOf(lob: Lob): Uint8Array {
  return typeof lob.data === 'string' ? UTF8.encode(lob.data) : lob.data;
}

/**
 * A range of a large object held whole: of its octets, or of a CLOB's characters.
 *
 * @param lob - the large object
 * @param from - the first octet or character, from 0
 * @param count - how many at most
 * @param characters - whether the range counts a CLOB's characters
 * @returns the range's octets
 */
export function heldRange(lob: Lob, from: bigint, count: bigint, characters: boolean): Uint8Array {
  if (characters && typeof lob.data === 'string') {
    // Code points, as a CLOB counts its characters.
    const chars = Array.from(lob.data);
    const start = Number(from > BigInt(chars.length) ? BigInt(chars.length) : from);
    const end = Number(from + count > BigInt(chars.length) ? BigInt(chars.length) : from + count);
    return UTF8.encode(chars.slice(start, end).join(''));
  }
  const bytes = octetsOf(lob);
  const length = BigInt(bytes.byteLength);
  const start = from > length ? length : from;
  const end = start + count > length ? length : start + count;
  return bytes.subarray(Number(start), Number(end));
}

/**
 * A large object's octets as a stream, read a chunk at a time.
 *
 * @param read - reads at most a chunk from an octet
 * @param octets - its length in octets
 * @returns the stream
 */
export function lobStream(read: (from: bigint) => Promise<Uint8Array>, octets: bigint): Readable {
  /** @returns each chunk, in order */
  async function* chunks(): AsyncGenerator<Uint8Array> {
    for (let at = 0n; at < octets;) {
      const chunk = await read(at);
      if (chunk.byteLength === 0) throw connectionFailure('the server sent less of the large object than its length');
      at += BigInt(chunk.byteLength);
      yield chunk;
    }
  }
  return Readable.from(chunks(), { objectMode: false });
}

/**
 * The longest start of `bytes`, at most `most` octets, of whole UTF-8
 * characters, as turborel's `char_cut` cuts a CLOB's chunk: a character
 * the end of `bytes` splits left out too; 0 if no character ends within
 * `most`.
 *
 * @param bytes - UTF-8
 * @param most - the most octets
 * @returns where to cut
 */
export function charCut(bytes: Uint8Array, most: number): number {
  let cut = Math.min(most, bytes.byteLength);
  const continues = (i: number): boolean => ((bytes[i] ?? 0) & CONTINUATION_MASK) === CONTINUATION;
  if (cut < bytes.byteLength) {
    while (cut > 0 && continues(cut)) cut -= 1;
    return cut;
  }
  let lead = cut - 1;
  while (lead >= 0 && lead > cut - MAX_UTF8 - 1 && continues(lead)) lead -= 1;
  if (lead < 0 || lead <= cut - MAX_UTF8 - 1) return cut;
  const ones = Math.clz32(~((bytes[lead] ?? 0) << LEAD_SHIFT));
  const width = ones >= MIN_MULTI && ones <= MAX_UTF8 ? ones : 1;
  return lead + width > cut ? lead : cut;
}

/** A new large object written a piece at a time, sent in appends of a chunk; `finish` gives the value to send. */
export class LobWriter {
  readonly #conn: Link;
  /** Its kind. */
  readonly kind: LobKind;
  readonly #locator: number;
  #pending: Uint8Array[] = [];
  #pendingOctets = 0;
  #octets = 0n;
  #characters = 0n;

  /**
   * A writer of the large object `locator` names.
   *
   * @param conn - the connection
   * @param kind - character or binary
   * @param locator - the locator Create gave
   */
  constructor(conn: Link, kind: LobKind, locator: number) {
    this.#conn = conn;
    this.kind = kind;
    this.#locator = locator;
  }

  /**
   * Writes `data`, sent once a chunk is waiting. A CLOB's octets are
   * UTF-8, and a character may be split between writes.
   *
   * @param data - octets, or text written as UTF-8
   * @throws {@link TurborelError} as an append fails; 08006 if the connection is lost
   */
  async write(data: Uint8Array | string): Promise<void> {
    const bytes = typeof data === 'string' ? UTF8.encode(data) : data;
    this.#pending.push(bytes);
    this.#pendingOctets += bytes.byteLength;
    this.#octets += BigInt(bytes.byteLength);
    if (this.kind === 'character') {
      let leads = 0;
      for (const b of bytes) if ((b & CONTINUATION_MASK) !== CONTINUATION) leads += 1;
      this.#characters += BigInt(leads);
    }
    while (this.#pendingOctets >= CHUNK_OCTETS) await this.#appendPiece();
  }

  /** Sends the first chunk of what is pending, a CLOB's cut where a character ends, so no append is longer. */
  async #appendPiece(): Promise<void> {
    const pending = Buffer.concat(this.#pending);
    const cut = this.kind === 'character' ? charCut(pending, CHUNK_OCTETS) : CHUNK_OCTETS;
    const at = Math.min(Math.max(cut, 1), pending.byteLength);
    const bytes = pending.subarray(0, at);
    const rest = pending.subarray(at);
    [this.#pending, this.#pendingOctets] = [[rest], rest.byteLength];
    await completed(this.#conn, { kind: 'lob', lob: { op: 'append', locator: this.#locator, bytes } });
  }

  /** Sends what is written and not yet sent. */
  async #flush(): Promise<void> {
    if (this.#pendingOctets === 0) return;
    const bytes = Buffer.concat(this.#pending);
    [this.#pending, this.#pendingOctets] = [[], 0];
    await completed(this.#conn, { kind: 'lob', lob: { op: 'append', locator: this.#locator, bytes } });
  }

  /**
   * The large object written, to send as a parameter by its locator, valid until its transaction ends.
   *
   * @returns its locator and lengths
   * @throws {@link TurborelError} the server's: 22021 if a CLOB's octets are not UTF-8, 22001 if it is longer than the longest
   */
  async finish(): Promise<LobLocator> {
    await this.#flush();
    return new LobLocator(this.kind, this.#locator, { octets: this.#octets, characters: this.#characters });
  }
}
