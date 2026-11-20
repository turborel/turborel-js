/**
 * The protocol's values read and written (`[PROTOCOL Values]`): a tag,
 * then its body, as turborel-protocol's `fields.rs` writes them. A value's
 * tag says how it is written, so a CHARACTER VARYING value goes as tag 1.
 *
 * @packageDocumentation
 */

import { DecFloat } from './decfloat.js';
import { Decimal } from './decimal.js';
import { Json, type JsonDamage } from './json.js';
import type { Reader } from './reader.js';
import * as tag from './tags.js';
import { readName, readQualifier, writeQualifier } from './types.js';
import {
  Datetime,
  Interval,
  Lob,
  LobLocator,
  type LobKind,
  type Moment,
  Multiset,
  PluginValue,
  Reference,
  SqlRow,
  Structured,
  UUID_OCTETS,
  Uuid,
  type Value,
  Xml,
} from './values.js';
import type { Writer } from './writer.js';
import { TurborelError, apiMisuse } from '../error.js';

/** The largest displacement field, a `u16`'s bits in the low half of a `u32`. */
const MAX_ZONE_FIELD = 0xffff;

/** The bits of a displacement, an `i16`. */
const ZONE_BITS = 16;

/** The bytes of a double. */
const DOUBLE_BYTES = 8;

/** The tag of each moment's value. */
const MOMENT_TAGS: Readonly<Record<Moment, number>> = { date: tag.DATE, time: tag.TIME, timestamp: tag.TIMESTAMP };

/** A scratch view a double's bits pass through. */
const DOUBLE = new DataView(new ArrayBuffer(DOUBLE_BYTES));

/**
 * Writes a list of values: their count, then each.
 *
 * @param w - the writer
 * @param values - the values
 */
export function writeValues(w: Writer, values: readonly Value[]): void {
  w.list(values, writeValue);
}

/**
 * Reads a list of values: their count, then each.
 *
 * @param r - the reader
 * @returns the values
 */
export function readValues(r: Reader): Value[] {
  return r.list(readValue);
}

/**
 * Writes a value: its tag, then its body.
 *
 * @param w - the writer
 * @param v - the value
 * @throws {@link TurborelError} TB910 for a JavaScript value the protocol carries no value of
 */
export function writeValue(w: Writer, v: Value): void {
  if (v === null) w.u8(tag.NULL);
  else if (typeof v === 'string') w.u8(tag.CHARACTER).string(v);
  else if (typeof v === 'bigint') w.u8(tag.EXACT).i128(v).u32(0);
  else if (typeof v === 'number') writeApproximate(w, v);
  else if (typeof v === 'boolean') w.u8(tag.BOOLEAN).flag(v);
  else if (v instanceof Uint8Array) w.u8(tag.BINARY).bytes(v);
  else if (Array.isArray(v)) writeList(w, tag.ARRAY, v);
  else if (typeof v === 'object') writeObject(w, v);
  else throw apiMisuse(`a value of type ${typeof v} is no value the protocol carries`);
}

/**
 * Writes an approximate number: its double's bits.
 *
 * @param w - the writer
 * @param x - the number
 */
function writeApproximate(w: Writer, x: number): void {
  DOUBLE.setFloat64(0, x, true);
  w.u8(tag.APPROXIMATE).u64(DOUBLE.getBigUint64(0, true));
}

/**
 * Writes a constructed value's tag and its parts.
 *
 * @param w - the writer
 * @param t - its tag
 * @param parts - its elements or fields
 */
function writeList(w: Writer, t: number, parts: readonly Value[]): void {
  writeValues(w.u8(t), parts);
}

/**
 * Writes a value of one of the driver's classes.
 *
 * @param w - the writer
 * @param v - the value
 */
function writeObject(w: Writer, v: object): void {
  if (v instanceof Decimal) w.u8(tag.EXACT).i128(v.units).u32(v.scale);
  else if (v instanceof DecFloat) w.u8(tag.DECFLOAT).i128(v.coefficient).i32(v.exponent);
  else if (v instanceof Datetime) writeDatetime(w, v);
  else if (v instanceof Interval) writeInterval(w, v);
  else if (v instanceof SqlRow) writeList(w, tag.ROW, v.values);
  else if (v instanceof Multiset) writeList(w, tag.MULTISET, v.elements);
  else if (v instanceof Lob) writeLob(w, v);
  else if (v instanceof LobLocator) writeLocator(w, v);
  else writeOther(w, v);
}

/**
 * Writes a value of the classes `writeObject` leaves.
 *
 * @param w - the writer
 * @param v - the value
 */
