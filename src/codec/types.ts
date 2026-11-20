/**
 * The protocol's data types (`[PROTOCOL Data types]`): a tag, then what its
 * kind writes after it, read and written as turborel-protocol's
 * `fields.rs` does. A distinct type comes as its source type.
 *
 * @packageDocumentation
 */

import type { TurborelError } from '../error.js';
import type { Reader } from './reader.js';
import * as tag from './tags.js';
import type { Writer } from './writer.js';

/** What a character type's length counts. */
export type CharUnits = 'characters' | 'octets';

/** A field of an interval, `YEAR` to `SECOND`. */
export type IntervalField = (typeof tag.INTERVAL_FIELDS)[number];

/** An interval's qualifier: its fields and their precisions. */
export interface Qualifier {
  /** Its most significant field. */
  readonly start: IntervalField;
  /** Its least significant field. */
  readonly end: IntervalField;
  /** Its leading field's precision. */
  readonly leading: number;
  /** Its fractional seconds' precision. */
  readonly fraction: number;
}

/** A user-defined type's name: its schema and name. */
export interface TypeName {
  /** The schema it is in. */
  readonly schema: string;
  /** Its name. */
  readonly name: string;
}

/** A structured type's name and its proper supertypes' names. */
export interface StructuredName extends TypeName {
  /** Its proper supertypes, nearest first. */
  readonly supertypes: readonly TypeName[];
}

/** The registered XML Schema a type of XMLSCHEMA names. */
export interface XmlSchemaName extends TypeName {
  /** The namespace it names, if any. */
  readonly namespace?: string;
  /** The element it names, if any. */
  readonly element?: string;
}

/** A field of a row type. */
export interface RowField {
  /** Its name. */
  readonly name: string;
  /** Its type. */
  readonly type: DataType;
}

/** A data type, as the protocol describes a column, a parameter or a type within another. */
export type DataType =
  | { readonly kind: 'character' | 'varying'; readonly length: number; readonly units: CharUnits }
  | { readonly kind: 'exact'; readonly precision: number; readonly scale: number }
  | { readonly kind: 'approximate' | 'decfloat' | 'date'; readonly precision: number }
  | { readonly kind: 'time' | 'timestamp'; readonly precision: number; readonly zoned: boolean }
  | { readonly kind: 'plugin'; readonly name: string; readonly parameters: readonly number[] }
  | { readonly kind: 'binary' | 'varbinary'; readonly length: number }
  | { readonly kind: 'interval'; readonly qualifier: Qualifier }
  | { readonly kind: 'boolean' | 'json' | 'uuid' }
  | { readonly kind: 'array'; readonly maxCardinality: number; readonly element: DataType }
  | { readonly kind: 'multiset'; readonly element: DataType }
  | { readonly kind: 'row'; readonly fields: readonly RowField[] }
  | { readonly kind: 'clob' | 'blob'; readonly length: bigint; readonly units: CharUnits }
  | { readonly kind: 'structured'; readonly name: StructuredName }
  | { readonly kind: 'reference'; readonly referenced: StructuredName; readonly scope?: TypeName }
  | {
      readonly kind: 'xml';
      readonly primary: (typeof tag.XML_PRIMARY)[number];
      readonly secondary: 'untyped' | 'any';
    }
  | {
      readonly kind: 'xml';
      readonly primary: 'document' | 'content';
      readonly secondary: 'xmlschema';
      readonly schema: XmlSchemaName;
    };

/**
 * Writes a character type's units.
 *
 * @param w - the writer
 * @param units - characters or octets
 */
function writeUnits(w: Writer, units: CharUnits): void {
  w.u8(units === 'octets' ? tag.UNITS_OCTETS : tag.UNITS_CHARACTERS);
}

/**
 * Reads a character type's units.
 *
 * @param r - the reader
 * @returns characters or octets
 */
function readUnits(r: Reader): CharUnits {
  const b = r.u8();
  if (b > tag.UNITS_OCTETS) throw r.corrupt('a length counts characters, 0, or octets, 1');
  return b === tag.UNITS_OCTETS ? 'octets' : 'characters';
}

/**
 * Writes an interval's qualifier: its fields' numbers, then its precisions.
 *
 * @param w - the writer
 * @param q - the qualifier
 */
export function writeQualifier(w: Writer, q: Qualifier): void {
  w.u32(tag.INTERVAL_FIELDS.indexOf(q.start)).u32(tag.INTERVAL_FIELDS.indexOf(q.end)).u32(q.leading).u32(q.fraction);
}

/**
 * Reads an interval's qualifier.
 *
 * @param r - the reader
 * @returns it
 * @throws {@link TurborelError} 08006 if a field's number is past SECOND
 */
