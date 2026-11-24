/**
 * What a connection's statements give (`[CLIENT Running statements]`,
 * `[CLIENT Prepared statements]`), as turborel-client's `connection.rs`,
 * `statements.rs` and `session.rs` give it: a statement's outcome, a
 * prepared statement, a cursor's batch, and what a request of several
 * statements ran.
 *
 * @packageDocumentation
 */

import type { Column, Parameter } from '../codec/composite.js';
import type { Completion } from '../codec/replies.js';
import type { Value } from '../codec/values.js';
import type { TurborelError } from '../error.js';
import { type Called, type DynamicParameter, dynamicParameters } from '../codec/called.js';
import type { TypeName } from '../codec/types.js';

/** What a statement gave: a query's columns and rows, or another statement's completion. */
export type Outcome =
  | {
      readonly kind: 'rows';
      /** The columns. */
      readonly columns: readonly Column[];
      /** The rows, each a value for each column. */
      readonly rows: readonly (readonly Value[])[];
    }
  | {
      readonly kind: 'done';
      /** Its completion: its SQLCODE, 0 or 100, and its SQLSTATE, a warning's among them. */
      readonly completion: Completion;
    };

/** What a statement given to a sink gave: how many rows went to it, or another statement's completion. */
export type Streamed =
  { readonly kind: 'rows'; readonly count: number } | { readonly kind: 'done'; readonly completion: Completion };

/** What takes a query's rows as they come, a batch at a time; what it returns is awaited. */
export interface Sink {
  /**
   * Takes the columns of the rows that follow.
   *
   * @param columns - the columns
   */
  columns(columns: readonly Column[]): void | Promise<void>;
  /**
   * Takes a batch of rows.
   *
   * @param rows - the rows
   */
  rows(rows: readonly (readonly Value[])[]): void | Promise<void>;
}

/** Rows of a cursor, and whether it has more. */
export interface Batch {
  /** The rows. */
  readonly rows: readonly (readonly Value[])[];
  /** Whether the cursor has more, which a fetch reads: closed if not. */
  readonly more: boolean;
}

/** Which of a cursor's rows a request takes, and of which cursor. */
export interface CursorOptions {
  /** At most how many rows; 0, the default, for all. */
  readonly rows?: number;
  /** The cursor's number: 0, the default, unless `cursors` was granted. */
  readonly cursor?: number;
}

/** What a request of several statements gave: each outcome in order, and the failure of the one that stopped the rest. */
export interface Ran {
  /** The outcomes of the statements that ran, in order. */
  readonly outcomes: readonly Outcome[];
  /** The failure of the statement that stopped the rest, if one did. */
  readonly failure?: TurborelError;
}

/** A statement the server prepared, of one connection. */
export class Statement {
  /** The number its connection gave it. */
  readonly number: number;
  /** Its dynamic parameters' types, in order: its inputs, of a CALL not those of output parameters alone. */
  readonly parameters: readonly Parameter[];
  /** The columns of its rows, of a query; of a CALL, one for each `?` of an output parameter, whose values `execute` gives as a row; none of another statement. */
  readonly columns: readonly Column[];
  /**
   * Each of its `?`s in the order written, OUT ones too: its type, and, of
   * a CALL, the mode and ordinal position of the parameter whose argument
   * holds it, as a server granting `parameter-modes` tells them; told
   * none, each input an IN one, of no position.
   */
  readonly dynamicParameters: readonly DynamicParameter[];
  /** Of a CALL of an SQL-invoked procedure, the procedure's specific name, as a server granting `parameter-modes` tells it. */
  readonly procedure: TypeName | undefined;

  /**
   * A statement as Prepared describes it.
   *
   * @param number - its number
   * @param parameters - its parameters
   * @param columns - its columns
   * @param called - what it told of a CALL, if it did
   */
  constructor(number: number, parameters: readonly Parameter[], columns: readonly Column[], called?: Called) {
    this.number = number;
    this.parameters = parameters;
    this.columns = columns;
    this.dynamicParameters = dynamicParameters(parameters, called);
    this.procedure = called?.procedure;
  }
}
