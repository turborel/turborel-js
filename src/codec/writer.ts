/**
 * The fields of a message written: integers little-endian, strings and
 * bytes their length then their octets, lists their count then each item
 * (`[PROTOCOL Values and fields]`). Internal.
 *
 * @packageDocumentation
 */

import { SQLSTATE_NOT_IN_REPERTOIRE, SQLSTATE_NUMERIC_OUT_OF_RANGE, apiMisuse, dataException } from '../error.js';

/** The bytes a buffer starts with; it doubles as it fills. */
const INITIAL_BYTES = 256;

/** How much a full buffer grows by. */
const GROWTH = 2;

/** The largest octet. */
const U8_MAX = 0xff;
/** The largest `u32`. */
const U32_MAX = 0xffff_ffff;
/** The least and the largest `i32`. */
const I32_MIN = -0x8000_0000;
const I32_MAX = 0x7fff_ffff;

/** The bits of the 64-bit and 128-bit fields, for range checks. */
const BITS_64 = 64;
const BITS_128 = 128;

/** The bytes of a `u32`, a `u64` and an `i128`. */
const U32_BYTES = 4;
const U64_BYTES = 8;
const I128_BYTES = 16;

/** The bytes of a key, with no length before them. */
export const KEY_BYTES = 16;

/** The mask of a `u64`'s bits, which splits an `i128` into its halves. */
const U64_MASK = (1n << BigInt(BITS_64)) - 1n;

/** Encodes text as UTF-8. */
const UTF8 = new TextEncoder();

/**
 * Whether `n` is an integer from `min` to `max`.
 *
 * @param n - the number
 * @param min - the least it may be
 * @param max - the largest it may be
 * @returns true if it is
 */
function within(n: number, min: number, max: number): boolean {
  return Number.isInteger(n) && n >= min && n <= max;
}

/** A message's body, written field by field. */
export class Writer {
  private buffer = new Uint8Array(INITIAL_BYTES);
  private view = new DataView(this.buffer.buffer);
  private at = 0;

  /** The bytes written so far. */
  get length(): number {
    return this.at;
  }

  /**
   * Room for `n` more bytes, the buffer grown if it lacks it. A caller
   * takes the offset before touching the buffer or its view, as growing
   * replaces both.
   *
   * @param n - the bytes about to be written
   * @returns where they go
   */
  private reserve(n: number): number {
    const at = this.at;
    if (at + n > this.buffer.byteLength) {
      let size = this.buffer.byteLength * GROWTH;
      while (size < at + n) size *= GROWTH;
      const grown = new Uint8Array(size);
      grown.set(this.buffer.subarray(0, at));
      this.buffer = grown;
      this.view = new DataView(grown.buffer);
    }
    this.at = at + n;
    return at;
  }

  /**
   * A `u8`.
   *
   * @param n - an octet
   * @returns this writer
   * @throws {@link TurborelError} TB910 if `n` is no octet
   */
  u8(n: number): this {
    if (!within(n, 0, U8_MAX)) throw apiMisuse(`${String(n)} is no octet`);
    const at = this.reserve(1);
    this.view.setUint8(at, n);
    return this;
  }

  /**
   * A `u32`.
   *
   * @param n - an unsigned 32-bit integer
   * @returns this writer
   * @throws {@link TurborelError} TB910 if `n` is no u32
   */
  u32(n: number): this {
    if (!within(n, 0, U32_MAX)) throw apiMisuse(`${String(n)} is no u32`);
    const at = this.reserve(U32_BYTES);
    this.view.setUint32(at, n, true);
    return this;
  }

  /**
   * An `i32 as u32`: the signed number's bits.
   *
   * @param n - a signed 32-bit integer
   * @returns this writer
   * @throws {@link TurborelError} TB910 if `n` is no i32
   */
  i32(n: number): this {
    if (!within(n, I32_MIN, I32_MAX)) throw apiMisuse(`${String(n)} is no i32`);
    const at = this.reserve(U32_BYTES);
    this.view.setInt32(at, n, true);
    return this;
  }

