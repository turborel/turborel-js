/**
 * A JSON value (`[PROTOCOL Values]`, value tag 25), carried as the binary
 * tree of Turborel's RULES.md D89 (CONFORMANCE.md G3): read and checked
 * by `json-tree.ts`, and written here as turborel's `binary/write.rs`
 * writes it, an exact number in the narrowest of its three forms and an
 * object's directory sorted by key octets.
 *
 * @packageDocumentation
 */

import { DecFloat } from './decfloat.js';
import { Decimal } from './decimal.js';
import {
  FORMAT_VERSION,
  JsonDamage,
  type JsonItem,
  JsonObject,
  MAX_DOCUMENT_OCTETS,
  MAX_JSON_NESTING,
  MOMENTS,
  NODE,
  WORD,
  compareEntries,
  decodeDocument,
} from './json-tree.js';
import { Datetime } from './values.js';
import { Writer } from './writer.js';
import { apiMisuse, beyondLimits } from '../error.js';

/** The bits of an `i64`, the narrow forms' units. */
const I64_BITS = 64;

/** The bytes of a double, and of a datetime's zone, an `i16`. */
const DOUBLE_BYTES = 8;
const ZONE_BYTES = 2;

/** The largest scale of the narrow decimal form, an octet. */
const MAX_NARROW_SCALE = 0xff;

/** Encodes text as UTF-8, for an object's keys. */
const UTF8 = new TextEncoder();

/**
 * What a JSON value is made of: a `JsonItem`, or a plain object or array
 * of them, its members in its properties' order.
 */
export type JsonInput = JsonItem | readonly JsonInput[] | { readonly [key: string]: JsonInput };

/** A JSON value: its stored form, checked whole, and the item it holds. */
export class Json {
  /** Its stored form: the version octet, then the tree. */
  readonly bytes: Uint8Array;

  /** @param bytes - a stored form already checked or written */
  private constructor(bytes: Uint8Array) {
    this.bytes = bytes;
  }

  /**
   * The JSON value of `input`.
   *
   * @param input - the item, or a plain object or array of items
   * @returns it, in its stored form
   * @throws {@link TurborelError} TB910 for a part no JSON item is; 0A000 past 128 levels or 256 MiB
   */
  static of(input: JsonInput): Json {
    const w = new Writer();
    w.u8(FORMAT_VERSION);
    writeNode(w, input, 0);
    if (w.length > MAX_DOCUMENT_OCTETS) throw beyondLimits('a JSON value is longer than 256 MiB');
    return new Json(w.finish());
  }

  /**
   * The JSON value of a stored form, checked whole.
   *
   * @param bytes - the stored form
   * @returns it
   * @throws JsonDamage if the octets are no document of the format
   */
  static ofBytes(bytes: Uint8Array): Json {
    decodeDocument(bytes);
    return new Json(bytes);
  }

  /** @returns the item it holds */
  item(): JsonItem {
    return decodeDocument(this.bytes);
  }
}

/**
 * Writes the node of `input`, within `depth` arrays and objects.
 *
 * @param w - the writer
 * @param input - what to write
 * @param depth - how deep it is
 */
function writeNode(w: Writer, input: unknown, depth: number): void {
  if (depth > MAX_JSON_NESTING) throw beyondLimits('arrays and objects of a JSON value nest too deep');
  if (Array.isArray(input)) {
    writeArray(w, input, depth + 1);
  } else if (input instanceof JsonObject) {
    writeObject(w, input.members, depth + 1);
  } else if (isPlainObject(input)) {
    writeObject(w, Object.entries(input), depth + 1);
  } else {
    writeScalar(w, input);
  }
}

/**
 * Whether `input` is a plain object, of `Object`'s prototype or none.
 *
 * @param input - what to write
 * @returns true if its properties are an object's members
 */
function isPlainObject(input: unknown): input is Readonly<Record<string, unknown>> {
  if (typeof input !== 'object' || input === null) return false;
  const proto: unknown = Object.getPrototypeOf(input);
  return proto === Object.prototype || proto === null;
}

/**
 * Writes the node of a scalar.
 *
 * @param w - the writer
 * @param item - the scalar
 * @throws {@link TurborelError} TB910 if it is no JSON item
 */