function writeOther(w: Writer, v: object): void {
  if (v instanceof Structured)
    writeValues(w.u8(tag.STRUCTURED).string(v.type.schema).string(v.type.name), v.attributes);
  else if (v instanceof Reference) w.u8(tag.REFERENCE).bytes(v.octets);
  else if (v instanceof Json) w.u8(tag.JSON_TAG).bytes(v.bytes);
  else if (v instanceof Xml) w.u8(tag.XML).string(v.text);
  else if (v instanceof Uuid) w.u8(tag.UUID).bytes(v.octets);
  else if (v instanceof PluginValue) w.u8(tag.PLUGIN).string(v.typeName).string(v.text).bytes(v.octets);
  else throw apiMisuse(`a ${v.constructor.name} is no value the protocol carries`);
}

/**
 * Writes a datetime: zoned, precision, displacement and instant.
 *
 * @param w - the writer
 * @param d - the datetime
 */
function writeDatetime(w: Writer, d: Datetime): void {
  w.u8(MOMENT_TAGS[d.moment]).flag(d.zoned).u8(d.precision);
  w.u32(d.zone & MAX_ZONE_FIELD).i64(d.utc);
}

/**
 * Writes an interval: its qualifier as the INTERVAL type writes it, then its units.
 *
 * @param w - the writer
 * @param i - the interval
 */
function writeInterval(w: Writer, i: Interval): void {
  writeQualifier(w.u8(tag.INTERVAL), i.qualifier);
  w.i128(i.units);
}

/**
 * The octet of a large object's kind.
 *
 * @param kind - character or binary
 * @returns it
 */
function lobKindOctet(kind: LobKind): number {
  return kind === 'character' ? tag.LOB_CHARACTER : tag.LOB_BINARY;
}

/**
 * Writes a large object held whole: its kind, then its octets.
 *
 * @param w - the writer
 * @param l - the large object
 */
function writeLob(w: Writer, l: Lob): void {
  w.u8(tag.LOB_WHOLE).u8(lobKindOctet(l.kind));
  if (typeof l.data === 'string') w.string(l.data);
  else w.bytes(l.data);
}

/**
 * Writes a large object by its locator: its kind, locator, octets and characters.
 *
 * @param w - the writer
 * @param l - the locator's value
 */
function writeLocator(w: Writer, l: LobLocator): void {
  w.u8(tag.LOB_LOCATOR).u8(lobKindOctet(l.kind)).u32(l.locator).u64(l.octets).u64(l.characters);
}

/**
 * Reads a large object's kind.
 *
 * @param r - the reader
 * @returns character or binary
 */
function readLobKind(r: Reader): LobKind {
  const kind = r.u8();
  if (kind > tag.LOB_BINARY) throw r.corrupt('not a kind of large object');
  return kind === tag.LOB_CHARACTER ? 'character' : 'binary';
}

/**
 * Reads a datetime of `moment`: zoned, precision, displacement and instant.
 *
 * @param r - the reader
 * @param moment - which moment its tag says
 * @returns it
 */
function readDatetime(r: Reader, moment: Moment): Datetime {
  const zoned = r.u8() === 1;
  const precision = r.u8();
  const field = r.u32();
  if (field > MAX_ZONE_FIELD) throw r.corrupt('a time zone displacement is out of range');
  return new Datetime({ moment, zoned, precision, zone: toI16(field), utc: r.i64() });
}

/**
 * The `i16` whose bits are `field`.
 *
 * @param field - the low half of a `u32`
 * @returns the signed displacement
 */
function toI16(field: number): number {
  return Number(BigInt.asIntN(ZONE_BITS, BigInt(field)));
}

/**
 * Reads an exact number: a `bigint` of scale 0, else a `Decimal` (RULES.md D11).
 *
 * @param r - the reader
 * @returns it
 */
function readExact(r: Reader): bigint | Decimal {
  const units = r.i128();
  const scale = r.u32();
  return scale === 0 ? units : new Decimal(units, scale);
}

/**
 * Reads a DECFLOAT, in its one form alone.
 *
 * @param r - the reader
 * @returns it
 */
function readDecFloat(r: Reader): DecFloat {
  const d = DecFloat.ofCanonical(r.i128(), r.i32());
  if (d === undefined) throw r.corrupt('a DECFLOAT value is malformed');
  return d;
}

/**
 * Reads a large object held whole: a CLOB's octets UTF-8, a BLOB's any.
 *
 * @param r - the reader
 * @returns it
 */
