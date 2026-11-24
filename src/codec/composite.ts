/**
 * The composite fields (`[PROTOCOL Composite fields]`): a row, a column, a
 * parameter and a failure, with a failure's and a Notice's diagnostics,
 * tags 7 to 15 of the tail (`[PROTOCOL Errors and notices]`), and a
 * row's size in a message. Internal.
 *
 * @packageDocumentation
 */

import type { Reader } from './reader.js';
import { SEVERITY, Tail, writeText } from './tail.js';
import { type DataType, readType, writeType } from './types.js';
import { DecFloat } from './decfloat.js';
import { Decimal } from './decimal.js';
import { Json } from './json.js';
import { readValues, writeValue, writeValues } from './value-codec.js';
import { Datetime, Interval, Lob, LobLocator, Reference, type Value } from './values.js';
import { Writer } from './writer.js';
import { type Diagnostics, TurborelError } from '../error.js';

/** A column of a result, as Prepared and Description give it. */
export interface Column {
  /** Its name, if it has one. */
  readonly name?: string;
  /** Its type. */
  readonly type: DataType;
  /** Whether it is constrained NOT NULL. */
  readonly notNull: boolean;
  /** The type it was declared with, as INTEGER of an exact numeric type, if the server told it (`declared-types`). */
  readonly declared?: Declared;
}

/**
 * The type a column was declared with, beside the tag its values are
 * written by, as turborel-protocol's `Declared` holds it.
 */
export interface Declared {
  /** Its name, as the Information Schema's DATA_TYPE gives it: INTEGER, DECIMAL, USER-DEFINED of a distinct type. */
  readonly name: string;
  /** The whole type as SQL writes it: INTEGER, DECIMAL(9,2), a distinct type's schema and name. */
  readonly written: string;
}

/** A dynamic parameter of a prepared statement, as Prepared gives it. */
export interface Parameter {
  /**
   * Whether the server gives it CHARACTER VARYING of the longest length,
   * as it does a parameter whose type the statement does not decide.
   */
  readonly varying: boolean;
  /** Its type. */
  readonly type: DataType;
}

/** The diagnostics' fields, in the order of their tags from 7. */
const DIAGNOSTIC_FIELDS = [
  'severity',
  'detail',
  'hint',
  'context',
  'schema',
  'table',
  'column',
  'dataType',
  'constraint',
] as const satisfies readonly (keyof Diagnostics)[];

/** The tags of the diagnostics, 7 to 15. */
export const DIAGNOSTIC_TAGS: readonly number[] = DIAGNOSTIC_FIELDS.map((_, i) => SEVERITY + i);

/**
 * Writes a row: its values' count, then each.
 *
 * @param w - the writer
 * @param row - the values
 */
export function writeRow(w: Writer, row: readonly Value[]): void {
  writeValues(w, row);
}

/**
 * Reads a row.
 *
 * @param r - the reader
 * @returns its values
 */
export function readRow(r: Reader): Value[] {
  return readValues(r);
}

/**
 * Writes a column: its named flag and name, its type, its not null flag.
 *
 * @param w - the writer
 * @param c - the column
 */
export function writeColumn(w: Writer, c: Column): void {
  w.flag(c.name !== undefined);
  if (c.name !== undefined) w.string(c.name);
  writeType(w, c.type);
  w.flag(c.notNull);
}

/**
 * Reads a column.
 *
 * @param r - the reader
 * @returns it
 */
export function readColumn(r: Reader): Column {
  const name = r.flag() ? r.string() : undefined;
  const type = readType(r);
  return { ...(name === undefined ? {} : { name }), type, notNull: r.flag() };
}

/**
 * Reads a parameter: its varying flag, then its type.
 *
 * @param r - the reader
 * @returns it
 */
export function readParameter(r: Reader): Parameter {
  const varying = r.flag();
  return { varying, type: readType(r) };
}

/**
 * Writes a parameter: its varying flag, then its type.
 *
 * @param w - the writer
 * @param p - the parameter
 */
export function writeParameter(w: Writer, p: Parameter): void {
  writeType(w.flag(p.varying), p.type);
}

/**
 * Writes the diagnostics: each field said, with its tag.
 *
 * @param w - the writer
 * @param d - the diagnostics, if any
 */
export function writeDiagnostics(w: Writer, d: Diagnostics | undefined): void {
  DIAGNOSTIC_FIELDS.forEach((field, i) => {
    writeText(w, SEVERITY + i, d?.[field]);
  });
}

