/**
 * Declared types (`[PROTOCOL Declared types]`): with `declared-types`
 * granted, a Prepared's and a Description's columns end with tail 19,
 * the type each column was declared with, as a type's tag cannot tell
 * it. SMALLINT, INTEGER, BIGINT, DECIMAL and NUMERIC are all exact
 * numeric, tag 2; REAL, DOUBLE PRECISION and FLOAT all approximate
 * numeric, tag 3; a distinct type goes as its source type. And a data
 * type as SQL writes it, as turborel's `DataType` displays one read off
 * the wire, for a column the server told no declared type. Internal.
 *
 * @packageDocumentation
 */

import { type Column, type Declared, readColumn, writeColumn } from './composite.js';
import type { Reader } from './reader.js';
import { DECLARED, Tail } from './tail.js';
import type { DataType, Qualifier, TypeName, XmlSchemaName } from './types.js';
import type { Writer } from './writer.js';

/**
 * Reads a list of columns, then the tail of their declared types, if any.
 *
 * @param r - the reader
 * @returns the columns, each with its declared type if told
 * @throws {@link TurborelError} 08006 if the declared types are not one for each column
 */
export function readColumns(r: Reader): Column[] {
  const columns = r.list(readColumn);
  const tail = new Tail([DECLARED]);
  return tail.next(r) === undefined ? columns : readDeclared(r, columns);
}

/**
 * Reads tail 19's field, the declared types of `columns`, its tag read.
 *
 * @param r - the reader
 * @param columns - the columns, as read
 * @returns them, each with its declared type
 * @throws {@link TurborelError} 08006 if the declared types are not one for each column
 */
export function readDeclared(r: Reader, columns: readonly Column[]): Column[] {
  const declared = r.list((inner): Declared => ({ name: inner.string(), written: inner.string() }));
  if (declared.length !== columns.length) throw r.corrupt('its declared types are not one for each column');
  return columns.map((c, i) => {
    const d = declared[i];
    return d === undefined ? c : { ...c, declared: d };
  });
}

/**
 * Writes a list of columns, then their declared types, if any column has one; one without is written as its type says.
 *
 * @param w - the writer
 * @param columns - the columns
 */
export function writeColumns(w: Writer, columns: readonly Column[]): void {
  w.list(columns, writeColumn);
  if (columns.every((c) => c.declared === undefined)) return;
  w.u8(DECLARED).list(columns, (inner, c) => {
    inner.string(c.declared?.name ?? typeName(c.type)).string(c.declared?.written ?? typeWritten(c.type));
  });
}

/**
 * A column's type as SQL writes it: as it was declared, if the server
 * told it, else as its tag and parameters say, so an INTEGER column not
 * told is NUMERIC(10,0), as turborel-client's `Column::type_written`.
 *
 * @param column - the column
 * @returns its type, written
 */
export function columnType(column: Column): string {
  return column.declared?.written ?? typeWritten(column.type);
}

/**
 * A column's type's name, as the Information Schema's DATA_TYPE gives
 * it: as it was declared, if the server told it, else of its tag, so an
 * INTEGER column not told is NUMERIC.
 *
 * @param column - the column
 * @returns its type's name
 */
export function columnTypeName(column: Column): string {
  return column.declared?.name ?? typeName(column.type);
}

/**
 * `t`'s name, as the Information Schema's DATA_TYPE gives it: its key words, without parameters.
 *
 * @param t - the type, as read off the wire
 * @returns its name
 */
export function typeName(t: DataType): string {
  if (t.kind === 'structured' || t.kind === 'reference') return t.kind === 'reference' ? 'REF' : 'USER-DEFINED';
  if (t.kind === 'plugin') return t.name;
  return NAMES[t.kind];
}

/** Each type's name of its kind, but the user-defined types' and a plug-in's own. */
const NAMES: Readonly<Record<Exclude<DataType['kind'], 'structured' | 'reference' | 'plugin'>, string>> = {
  character: 'CHARACTER',
  varying: 'CHARACTER VARYING',
  exact: 'NUMERIC',
  approximate: 'FLOAT',
  decfloat: 'DECFLOAT',
  date: 'DATE',
  time: 'TIME',
  timestamp: 'TIMESTAMP',
  binary: 'BINARY',
  varbinary: 'BINARY VARYING',
  interval: 'INTERVAL',
  boolean: 'BOOLEAN',
  json: 'JSON',
  uuid: 'UUID',
  array: 'ARRAY',
  multiset: 'MULTISET',
  row: 'ROW',
  clob: 'CHARACTER LARGE OBJECT',
  blob: 'BINARY LARGE OBJECT',
  xml: 'XML',
};

