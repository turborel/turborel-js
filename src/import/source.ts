/**
 * Where an import's rows come from (`[CLIENT Importing]`), as
 * turborel-client's `import.rs` defines it: a source gives its headings,
 * if it knows them, then its records one at a time, each with where it
 * began, so memory holds a record whatever the source's size.
 *
 * @packageDocumentation
 */

import type { DataType } from '../codec/types.js';
import type { Value } from '../codec/values.js';
import { TurborelError } from '../error.js';

/** SQLCODE of a data exception, an input that does not fit. */
const SQLCODE_DATA = -301;
/** SQLSTATE 22000, a data exception. */
const DATA_EXCEPTION = '22000';

/** Where in a source a record began: its number, the first 1, a header not counted, and its line, of a source of lines. */
export interface Position {
  /** The record's number among the source's records of data. */
  readonly record: number;
  /** The line it began on, the first 1, of a source made of lines. */
  readonly line?: number;
}

/**
 * A position as words.
 *
 * @param position - the position
 * @returns as `record 3, line 4`
 */
export function positionText(position: Position): string {
  return `record ${String(position.record)}${position.line === undefined ? '' : `, line ${String(position.line)}`}`;
}

/** What a source says of one of its fields: a name, which names a column of the table, and a type, if it knows one. */
export interface Heading {
  /** The name: read as an identifier if it is one, a regular one in upper case, else as written. */
  readonly name: string;
  /** The type of its values, if the source knows it. */
  readonly type?: DataType;
}

/** A record of a source: a value for each field, and where it began. */
export interface SourceRecord {
  /** The values, one a field: a source that knows no types gives strings, and null. */
  readonly values: readonly Value[];
  /** Where it began. */
  readonly position: Position;
}

/** Why a source cannot give its next record: what is wrong, and where. A source cannot go on after one. */
export class SourceError extends TurborelError {
  /** Where the record began. */
  readonly at: Position;
  /** What is wrong, without where. */
  readonly why: string;

  /**
   * A source's failure.
   *
   * @param at - where the record began
   * @param why - what is wrong, in plain words
   */
  constructor(at: Position, why: string) {
    super(SQLCODE_DATA, DATA_EXCEPTION, `${positionText(at)}: ${why}`);
    this.name = 'SourceError';
    this.at = at;
    this.why = why;
  }
}

/**
 * Where an import's rows come from. `headings` is asked once, before the
 * first record; then `record` until it gives none, and none again if asked
 * after. A source holds no more than a record at a time, and refuses a
 * record past a bound of its own rather than read on.
 */
export interface Source {
  /**
   * Its fields' names and types, as of a header row; undefined if it knows none, its fields then the table's columns in order.
   *
   * @returns the headings, or undefined
   * @throws {@link SourceError} why it cannot be read, and where
   */
  headings(): Promise<readonly Heading[] | undefined>;

  /**
   * The next record.
   *
   * @returns it, or undefined at the end
   * @throws {@link SourceError} why it cannot be read, and where
   */
  record(): Promise<SourceRecord | undefined>;
}
