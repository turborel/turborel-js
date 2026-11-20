/**
 * The composite fields (`[PROTOCOL Composite fields]`): a row, a column, a
 * parameter and a failure, with a failure's and a Notice's diagnostics,
 * tags 7 to 15 of the tail (`[PROTOCOL Errors and notices]`). Internal.
 *
 * @packageDocumentation
 */

import type { Reader } from './reader.js';
import { SEVERITY, Tail, writeText } from './tail.js';
import { type DataType, readType, writeType } from './types.js';
import { readValues, writeValues } from './value-codec.js';
import type { Value } from './values.js';
import type { Writer } from './writer.js';
import { type Diagnostics, TurborelError } from '../error.js';

/** A column of a result, as Prepared and Description give it. */
export interface Column {
  /** Its name, if it has one. */
  readonly name?: string;
  /** Its type. */
  readonly type: DataType;
  /** Whether it is constrained NOT NULL. */
  readonly notNull: boolean;
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