/** A type of kind `K`. */
type Of<K extends DataType['kind']> = DataType & { readonly kind: K };

/**
 * A length in characters or octets, as SQL writes it in a type's parentheses.
 *
 * @param length - the length
 * @param units - what it counts
 * @returns it, written
 */
function counted(length: number | bigint, units: 'characters' | 'octets'): string {
  return `(${String(length)}${units === 'octets' ? ' OCTETS' : ''})`;
}

/** How each kind of type is written, as turborel writes one read off the wire. */
const WRITTEN: { readonly [K in DataType['kind']]: (t: Of<K>) => string } = {
  character: (t) => `CHARACTER${counted(t.length, t.units)}`,
  varying: (t) => `CHARACTER VARYING${counted(t.length, t.units)}`,
  clob: (t) => `CHARACTER LARGE OBJECT${counted(t.length, t.units)}`,
  blob: (t) => `BINARY LARGE OBJECT(${String(t.length)})`,
  exact: (t) => `NUMERIC(${String(t.precision)},${String(t.scale)})`,
  approximate: (t) => `FLOAT(${String(t.precision)})`,
  decfloat: (t) => `DECFLOAT(${String(t.precision)})`,
  date: () => 'DATE',
  time: (t) => `TIME(${String(t.precision)})${t.zoned ? ' WITH TIME ZONE' : ''}`,
  timestamp: (t) => `TIMESTAMP(${String(t.precision)})${t.zoned ? ' WITH TIME ZONE' : ''}`,
  binary: (t) => `BINARY(${String(t.length)})`,
  varbinary: (t) => `BINARY VARYING(${String(t.length)})`,
  interval: (t) => `INTERVAL ${qualifierWritten(t.qualifier)}`,
  boolean: () => 'BOOLEAN',
  json: () => 'JSON',
  uuid: () => 'UUID',
  array: (t) => `${typeWritten(t.element)} ARRAY[${String(t.maxCardinality)}]`,
  multiset: (t) => `${typeWritten(t.element)} MULTISET`,
  row: (t) => `ROW(${t.fields.map((f) => `${f.name} ${typeWritten(f.type)}`).join(', ')})`,
  structured: (t) => dotted(t.name),
  reference: (t) => `REF(${dotted(t.referenced)})${t.scope === undefined ? '' : ` SCOPE ${dotted(t.scope)}`}`,
  xml: xmlWritten,
  plugin: (t) => t.name,
};

/**
 * `t` as SQL writes it, as turborel writes a type read off the wire: an
 * exact number as NUMERIC, an approximate one as FLOAT, of their
 * precisions.
 *
 * @param t - the type
 * @returns it, written
 */
export function typeWritten(t: DataType): string {
  return (WRITTEN[t.kind] as (t: DataType) => string)(t);
}

/**
 * A name of a schema's, as SQL writes it: its schema, a dot, its name.
 *
 * @param n - the name
 * @returns it, written
 */
function dotted(n: TypeName): string {
  return `${n.schema}.${n.name}`;
}

/**
 * An interval's qualifier as SQL writes it, as turborel's `Qualifier` displays it.
 *
 * @param q - the qualifier
 * @returns it, written
 */
function qualifierWritten(q: Qualifier): string {
  if (q.start === q.end) {
    return q.end === 'SECOND'
      ? `SECOND(${String(q.leading)}, ${String(q.fraction)})`
      : `${q.start}(${String(q.leading)})`;
  }
  const fraction = q.end === 'SECOND' ? `(${String(q.fraction)})` : '';
  return `${q.start}(${String(q.leading)}) TO ${q.end}${fraction}`;
}

/**
 * An XML type as SQL writes it, as turborel's `XmlType::written`.
 *
 * @param t - the type
 * @returns it, written
 */
function xmlWritten(t: Of<'xml'>): string {
  const primary = t.primary.toUpperCase();
  if (t.secondary === 'xmlschema') return `XML(${primary}(XMLSCHEMA ${accordingWritten(t.schema)}))`;
  return t.primary === 'sequence' ? `XML(${primary})` : `XML(${primary}(${t.secondary.toUpperCase()}))`;
}

/**
 * The registered XML Schema a type names, as SQL writes it, as turborel's `according_written`.
 *
 * @param s - the schema's name, namespace and element
 * @returns it, written
 */
function accordingWritten(s: XmlSchemaName): string {
  let out = `ID ${dotted(s)}`;
  if (s.namespace === '') out += ' NO NAMESPACE';
  else if (s.namespace !== undefined) out += ` NAMESPACE '${s.namespace.replaceAll("'", "''")}'`;
  if (s.element !== undefined) out += ` ELEMENT "${s.element.replaceAll('"', '""')}"`;
  return out;
}