export function readQualifier(r: Reader): Qualifier {
  const [start, end] = [tag.INTERVAL_FIELDS[r.u32()], tag.INTERVAL_FIELDS[r.u32()]];
  const [leading, fraction] = [r.u32(), r.u32()];
  if (start === undefined || end === undefined) throw r.corrupt("an interval's field is out of range");
  return { start, end, leading, fraction };
}

/**
 * Writes a type's name.
 *
 * @param w - the writer
 * @param n - its schema and name
 */
function writeName(w: Writer, n: TypeName): void {
  w.string(n.schema).string(n.name);
}

/**
 * Reads a type's name.
 *
 * @param r - the reader
 * @returns its schema and name
 */
export function readName(r: Reader): TypeName {
  return { schema: r.string(), name: r.string() };
}

/**
 * Writes a structured type's name and its supertypes' names.
 *
 * @param w - the writer
 * @param n - the names
 */
function writeStructured(w: Writer, n: StructuredName): void {
  writeName(w, n);
  w.list(n.supertypes, writeName);
}

/**
 * Reads a structured type's names.
 *
 * @param r - the reader
 * @returns them
 */
function readStructured(r: Reader): StructuredName {
  const name = readName(r);
  return { ...name, supertypes: r.list(readName) };
}

/**
 * Writes an optional string, after a flag of 1, or the flag 0 alone.
 *
 * @param w - the writer
 * @param text - the string, if any
 */
function writeOptional(w: Writer, text: string | undefined): void {
  w.flag(text !== undefined);
  if (text !== undefined) w.string(text);
}

/**
 * Reads an optional string, as `writeOptional` writes one.
 *
 * @param r - the reader
 * @returns it, or undefined
 */
function readOptional(r: Reader): string | undefined {
  return r.flag() ? r.string() : undefined;
}

/**
 * Writes an XML type: its modifiers, then the XML Schema of XMLSCHEMA.
 *
 * @param w - the writer
 * @param t - the type
 */
function writeXml(w: Writer, t: Extract<DataType, { kind: 'xml' }>): void {
  w.u8(tag.XML_PRIMARY.indexOf(t.primary)).u8(tag.XML_SECONDARY.indexOf(t.secondary));
  if (t.secondary !== 'xmlschema') return;
  writeName(w, t.schema);
  writeOptional(w, t.schema.namespace);
  writeOptional(w, t.schema.element);
}

/**
 * Reads an XML type's modifiers, and the XML Schema of XMLSCHEMA.
 *
 * @param r - the reader
 * @returns the type
 * @throws {@link TurborelError} 08006 for a modifier of no meaning, or SEQUENCE typed
 */
function readXml(r: Reader): DataType {
  const [primary, secondary] = [tag.XML_PRIMARY[r.u8()], tag.XML_SECONDARY[r.u8()]];
  if (secondary === undefined) throw r.corrupt("an XML type's secondary modifier has no meaning");
  if (secondary !== 'xmlschema') {
    if (primary === undefined || (primary === 'sequence' && secondary === 'any')) throw noPrimary(r);
    return { kind: 'xml', primary, secondary };
  }
  const name = readName(r);
  const namespace = readOptional(r);
  const element = readOptional(r);
  if (primary === undefined || primary === 'sequence') throw noPrimary(r);
  const schema = {
    ...name,
    ...(namespace === undefined ? {} : { namespace }),
    ...(element === undefined ? {} : { element }),
  };
  return { kind: 'xml', primary, secondary, schema };
}

/**
 * The failure of an XML type whose primary modifier has no meaning, or none with its secondary.
 *
 * @param r - the reader
 * @returns the connection failure
 */
function noPrimary(r: Reader): TurborelError {
  return r.corrupt("an XML type's primary modifier has no meaning");
}

/**
 * Writes a plug-in's type: its name, then its parameters.
 *
 * @param w - the writer
 * @param t - the type
 */
function writePlugin(w: Writer, t: Extract<DataType, { kind: 'plugin' }>): void {
  w.string(t.name).list(t.parameters, (writer, p) => writer.u32(p));
}

/**
 * Reads a plug-in's type: at most two parameters, none `u32::MAX`, as
 * turborel's `TypeParams` holds them.
 *
 * @param r - the reader
 * @returns the type
 */
function readPlugin(r: Reader): DataType {
  const name = r.string();
  const parameters = r.list((reader) => reader.u32());
  if (parameters.length > tag.MAX_PLUGIN_PARAMETERS || parameters.includes(tag.ABSENT_PARAMETER)) {
    throw r.corrupt('a type has too many parameters');
  }
  return { kind: 'plugin', name, parameters };
}

/**
 * Writes the reference type `t`: its referenced type's names, then its scope.
 *
 * @param w - the writer
 * @param t - the type
 */
