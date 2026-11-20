/**
 * A message's tail (`[PROTOCOL The tail]`): the fields a message of
 * version 1's first form gained, each a tag octet and its field, in
 * increasing order of tag, to the end of the body. A message with an
 * empty tail is its first form exactly. Internal.
 *
 * @packageDocumentation
 */

import type { Reader } from './reader.js';
import type { Writer } from './writer.js';
import { apiMisuse } from '../error.js';

/** Tag 1: attributes, of Hello, Query and Execute. */
export const ATTRIBUTES = 1;
/** Tag 2: multi, of Query. */
export const MULTI = 2;
/** Tag 3: cursor, of Execute, Fetch and Close. */
export const CURSOR = 3;
/** Tag 4: position, of Complete. */
export const POSITION = 4;
/** Tag 5: more, of Complete. */
export const MORE = 5;
/** Tag 6: rows, of Complete. */
export const ROWS = 6;
/** Tag 7, the first of a failure's and a Notice's diagnostics: severity. */
export const SEVERITY = 7;
/** Tag 15, the last of the diagnostics: constraint. */
export const CONSTRAINT = 15;
/** Tag 16: generated, of Complete. */
export const GENERATED = 16;
/** Tag 17: conditions, of Complete. */
export const CONDITIONS = 17;
/** Tag 18: time, of Complete. */
export const TIME = 18;

/** The most attributes a message takes. */
export const MAX_ATTRIBUTES = 32;
/** The longest name of an attribute, in bytes; the shortest is 1. */
export const MAX_ATTRIBUTE_NAME = 64;
/** The longest value of an attribute, in bytes. */
export const MAX_ATTRIBUTE_VALUE = 1024;

/** An attribute: its name and its value. */
export type Attribute = readonly [name: string, value: string];

/** Encodes text as UTF-8, to measure an attribute in bytes. */
const UTF8 = new TextEncoder();

/**
 * Whether an attribute's name and value are within their bounds.
 *
 * @param attribute - the name and the value
 * @returns true if the name is 1 to 64 bytes and the value at most 1024
 */
function attributeFits([name, value]: Attribute): boolean {
  const n = UTF8.encode(name).byteLength;
  return n >= 1 && n <= MAX_ATTRIBUTE_NAME && UTF8.encode(value).byteLength <= MAX_ATTRIBUTE_VALUE;
}

/**
 * Writes tag 1 and `attributes`, unless there are none.
 *
 * @param w - the writer
 * @param attributes - each name and value
 * @throws {@link TurborelError} TB910 past 32 attributes, or one past its bounds, which the server would refuse
 */
export function writeAttributes(w: Writer, attributes: readonly Attribute[]): void {
  if (attributes.length === 0) return;
  if (attributes.length > MAX_ATTRIBUTES || !attributes.every(attributeFits)) {
    throw apiMisuse(
      `a message takes at most ${String(MAX_ATTRIBUTES)} attributes, each name 1 to ${String(MAX_ATTRIBUTE_NAME)} bytes and value at most ${String(MAX_ATTRIBUTE_VALUE)}`,
    );
  }
  w.u8(ATTRIBUTES).list(attributes, (writer, [name, value]) => writer.string(name).string(value));
}

/**
 * Writes `tag` and a u32 `n`, unless `n` is 0, the field's first form.
 *
 * @param w - the writer
 * @param tag - the tag
 * @param n - the number
 */
export function writeNumber(w: Writer, tag: number, n: number): void {
  if (n !== 0) w.u8(tag).u32(n);
}

/**
 * Writes `tag` alone, if `set`.
 *
 * @param w - the writer
 * @param tag - the tag
 * @param set - whether the field is there
 */
export function writeMark(w: Writer, tag: number, set: boolean): void {
  if (set) w.u8(tag);
}

/**
 * Writes `tag` and a string, if there is one.
 *
 * @param w - the writer
 * @param tag - the tag
 * @param text - the string, if any
 */
export function writeText(w: Writer, tag: number, text: string | undefined): void {
  if (text !== undefined) w.u8(tag).string(text);
}

/** The tags of a tail, read in order: each one the message takes, past the last. */
export class Tail {
  private last = 0;
  private readonly taken: readonly number[];

  /** @param taken - the tags the message takes */
  constructor(taken: readonly number[]) {
    this.taken = taken;
  }

  /**
   * The next tag, none at the end of the body.
   *
   * @param r - the reader
   * @returns the tag, or undefined at the end
   * @throws {@link TurborelError} 08006 for a tag not past the last, or one the message does not take
   */
  next(r: Reader): number | undefined {
    if (r.atEnd()) return undefined;
    const tag = r.u8();
    if (tag <= this.last || !this.taken.includes(tag)) throw r.corrupt(`its tail has tag ${String(tag)} out of place`);
    this.last = tag;
    return tag;
  }
}
