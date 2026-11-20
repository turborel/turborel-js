/**
 * The fields of a message read, as `writer.ts` writes them
 * (`[PROTOCOL Values and fields]`). Anything malformed fails the
 * connection (SQLCODE -919, SQLSTATE 08006), never more. Internal.
 *
 * @packageDocumentation
 */

import { type TurborelError, connectionFailure } from '../error.js';
import { KEY_BYTES } from './writer.js';

/** The bytes of a `u32`, a `u64` and an `i128`. */
const U32_BYTES = 4;
const U64_BYTES = 8;
const I128_BYTES = 16;

/** The bits of a `u64`, the high half of an `i128` shifted by them. */
const BITS_64 = 64n;
const BITS_128 = 128;

/**
 * How deep arrays, rows and multisets nest, of values and of types, as
 * turborel's `MAX_TYPE_NESTING`: deeper fails rather than recursing on.
 */
export const MAX_NESTING = 16;

/** Decodes UTF-8, failing on any octet that is not, and keeping a leading BOM as the character it is. */
const UTF8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

/** The fields of one message's body, read in order. */
export class Reader {
  private readonly bytes: Uint8Array;
  private readonly view: DataView;
  private readonly what: string;
  private at = 0;
  private depth = 0;

  /**
   * A reader of `bytes`, which hold a `what`, for messages.
   *
   * @param bytes - the body
   * @param what - what it is, as `reply` or `condition`
   */
  constructor(bytes: Uint8Array, what: string) {
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.what = what;
  }

  /**
   * The error of a malformed body, at the current byte.
   *
   * @param why - what is wrong
   * @returns a connection failure
   */
  corrupt(why: string): TurborelError {
    return connectionFailure(`a ${this.what} received is malformed at byte ${String(this.at)}: ${why}`);
  }

  /**
   * Where the next `n` bytes begin, and the reader past them.
   *
   * @param n - how many
   * @returns their offset
   * @throws {@link TurborelError} 08006 if fewer are left
   */
  private advance(n: number): number {
    const at = this.at;
    if (n > this.bytes.byteLength - at) throw this.corrupt('it ends too soon');
    this.at = at + n;
    return at;
  }

  /**
   * The next `n` bytes, copied, so a small field holds no large body.
   *
   * @param n - how many
   * @returns them
   */
  take(n: number): Uint8Array {
    const at = this.advance(n);
    return this.bytes.slice(at, at + n);
  }

  /** @returns the next `u8` */
  u8(): number {
    return this.view.getUint8(this.advance(1));
  }

  /** @returns the next `u32` */
  u32(): number {
    return this.view.getUint32(this.advance(U32_BYTES), true);
  }

  /** @returns the next `i32 as u32`, as the signed number */
  i32(): number {
    return this.view.getInt32(this.advance(U32_BYTES), true);
  }

  /** @returns the next `u64` */
  u64(): bigint {
    return this.view.getBigUint64(this.advance(U64_BYTES), true);
  }

  /** @returns the next `i64 as u64`, as the signed number */
  i64(): bigint {
    return this.view.getBigInt64(this.advance(U64_BYTES), true);
  }

  /** @returns the next `i128`, two's complement, least significant first */
  i128(): bigint {
    const at = this.advance(I128_BYTES);
    const low = this.view.getBigUint64(at, true);
    const high = this.view.getBigUint64(at + U64_BYTES, true);
    return BigInt.asIntN(BITS_128, (high << BITS_64) | low);
  }

  /**
   * The next flag.
   *
   * @returns true for 1, false for 0
   * @throws {@link TurborelError} 08006 for any other byte
   */
  flag(): boolean {
    const b = this.u8();
    if (b > 1) throw this.corrupt('a flag is neither 0 nor 1');
    return b === 1;
  }

  /** @returns the next bytes: their length, then them */
  bytesField(): Uint8Array {
    return this.take(this.u32());
  }

  /**
   * The next string.
   *
   * @returns it
   * @throws {@link TurborelError} 08006 if it is not UTF-8
   */
  string(): string {
    const octets = this.bytesField();
    try {
      return UTF8.decode(octets);
    } catch {
      throw this.corrupt('a string is not UTF-8');
    }
  }

  /** @returns the next key, 16 bytes with no length before them */
  key(): Uint8Array {
    return this.take(KEY_BYTES);
  }

  /**
   * A list: its count, then each item `item` reads. Nothing is reserved
   * for the count, so a false one fails as the body runs out
   * (`[PROTOCOL Values and fields]`).
   *
   * @param item - reads one item
   * @returns the items
   */
  list<T>(item: (reader: Reader) => T): T[] {
    const count = this.u32();
    const items: T[] = [];
    for (let i = 0; i < count; i += 1) items.push(item(this));
    return items;
  }

  /** @returns the next strings: a list of strings */
  strings(): string[] {
    return this.list((r) => r.string());
  }

  /**
   * `read` of a part nested within what is read, an array's element or a
   * row's field, no deeper than `MAX_NESTING`.
   *
   * @param read - reads the part
   * @returns what it read
   * @throws {@link TurborelError} 08006 if nested too deep
   */
  nested<T>(read: (reader: Reader) => T): T {
    if (this.depth >= MAX_NESTING) throw this.corrupt('its arrays and rows are nested too deep');
    this.depth += 1;
    try {
      return read(this);
    } finally {
      this.depth -= 1;
    }
  }

  /** @returns whether every byte was read */
  atEnd(): boolean {
    return this.at >= this.bytes.byteLength;
  }

  /** @returns the bytes left, all taken */
  rest(): Uint8Array {
    return this.take(this.bytes.byteLength - this.at);
  }

  /**
   * Checks that every byte was read.
   *
   * @throws {@link TurborelError} 08006 if bytes follow the last field
   */
  finish(): void {
    if (!this.atEnd()) throw this.corrupt('bytes follow its end');
  }
}