function writeReference(w: Writer, t: Extract<DataType, { kind: 'reference' }>): void {
  writeStructured(w, t.referenced);
  w.flag(t.scope !== undefined);
  if (t.scope !== undefined) writeName(w, t.scope);
}

/**
 * Reads a reference type.
 *
 * @param r - the reader
 * @returns it
 */
function readReference(r: Reader): DataType {
  const referenced = readStructured(r);
  const scope = r.flag() ? readName(r) : undefined;
  return { kind: 'reference', referenced, ...(scope === undefined ? {} : { scope }) };
}

/**
 * Writes the constructed type `t`: an array, a multiset or a row.
 *
 * @param w - the writer
 * @param t - the type
 */
function writeConstructed(w: Writer, t: Extract<DataType, { kind: 'array' | 'multiset' | 'row' }>): void {
  switch (t.kind) {
    case 'array':
      w.u8(tag.ARRAY).u32(t.maxCardinality);
      writeType(w, t.element);
      return;
    case 'multiset':
      w.u8(tag.MULTISET);
      writeType(w, t.element);
      return;
    case 'row':
      w.u8(tag.ROW).list(t.fields, (writer, f) => {
        writer.string(f.name);
        writeType(writer, f.type);
      });
  }
}

/** The kinds whose parameters are lengths and precisions alone. */
type Sized = Extract<
  DataType,
  {
    kind:
      | 'character'
      | 'varying'
      | 'exact'
      | 'approximate'
      | 'decfloat'
      | 'date'
      | 'time'
      | 'timestamp'
      | 'binary'
      | 'varbinary'
      | 'clob'
      | 'blob';
  }
>;

/** The tag of each sized kind's type that has one tag whatever its parameters. */
const SIZED_TAGS = {
  character: tag.CHARACTER,
  varying: tag.VARYING,
  approximate: tag.APPROXIMATE,
  decfloat: tag.DECFLOAT,
  date: tag.DATE,
  binary: tag.BINARY,
  varbinary: tag.BINARY_VARYING,
  clob: tag.CLOB,
  blob: tag.BLOB,
} as const;

/**
 * Writes the sized type `t`: its tag, then its lengths and precisions.
 *
 * @param w - the writer
 * @param t - the type
 */
function writeSized(w: Writer, t: Sized): void {
  switch (t.kind) {
    case 'character':
    case 'varying':
      writeUnits(w.u8(SIZED_TAGS[t.kind]).u32(t.length), t.units);
      return;
    case 'clob':
    case 'blob':
      writeUnits(w.u8(SIZED_TAGS[t.kind]).u64(t.length), t.units);
      return;
    case 'binary':
    case 'varbinary':
      w.u8(SIZED_TAGS[t.kind]).u32(t.length);
      return;
    case 'approximate':
    case 'decfloat':
    case 'date':
      w.u8(SIZED_TAGS[t.kind]).u32(t.precision);
      return;
    case 'exact':
      w.u8(tag.EXACT).u32(t.precision).u32(t.scale);
      return;
    case 'time':
    case 'timestamp':
      w.u8(datetimeTag(t.kind, t.zoned)).u32(t.precision);
  }
}

/**
 * The tag of a time or timestamp type, of a zone or none.
 *
 * @param kind - time or timestamp
 * @param zoned - whether WITH TIME ZONE
 * @returns its tag
 */
function datetimeTag(kind: 'time' | 'timestamp', zoned: boolean): number {
  if (kind === 'time') return zoned ? tag.TIME_ZONED : tag.TIME;
  return zoned ? tag.TIMESTAMP_ZONED : tag.TIMESTAMP;
}

/**
 * Writes the types `writeScalar` leaves: those of no parameters or of their own form.
 *
 * @param w - the writer
 * @param t - the type
 */
function writeOther(
  w: Writer,
  t: Extract<
    DataType,
    { kind: 'plugin' | 'interval' | 'boolean' | 'json' | 'uuid' | 'structured' | 'reference' | 'xml' }
  >,
): void {
  switch (t.kind) {
    case 'plugin':
      writePlugin(w.u8(tag.PLUGIN), t);
      return;
    case 'interval':
      writeQualifier(w.u8(tag.INTERVAL), t.qualifier);
      return;
    case 'boolean':
    case 'json':
    case 'uuid':
      w.u8({ boolean: tag.BOOLEAN, json: tag.JSON_TAG, uuid: tag.UUID }[t.kind]);
      return;
    case 'structured':
      writeStructured(w.u8(tag.STRUCTURED), t.name);
      return;
    case 'reference':
      writeReference(w.u8(tag.REFERENCE), t);
      return;
    case 'xml':
      writeXml(w.u8(tag.XML), t);
  }
}

/**
 * Writes a data type.
 *
 * @param w - the writer
 * @param t - the type
 */