function writeScalar(w: Writer, item: unknown): void {
  if (item === null) w.u8(NODE.NULL);
  else if (typeof item === 'boolean') w.u8(item ? NODE.TRUE : NODE.FALSE);
  else if (typeof item === 'bigint') writeExact(w, new Decimal(item, 0));
  else if (item instanceof Decimal) writeExact(w, item);
  else if (item instanceof DecFloat) w.u8(NODE.DECFLOAT).i128(item.coefficient).i32(item.exponent);
  else if (typeof item === 'number') writeApproximate(w, item);
  else if (typeof item === 'string') w.u8(NODE.STRING).string(item);
  else if (item instanceof Datetime) writeDatetime(w, item);
  else throw apiMisuse('a part of a JSON value is no JSON item');
}

/**
 * Writes an approximate number: its double's bits.
 *
 * @param w - the writer
 * @param x - the number
 */
function writeApproximate(w: Writer, x: number): void {
  const bits = new DataView(new ArrayBuffer(DOUBLE_BYTES));
  bits.setFloat64(0, x, true);
  w.u8(NODE.APPROXIMATE).i64(bits.getBigInt64(0, true));
}

/**
 * Writes an exact number in the narrowest form that holds it.
 *
 * @param w - the writer
 * @param d - the number
 */
function writeExact(w: Writer, d: Decimal): void {
  const narrow = BigInt.asIntN(I64_BITS, d.units) === d.units;
  if (narrow && d.scale === 0) w.u8(NODE.INTEGER).i64(d.units);
  else if (narrow && d.scale <= MAX_NARROW_SCALE) w.u8(NODE.DECIMAL).i64(d.units).u8(d.scale);
  else w.u8(NODE.WIDE).i128(d.units).u32(d.scale);
}

/**
 * Writes a datetime: its moment, instant, zone, zoned flag and precision.
 *
 * @param w - the writer
 * @param d - the datetime
 */
function writeDatetime(w: Writer, d: Datetime): void {
  w.u8(NODE.DATETIME).u8(MOMENTS.indexOf(d.moment)).i64(d.utc);
  const zone = new DataView(new ArrayBuffer(ZONE_BYTES));
  zone.setInt16(0, d.zone, true);
  w.raw(new Uint8Array(zone.buffer)).flag(d.zoned).u8(d.precision);
}

/**
 * Reserves a container's head and offsets.
 *
 * @param w - the writer
 * @param tag - array or object
 * @param count - its elements or members
 * @returns where its size goes, and where its first offset is
 */
function open(w: Writer, tag: number, count: number): [number, number] {
  w.u8(tag);
  const head = w.length;
  w.u32(count).u32(0);
  const offsets = w.length;
  for (let i = 0; i < count; i += 1) w.u32(0);
  return [head + WORD, offsets];
}

/**
 * Writes an array: its elements, each offset filled as it is written.
 *
 * @param w - the writer
 * @param elements - its elements
 * @param depth - their depth
 */
function writeArray(w: Writer, elements: readonly unknown[], depth: number): void {
  const [size, offsets] = open(w, NODE.ARRAY, elements.length);
  const body = w.length;
  elements.forEach((element, i) => {
    w.patchU32(offsets + i * WORD, w.length - body);
    writeNode(w, element, depth);
  });
  w.patchU32(size, w.length - body);
}

/**
 * Writes an object: its members in the order given, then its directory
 * sorted by key octets, those of one key in that order.
 *
 * @param w - the writer
 * @param members - its members
 * @param depth - their depth
 */
function writeObject(w: Writer, members: readonly (readonly [string, unknown])[], depth: number): void {
  const [size, offsets] = open(w, NODE.OBJECT, members.length);
  const body = w.length;
  const directory: [Uint8Array, number][] = [];
  for (const [key, value] of members) {
    directory.push([UTF8.encode(key), w.length - body]);
    w.string(key);
    writeNode(w, value, depth);
  }
  directory.sort(compareEntries);
  directory.forEach(([, at], i) => {
    w.patchU32(offsets + i * WORD, at);
  });
  w.patchU32(size, w.length - body);
}

export { JsonDamage, JsonObject };
export type { JsonItem };