/**
 * Reads a tail of diagnostics alone, to the end of what `r` reads.
 *
 * @param r - the reader
 * @returns the diagnostics, or undefined if the tail is empty
 */
export function readDiagnostics(r: Reader): Diagnostics | undefined {
  const tail = new Tail(DIAGNOSTIC_TAGS);
  const found: Partial<Record<(typeof DIAGNOSTIC_FIELDS)[number], string>> = {};
  let any = false;
  for (let t = tail.next(r); t !== undefined; t = tail.next(r)) {
    // The tail takes tags 7 to 15 alone, so each names a field.
    found[DIAGNOSTIC_FIELDS[t - SEVERITY] ?? 'severity'] = r.string();
    any = true;
  }
  return any ? found : undefined;
}

/**
 * Writes a failure: SQLCODE, SQLSTATE, message, the rule it cites, its
 * position, its active flag, and its diagnostics as its tail.
 *
 * @param w - the writer
 * @param f - the failure
 */
export function writeFailure(w: Writer, f: TurborelError): void {
  w.i32(f.sqlcode).string(f.sqlstate).string(f.message);
  w.flag(f.rule !== undefined);
  if (f.rule !== undefined) w.string(f.rule);
  w.flag(f.position !== undefined);
  if (f.position !== undefined) w.u64(f.position);
  w.flag(f.active);
  writeDiagnostics(w, f.diagnostics);
}

/**
 * Reads a failure, its tail to the end of what `r` reads, as the driver's error.
 *
 * @param r - the reader
 * @returns it
 */
export function readFailure(r: Reader): TurborelError {
  const sqlcode = r.i32();
  const sqlstate = r.string();
  const message = r.string();
  const rule = r.flag() ? r.string() : undefined;
  const position = r.flag() ? r.u64() : undefined;
  const active = r.flag();
  const diagnostics = readDiagnostics(r);
  return new TurborelError(sqlcode, sqlstate, message, {
    ...(rule === undefined ? {} : { rule }),
    ...(position === undefined ? {} : { position }),
    active,
    ...(diagnostics === undefined ? {} : { diagnostics }),
  });
}

/** The bytes a value's tag and its fixed fields take, of each kind sized without encoding. */
const SIZE = {
  NULL: 1,
  NUMBER: 21,
  APPROXIMATE: 9,
  BOOLEAN: 2,
  COUNTED: 5,
  LOB: 6,
  LOCATOR: 22,
  DATETIME: 15,
  INTERVAL: 33,
};

/**
 * About the bytes `row` takes in a message, as turborel-protocol's
 * `row_size` reckons them: a value of a fixed size its size, a string's
 * or a binary string's its octets and their count, a composite's encoded.
 *
 * @param row - the values
 * @returns their bytes, about
 */
export function rowSize(row: readonly Value[]): number {
  let size = 0;
  for (const v of row) size += valueSize(v);
  return size;
}

/**
 * About the bytes `v` takes.
 *
 * @param v - the value
 * @returns its bytes
 */
function valueSize(v: Value): number {
  if (v === null) return SIZE.NULL;
  if (typeof v === 'string') return Buffer.byteLength(v) + SIZE.COUNTED;
  if (typeof v === 'bigint' || v instanceof Decimal || v instanceof DecFloat) return SIZE.NUMBER;
  if (typeof v === 'number') return SIZE.APPROXIMATE;
  if (typeof v === 'boolean') return SIZE.BOOLEAN;
  if (v instanceof Uint8Array) return v.byteLength + SIZE.COUNTED;
  if (v instanceof Datetime) return SIZE.DATETIME;
  if (v instanceof Interval) return SIZE.INTERVAL;
  return heldSize(v);
}

/**
 * About the bytes of a value that holds octets of its own, or a composite's, encoded.
 *
 * @param v - the value
 * @returns its bytes
 */
function heldSize(v: Value): number {
  if (v instanceof Lob) return (typeof v.data === 'string' ? Buffer.byteLength(v.data) : v.data.byteLength) + SIZE.LOB;
  if (v instanceof LobLocator) return SIZE.LOCATOR;
  if (v instanceof Reference) return v.octets.byteLength + SIZE.COUNTED;
  if (v instanceof Json) return v.bytes.byteLength + SIZE.COUNTED;
  const w = new Writer();
  writeValue(w, v);
  return w.length;
}