function readLob(r: Reader): Lob {
  return new Lob(readLobKind(r) === 'character' ? r.string() : r.bytesField());
}

/**
 * Reads a JSON value, its tree checked whole.
 *
 * @param r - the reader
 * @returns it
 */
function readJson(r: Reader): Json {
  const bytes = r.bytesField();
  try {
    return Json.ofBytes(bytes);
  } catch (e) {
    // Json.ofBytes throws JsonDamage, or 0A000 past a limit, given as it is.
    if (e instanceof TurborelError) throw e;
    throw r.damaged(`a JSON value's octets are damaged: ${(e as JsonDamage).message}`);
  }
}

/**
 * Reads a UUID: bytes, a count of 16, then the octets.
 *
 * @param r - the reader
 * @returns it
 */
function readUuid(r: Reader): Uuid {
  const octets = r.bytesField();
  if (octets.byteLength !== UUID_OCTETS) throw r.corrupt('a UUID is 16 octets');
  return new Uuid(octets);
}

/**
 * Reads a multiset, of at most 65,535 elements.
 *
 * @param r - the reader
 * @returns it
 */
function readMultiset(r: Reader): Multiset {
  const elements = readValues(r);
  if (elements.length > tag.MAX_CARDINALITY) {
    throw r.corrupt('a multiset has more elements than its maximum cardinality');
  }
  return new Multiset(elements);
}

/** How each value tag's body is read. */
const READERS: Readonly<Partial<Record<number, (r: Reader) => Value>>> = {
  [tag.NULL]: () => null,
  [tag.CHARACTER]: (r) => r.string(),
  // Tags 5, 7, 10 and 12, of the types beside 1, 6, 9 and 11, are read as
  // theirs, as turborel-protocol's reader takes them (RULES.md D8).
  [tag.VARYING]: (r) => r.string(),
  [tag.EXACT]: readExact,
  [tag.APPROXIMATE]: (r) => {
    DOUBLE.setBigUint64(0, r.u64(), true);
    return DOUBLE.getFloat64(0, true);
  },
  [tag.PLUGIN]: (r) => new PluginValue(r.string(), r.string(), r.bytesField()),
  [tag.BINARY]: (r) => r.bytesField(),
  [tag.BINARY_VARYING]: (r) => r.bytesField(),
  [tag.DATE]: (r) => readDatetime(r, 'date'),
  [tag.TIME]: (r) => readDatetime(r, 'time'),
  [tag.TIME_ZONED]: (r) => readDatetime(r, 'time'),
  [tag.TIMESTAMP]: (r) => readDatetime(r, 'timestamp'),
  [tag.TIMESTAMP_ZONED]: (r) => readDatetime(r, 'timestamp'),
  [tag.INTERVAL]: (r) => new Interval(readQualifier(r), r.i128()),
  [tag.BOOLEAN]: (r) => {
    const b = r.u8();
    if (b > 1) throw r.damaged(`${String(b)} is not a truth value`);
    return b === 1;
  },
  [tag.DECFLOAT]: readDecFloat,
  [tag.ARRAY]: (r) => r.nested(readValues),
  [tag.ROW]: (r) => r.nested((n) => new SqlRow(readValues(n))),
  [tag.LOB_WHOLE]: readLob,
  [tag.LOB_LOCATOR]: (r) => {
    const kind = readLobKind(r);
    const locator = r.u32();
    return new LobLocator(kind, locator, { octets: r.u64(), characters: r.u64() });
  },
  [tag.MULTISET]: (r) => r.nested(readMultiset),
  [tag.STRUCTURED]: (r) => r.nested((n) => new Structured(readName(n), readValues(n))),
  [tag.REFERENCE]: (r) => new Reference(r.bytesField()),
  [tag.JSON_TAG]: readJson,
  [tag.XML]: (r) => new Xml(r.string()),
  [tag.UUID]: readUuid,
};

/**
 * Reads a value: its tag, then its body.
 *
 * @param r - the reader
 * @returns it
 * @throws {@link TurborelError} 08006 for a tag of no value, or a body cut short; TB916 for a body its reader cannot take, the message read whole, tags 18 and 19 among them
 */
export function readValue(r: Reader): Value {
  const t = r.u8();
  const read = READERS[t];
  if (t === tag.CLOB || t === tag.BLOB) {
    // The server's stored form of a large object, never sent (RULES.md D8).
    throw r.damaged(`value tag ${String(t)} is a large object's stored form, which no reply carries`);
  }
  if (read === undefined) throw r.corrupt('no value has this tag');
  return read(r);
}
