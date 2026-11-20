/**
 * Import (`[CLIENT Importing]`), as turborel-client's `import/insert.rs`
 * and `import/copied.rs` import: a source's records inserted into a table
 * through one prepared INSERT, its columns the source's headings, or else
 * the table's; each value cast by the server to its column's type, but a
 * string for a character string column, assigned to it as INSERT assigns,
 * so one too long is refused, not cut. A batch of rows is committed at a
 * time; a failure rolls the batch back and stops, or, if asked, a bad row
 * is skipped and given to the program, and the import goes on. Where the
 * server grants `copy`, no bad row is to be skipped and no column is a
 * large object's, the rows go by bulk copy, a batch to each copy.
 *
 * @packageDocumentation
 */

import { columnName, delimited, tableName } from './names.js';
import { type Position, type Source, SourceError, positionText } from './source.js';
import type { Parameter } from '../codec/composite.js';
import type { DataType } from '../codec/types.js';
import { Lob, type Value } from '../codec/values.js';
import { TurborelError, dataException } from '../error.js';
import { COPY } from '../session/capabilities.js';
import type { Connection } from '../session/connection.js';
import { LOB_INLINE_OCTETS } from '../session/lobs.js';
import type { Statement } from '../session/statements.js';

/** How many rows an import commits at a time, unless told. */
export const DEFAULT_BATCH = 1000;

/** SQLCODE of a data exception, an input that does not fit. */
const SQLCODE_DATA = -301;
/** SQLSTATE 22000, a data exception. */
const DATA_EXCEPTION = '22000';
/** SQLSTATE 22001, string data, right truncation. */
const RIGHT_TRUNCATION = '22001';
/** SQLCODE of a statement cancelled, which no skip passes over. */
const SQLCODE_CANCELLED = -920;

/** What an import is to do. */
export interface ImportOptions {
  /** The table the rows go into, as SQL writes its name. */
  readonly table: string;
  /** How many rows are committed at a time: 1000 by default, 0 for all at once. */
  readonly batch?: number;
  /** Whether a row refused, or of too many or too few fields, is skipped and given to `rejected`, rather than ending the import. */
  readonly skip?: boolean;
  /** What takes each row skipped. */
  readonly rejected?: (row: Rejected) => void;
}

/** What an import did. */
export interface Imported {
  /** How many rows were inserted and committed. */
  readonly rows: bigint;
  /** How many were skipped, each given to `rejected`. */
  readonly rejected: bigint;
}

/** Why a row, or an import, failed: the source's, or an SQL condition's. */
export type Cause =
  { readonly kind: 'input'; readonly message: string } | { readonly kind: 'sql'; readonly failure: TurborelError };

/** A row skipped: where it began, and why. */
export interface Rejected {
  /** Where its record began. */
  readonly position: Position;
  /** Why it failed. */
  readonly cause: Cause;
}

/**
 * A cause as words.
 *
 * @param cause - the cause
 * @returns its message
 */
function causeText(cause: Cause): string {
  return cause.kind === 'input' ? cause.message : cause.failure.message;
}

/**
 * `n` rows, in words.
 *
 * @param n - how many
 * @returns as `1 row`, `2 rows`
 */
function rowsText(n: bigint): string {
  return `${String(n)} row${n === 1n ? '' : 's'}`;
}

/** Why an import stopped, and what of it was kept: an SQL condition's codes, or a data exception's for the input's. */
export class ImportError extends TurborelError {
  /** Where the record that stopped it began, if one did. */
  readonly at: Position | undefined;
  /** Why it stopped. */
  readonly why: Cause;
  /** How many rows were committed before. */
  readonly committed: bigint;
  /** How many of the batch under way were rolled back. */
  readonly rolledBack: bigint;

  /**
   * An import stopped.
   *
   * @param at - where the record that stopped it began, if one did
   * @param why - why it stopped
   * @param kept - the rows committed, and those of the batch under way rolled back
   */
  constructor(at: Position | undefined, why: Cause, kept: { committed: bigint; rolledBack: bigint }) {
    const where = at === undefined ? '' : `${positionText(at)}: `;
    const message = `${where}${causeText(why)}; ${rowsText(kept.committed)} committed, ${String(kept.rolledBack)} rolled back`;
    const failure = why.kind === 'sql' ? why.failure : undefined;
    super(failure?.sqlcode ?? SQLCODE_DATA, failure?.sqlstate ?? DATA_EXCEPTION, message, {
      ...(failure?.diagnostics === undefined ? {} : { diagnostics: failure.diagnostics }),
      ...(failure === undefined ? {} : { cause: failure }),
    });
    this.name = 'ImportError';
    this.at = at;
    this.why = why;
    this.committed = kept.committed;
    this.rolledBack = kept.rolledBack;
  }
}

/**
 * The SQL condition `failure`, of a statement the import made, not the program: so without its position.
 *
 * @param failure - the failure
 * @returns the cause
 */
export function sqlCause(failure: unknown): Cause {
  if (!(failure instanceof TurborelError)) return { kind: 'input', message: String(failure) };
  const { sqlcode, sqlstate, message, rule, active, diagnostics } = failure;
  const options = {
    active,
    ...(rule === undefined ? {} : { rule }),
    ...(diagnostics === undefined ? {} : { diagnostics }),
  };
  return { kind: 'sql', failure: new TurborelError(sqlcode, sqlstate, message, options) };
}

/**
 * An error of an import before any row: nothing committed.
 *
 * @param cause - why
 * @param at - where, if a record
 * @returns the error
 */
export function before(cause: Cause, at?: Position): ImportError {
  return new ImportError(at, cause, { committed: 0n, rolledBack: 0n });
}