export function writeType(w: Writer, t: DataType): void {
  if (isConstructed(t)) writeConstructed(w, t);
  else if (isSized(t)) writeSized(w, t);
  else writeOther(w, t);
}

/** The kinds made of other types. */
const CONSTRUCTED: ReadonlySet<DataType['kind']> = new Set(['array', 'multiset', 'row']);

/**
 * Whether `t` is made of other types.
 *
 * @param t - the type
 * @returns true for an array, a multiset or a row type
 */
function isConstructed(t: DataType): t is Extract<DataType, { kind: 'array' | 'multiset' | 'row' }> {
  return CONSTRUCTED.has(t.kind);
}

/**
 * Whether `t` is of the sized kinds.
 *
 * @param t - the type
 * @returns true if its parameters are lengths and precisions alone
 */
function isSized(t: DataType): t is Sized {
  return t.kind in SIZED_TAGS || t.kind === 'exact' || t.kind === 'time' || t.kind === 'timestamp';
}

/**
 * Reads an array type: its maximum cardinality, 1 to 65,535, and its element type.
 *
 * @param r - the reader
 * @returns it
 */
function readArray(r: Reader): DataType {
  const maxCardinality = r.u32();
  if (maxCardinality < 1 || maxCardinality > tag.MAX_CARDINALITY) {
    throw r.corrupt("an array type's maximum cardinality is out of range");
  }
  return { kind: 'array', maxCardinality, element: readType(r) };
}

/**
 * Reads a row type: one field or more, each its name and type.
 *
 * @param r - the reader
 * @returns it
 */
function readRow(r: Reader): DataType {
  const fields = r.list((reader) => ({ name: reader.string(), type: readType(reader) }));
  if (fields.length === 0) throw r.corrupt('a row type has no fields');
  return { kind: 'row', fields };
}

/** How each tag of a type of parameters alone is read, after its tag. */
const SCALAR_READERS: Readonly<Partial<Record<number, (r: Reader) => DataType>>> = {
  [tag.CHARACTER]: (r) => ({ kind: 'character', length: r.u32(), units: readUnits(r) }),
  [tag.EXACT]: (r) => ({ kind: 'exact', precision: r.u32(), scale: r.u32() }),
  [tag.APPROXIMATE]: (r) => ({ kind: 'approximate', precision: r.u32() }),
  [tag.PLUGIN]: readPlugin,
  [tag.VARYING]: (r) => ({ kind: 'varying', length: r.u32(), units: readUnits(r) }),
  [tag.BINARY]: (r) => ({ kind: 'binary', length: r.u32() }),
  [tag.BINARY_VARYING]: (r) => ({ kind: 'varbinary', length: r.u32() }),
  [tag.DATE]: (r) => ({ kind: 'date', precision: r.u32() }),
  [tag.TIME]: (r) => ({ kind: 'time', precision: r.u32(), zoned: false }),
  [tag.TIME_ZONED]: (r) => ({ kind: 'time', precision: r.u32(), zoned: true }),
  [tag.TIMESTAMP]: (r) => ({ kind: 'timestamp', precision: r.u32(), zoned: false }),
  [tag.TIMESTAMP_ZONED]: (r) => ({ kind: 'timestamp', precision: r.u32(), zoned: true }),
  [tag.INTERVAL]: (r) => ({ kind: 'interval', qualifier: readQualifier(r) }),
  [tag.BOOLEAN]: () => ({ kind: 'boolean' }),
  [tag.DECFLOAT]: (r) => ({ kind: 'decfloat', precision: r.u32() }),
  [tag.CLOB]: (r) => ({ kind: 'clob', length: r.u64(), units: readUnits(r) }),
  [tag.BLOB]: (r) => ({ kind: 'blob', length: r.u64(), units: readUnits(r) }),
  [tag.STRUCTURED]: (r) => ({ kind: 'structured', name: readStructured(r) }),
  [tag.REFERENCE]: readReference,
  [tag.JSON_TAG]: () => ({ kind: 'json' }),
  [tag.XML]: readXml,
  [tag.UUID]: () => ({ kind: 'uuid' }),
};

/**
 * Reads a data type.
 *
 * @param r - the reader
 * @returns it
 * @throws {@link TurborelError} 08006 for a tag of no type, or a type malformed
 */
export function readType(r: Reader): DataType {
  const t = r.u8();
  switch (t) {
    case tag.ARRAY:
      return r.nested(readArray);
    case tag.MULTISET:
      return r.nested((reader) => ({ kind: 'multiset', element: readType(reader) }));
    case tag.ROW:
      return r.nested(readRow);
    default: {
      const read = SCALAR_READERS[t];
      if (read === undefined) throw r.corrupt('no data type has this tag');
      return read(r);
    }
  }
}