  /**
   * A `u64`.
   *
   * @param n - an unsigned 64-bit integer
   * @returns this writer
   * @throws {@link TurborelError} TB910 if `n` is no u64
   */
  u64(n: bigint): this {
    if (BigInt.asUintN(BITS_64, n) !== n) throw apiMisuse(`${String(n)} is no u64`);
    const at = this.reserve(U64_BYTES);
    this.view.setBigUint64(at, n, true);
    return this;
  }

  /**
   * An `i64 as u64`: the signed number's bits.
   *
   * @param n - a signed 64-bit integer
   * @returns this writer
   * @throws {@link TurborelError} TB910 if `n` is no i64
   */
  i64(n: bigint): this {
    if (BigInt.asIntN(BITS_64, n) !== n) throw apiMisuse(`${String(n)} is no i64`);
    const at = this.reserve(U64_BYTES);
    this.view.setBigInt64(at, n, true);
    return this;
  }

  /**
   * An `i128`, two's complement, least significant first.
   *
   * @param n - a signed 128-bit integer
   * @returns this writer
   * @throws {@link TurborelError} 22003 if `n` is no i128
   */
  i128(n: bigint): this {
    if (BigInt.asIntN(BITS_128, n) !== n) {
      throw dataException(SQLSTATE_NUMERIC_OUT_OF_RANGE, `${String(n)} is past the 128 bits the protocol carries`);
    }
    const bits = BigInt.asUintN(BITS_128, n);
    const at = this.reserve(I128_BYTES);
    this.view.setBigUint64(at, bits & U64_MASK, true);
    this.view.setBigUint64(at + U64_BYTES, bits >> BigInt(BITS_64), true);
    return this;
  }

  /**
   * A flag: 1 if `set`, else 0.
   *
   * @param set - the truth to write
   * @returns this writer
   */
  flag(set: boolean): this {
    return this.u8(set ? 1 : 0);
  }

  /**
   * Octets as they are, with no length before them.
   *
   * @param bytes - the octets
   * @returns this writer
   */
  raw(bytes: Uint8Array): this {
    // Reserved first: reserving may replace the buffer.
    const at = this.reserve(bytes.byteLength);
    this.buffer.set(bytes, at);
    return this;
  }

  /**
   * Bytes: their length, a `u32`, then the bytes.
   *
   * @param bytes - the octets
   * @returns this writer
   */
  bytes(bytes: Uint8Array): this {
    return this.u32(bytes.byteLength).raw(bytes);
  }

  /**
   * A string: its length in bytes, a `u32`, then its UTF-8.
   *
   * @param text - the string
   * @returns this writer
   * @throws {@link TurborelError} 22021 if it holds a lone surrogate, which no UTF-8 writes
   */
  string(text: string): this {
    if (!text.isWellFormed()) {
      throw dataException(SQLSTATE_NOT_IN_REPERTOIRE, 'a string holds a lone surrogate, which is no Unicode character');
    }
    return this.bytes(UTF8.encode(text));
  }

  /**
   * A key: exactly 16 bytes, with no length before them.
   *
   * @param key - the key's octets
   * @returns this writer
   * @throws {@link TurborelError} TB910 if it is not 16 bytes
   */
  key(key: Uint8Array): this {
    if (key.byteLength !== KEY_BYTES)
      throw apiMisuse(`a key is ${String(KEY_BYTES)} bytes, not ${String(key.byteLength)}`);
    return this.raw(key);
  }

  /**
   * A list: its count, a `u32`, then each item written by `item`.
   *
   * @param items - the items
   * @param item - writes one item
   * @returns this writer
   */
  list<T>(items: readonly T[], item: (writer: Writer, value: T) => void): this {
    this.u32(items.length);
    for (const value of items) item(this, value);
    return this;
  }

  /**
   * Strings: a list of strings.
   *
   * @param texts - the strings
   * @returns this writer
   */
  strings(texts: readonly string[]): this {
    return this.list(texts, (w, text) => w.string(text));
  }

  /**
   * Writes a `u32` over four bytes written before, at `at`.
   *
   * @param at - where they are
   * @param n - the u32
   */
  patchU32(at: number, n: number): void {
    if (!within(n, 0, U32_MAX)) throw apiMisuse(`${String(n)} is no u32`);
    this.view.setUint32(at, n, true);
  }

  /**
   * The bytes written, copied out.
   *
   * @returns them
   */
  finish(): Uint8Array {
    return this.buffer.slice(0, this.at);
  }
}