/**
 * How long `s` is in `units`.
 *
 * @param s - the string
 * @param octets - whether octets are counted, else characters
 * @returns its length
 */
function measured(s: string, octets: boolean): number {
  return octets ? Buffer.byteLength(s) : Array.from(s).length;
}

/**
 * The longest start of `s` of at most `most` units, whole characters.
 *
 * @param s - the string
 * @param most - the most units
 * @param octets - whether octets are counted
 * @returns the start
 */
function prefix(s: string, most: number, octets: boolean): string {
  let kept = '';
  let size = 0;
  for (const c of s) {
    const n = octets ? Buffer.byteLength(c) : 1;
    if (size + n > most) break;
    [kept, size] = [kept + c, size + n];
  }
  return kept;
}

/**
 * A string assigned to a character string type as INSERT assigns it: of
 * CHARACTER, padded to its length; one too long refused unless what is
 * beyond the length is spaces, which are cut.
 *
 * @param s - the string
 * @param type - the column's type
 * @returns the value assigned
 * @throws {@link TurborelError} 22001 if it is too long
 */
export function assignString(s: string, type: DataType): Value {
  if (type.kind !== 'character' && type.kind !== 'varying' && type.kind !== 'clob') return s;
  const octets = type.units === 'octets';
  const most = Number(type.length);
  const count = measured(s, octets);
  let kept = s;
  if (count > most) {
    kept = prefix(s, most, octets);
    if (!/^ *$/u.test(s.slice(kept.length))) {
      const unit = octets ? 'octets' : 'characters';
      throw dataException(
        RIGHT_TRUNCATION,
        `a value of ${String(count)} ${unit}, not spaces beyond ${String(most)}, does not fit its column`,
      );
    }
  }
  if (type.kind === 'character') return kept + ' '.repeat(Math.max(most - measured(kept, octets), 0));
  return type.kind === 'clob' ? new Lob(kept) : kept;
}

/**
 * `values` as they are sent for parameters of `types`: a string for a
 * character string column assigned to it as INSERT assigns; any other as
 * it is, for the server to cast.
 *
 * @param values - the record's values
 * @param types - the INSERT's parameters
 * @returns the values to send
 */
export function assigned(values: readonly Value[], types: readonly Parameter[]): Value[] {
  return values.map((v, i) => {
    const type = types[i]?.type;
    return typeof v === 'string' && type !== undefined ? assignString(v, type) : v;
  });
}

/**
 * Whether `failure` is of a statement cancelled.
 *
 * @param failure - the failure
 * @returns true if it is
 */
export function cancelled(failure: TurborelError): boolean {
  return failure.sqlcode === SQLCODE_CANCELLED;
}

/**
 * The names of `table`'s columns, in order, as the description of a query of them gives them.
 *
 * @param conn - the connection
 * @param table - the table, delimited
 * @returns the names
 */
async function described(conn: Connection, table: string): Promise<string[]> {
  const query = await conn.prepare(`SELECT * FROM ${table}`);
  const names = query.columns.map((c) => c.name ?? '');
  await conn.deallocate(query);
  return names;
}

/** The INSERT an import prepared, and its columns, delimited. */
export interface Prepared {
  /** The INSERT. */
  readonly insert: Statement;
  /** Its columns, delimited. */
  readonly columns: string[];
  /** The table, delimited. */
  readonly table: string;
}

/**
 * The INSERT that puts `source`'s records into the table `options` names.
 *
 * @param conn - the connection, with no transaction active
 * @param source - the source
 * @param options - the table
 * @returns the INSERT, its columns and the table
 */
export async function prepared(conn: Connection, source: Source, options: ImportOptions): Promise<Prepared> {
  if (conn.inTransaction) {
    throw before({ kind: 'input', message: 'an import begins with no transaction active, as it commits its batches' });
  }
  let table: string;
  try {
    table = tableName(options.table);
  } catch (e) {
    throw before({ kind: 'input', message: e instanceof Error ? e.message : String(e) });
  }
  let headings;
  try {
    headings = await source.headings();
  } catch (e) {
    throw e instanceof SourceError ? before({ kind: 'input', message: e.why }, e.at) : before(sqlCause(e));
  }
  try {
    const columns = (
      headings === undefined ? await described(conn, table) : headings.map((h) => columnName(h.name))
    ).map(delimited);
    const marks = columns.map(() => '?').join(', ');
    const insert = await conn.prepare(`INSERT INTO ${table} (${columns.join(', ')}) VALUES (${marks})`);
    return { insert, columns, table };
  } catch (e) {
    throw before(sqlCause(e));
  }
}

/**
 * Whether an import into `insert`'s parameters goes by copy: granted, no bad row skipped, no large object column.
 *
 * @param conn - the connection
 * @param insert - the INSERT
 * @param options - the import
 * @returns true if it does
 */
export function copies(conn: Connection, insert: Statement, options: ImportOptions): boolean {
  const lob = (p: Parameter): boolean => p.type.kind === 'clob' || p.type.kind === 'blob';
  return conn.has(COPY) && options.skip !== true && !insert.parameters.some(lob);
}

/**
 * Whether a value for a large object parameter is long enough to go ahead by its locator.
 *
 * @param v - the value
 * @returns its octets if it is, else undefined
 */
export function longLob(v: Value): Uint8Array | string | undefined {
  if (typeof v === 'string' && Buffer.byteLength(v) > LOB_INLINE_OCTETS) return v;
  if (v instanceof Uint8Array && v.byteLength > LOB_INLINE_OCTETS) return v;
  if (v instanceof Lob) {
    const long = typeof v.data === 'string' ? Buffer.byteLength(v.data) : v.data.byteLength;
    return long > LOB_INLINE_OCTETS ? v.data : undefined;
  }
  return undefined;
}
