/**
 * The statements a connection runs
 * (`[CLIENT Running statements]`, `[CLIENT Prepared statements]`,
 * `[CLIENT What the server tells]`, `[CLIENT Controlling the session]`), as
 * turborel-client's `connection.rs`, `statements.rs` and `session.rs` run
 * them: one statement at a time, a query's rows read whole, or given to a
 * sink a batch at a time; prepared statements and their cursors; and what
 * the server told of the last statement. Its link (`link.ts`) logs it in
 * and carries its frames; `connection.ts` adds large objects, copy and
 * export.
 *
 * @packageDocumentation
 */

import * as cap from './capabilities.js';
import { Link } from './link.js';
import {
  type Batch,
  type CursorOptions,
  type Outcome,
  type Ran,
  type Sink,
  Statement,
  type Streamed,
} from './statements.js';
import type { Column } from '../codec/composite.js';
import type { Completion, Reply, Timing } from '../codec/replies.js';
import type { Attribute } from '../codec/tail.js';
import type { Value } from '../codec/values.js';
import { type TurborelError, connectionFailure } from '../error.js';

/** The largest statement number, after which they wrap to 0. */
const LAST_NUMBER = 0xffff_ffff;

/** Rows as a reply gives them. */
type Rows = (readonly Value[])[];

/** A connection's statements, over its link. */
export class Runner extends Link {
  #nextStatement = 0;
  #autocommit = false;

  /** @returns whether each statement is its own transaction, committed as it succeeds and rolled back as it fails */
  get autocommit(): boolean {
    return this.#autocommit;
  }

  /**
   * Whether each statement `query`, `queryInto` and `execute` run is its
   * own transaction from now on: off as a connection opens, a transaction
   * begun by the first statement lasting until COMMIT or ROLLBACK. A
   * cursor is read within its transaction, which ends as the cursor does
   * if the server granted `fetch-ends`.
   *
   * @param on - whether it is
   */
  setAutocommit(on: boolean): void {
    this.#autocommit = on;
  }

  /**
   * Runs `sql`, a direct SQL statement, in the session.
   *
   * @param sql - the statement
   * @returns a query's columns and rows, or another statement's completion
   * @throws {@link TurborelError} the statement's failure, as the server reports it; 08006 if the connection is lost
   */
  async query(sql: string): Promise<Outcome> {
    await this.send({ kind: 'query', sql, ends: this.#autocommit, attributes: this.told.carried(), multi: false });
    const first = await this.receive();
    if (first.kind === 'complete') return { kind: 'done', completion: first.completion };
    const columns = this.#columns(first);
    const { rows } = await this.#rows();
    return { kind: 'rows', columns, rows };
  }

  /**
   * Runs `sql` as `query` does, a query's columns and rows given to `sink`
   * as they come, each batch awaited, so no more than a batch is held.
   *
   * @param sql - the statement
   * @param sink - what takes the columns and rows
   * @returns how many rows went to the sink, or another statement's completion
   * @throws {@link TurborelError} as `query`; a query's failure after some rows went to the sink
   */
  async queryInto(sql: string, sink: Sink): Promise<Streamed> {
    await this.send({ kind: 'query', sql, ends: this.#autocommit, attributes: this.told.carried(), multi: false });
    const first = await this.receive();
    if (first.kind === 'complete') return { kind: 'done', completion: first.completion };
    await sink.columns(this.#columns(first));
    let count = 0;
    for (;;) {
      const reply = await this.receive();
      if (reply.kind === 'rows') {
        count += reply.rows.length;
        await sink.rows(reply.rows);
      } else if (reply.kind === 'complete') return { kind: 'rows', count };
      else throw this.unexpected(reply, 'the server broke off its rows');
    }
  }

  /**
   * Runs `sql`, several statements, in one request: the server runs each
   * in order, each its own transaction under autocommit, the first that
   * fails stopping the rest.
   *
   * @param sql - the statements
   * @returns each outcome, and the failure that stopped the rest, if one did
   * @throws {@link TurborelError} 08006 if `multi-statement` was not granted, or the connection is lost
   */
  async queryMany(sql: string): Promise<Ran> {
    await this.send({ kind: 'query', sql, ends: this.#autocommit, attributes: this.told.carried(), multi: true });
    const outcomes: Outcome[] = [];
    for (;;) {
      try {
        const [outcome, more] = await this.#outcome();
        outcomes.push(outcome);
        if (!more) return { outcomes };
      } catch (e) {
        if (this.isLost) throw e;
        return { outcomes, failure: e as TurborelError };
      }
    }
  }

  /** @returns one statement's outcome of several, and whether another's replies follow */
  async #outcome(): Promise<[Outcome, boolean]> {
    const first = await this.receive();
    if (first.kind === 'complete') return [{ kind: 'done', completion: first.completion }, first.completion.more];
    const columns = this.#columns(first);
    const rows: Rows = [];
    for (;;) {
      const reply = await this.receive();
      if (reply.kind === 'rows') append(rows, reply.rows);
      else if (reply.kind === 'complete') return [{ kind: 'rows', columns, rows }, reply.completion.more];
      else throw this.unexpected(reply, 'the server broke off its rows');
    }
  }

  /**
   * Prepares `sql`, a preparable statement whose dynamic parameters are written `?`.
   *
   * @param sql - the statement
   * @returns the statement, its parameters' types and a query's columns
   * @throws {@link TurborelError} the server's: 37000 if it is not preparable, or a `?` takes no type where it stands; 08006 if the connection is lost
   */
  async prepare(sql: string): Promise<Statement> {
    const statement = this.#nextStatement;
    this.#nextStatement = statement === LAST_NUMBER ? 0 : statement + 1;
    await this.send({ kind: 'prepare', statement, sql });
    return this.#prepared();
  }

  /** @returns the statement the server's Prepared describes */
  async #prepared(): Promise<Statement> {
    const reply = await this.receive();
    if (reply.kind === 'prepared') return new Statement(reply.statement, reply.parameters, reply.columns);
    throw this.unexpected(reply, 'the server sent no Prepared');
  }

  /**
   * Executes `statement` with `values`, its transaction ended with it under autocommit.
   *
   * @param statement - a statement this connection prepared
   * @param values - a value for each parameter
   * @returns a query's rows, all of them; a CALL's output parameters' values, a row of its columns; or another statement's completion
   * @throws {@link TurborelError} the server's: 07001 if the values are not one for each parameter; the statement's; 08006 if the connection is lost
   */
  async execute(statement: Statement, values: readonly Value[] = []): Promise<Outcome> {
    await this.#execute(statement, values, { ends: this.#autocommit });
    if (statement.columns.length === 0) return { kind: 'done', completion: await this.completion() };
    const { rows } = await this.#rows();
    return { kind: 'rows', columns: statement.columns, rows };
  }

  /**
   * Opens a cursor of `statement`, a query, with `values`, and takes its
   * first rows. Under autocommit, the server granting `fetch-ends`, its
   * transaction ends as the cursor does: committed once its last row is
   * read or it is closed, rolled back if a fetch fails.
   *
   * @param statement - a query this connection prepared
   * @param values - a value for each parameter
   * @param options - how many rows to take, all by default, and the cursor's number, 0 by default
   * @returns the rows, and whether the cursor has more
   * @throws {@link TurborelError} the server's: 24000 if the cursor is open; as `execute`; 08006 for a cursor not 0 if `cursors` was not granted
   */
  async openCursor(statement: Statement, values: readonly Value[] = [], options: CursorOptions = {}): Promise<Batch> {
    const ends = this.#autocommit && this.has(cap.FETCH_ENDS);
    await this.#execute(statement, values, { ends, ...options });
    return this.#rows();
  }

  /**
   * Sends an Execute.
   *
   * @param statement - the statement
   * @param values - its values
   * @param options - whether it ends its transaction, its rows and cursor
   */
  async #execute(
    statement: Statement,
    values: readonly Value[],
    options: CursorOptions & { ends: boolean },
  ): Promise<void> {
    await this.send({
      kind: 'execute',
      statement: statement.number,
      cursor: options.cursor ?? 0,
      values,
      rows: options.rows ?? 0,
      ends: options.ends,
      attributes: this.told.carried(),
    });
  }

  /**
   * Takes more rows of a cursor of `statement`.
   *
   * @param statement - the statement whose cursor is open
   * @param options - how many rows to take, all by default, and the cursor's number, 0 by default
   * @returns the rows, and whether the cursor has more: closed if not
   * @throws {@link TurborelError} the server's: 24000 if the cursor is not open; 08006 if the connection is lost
   */
  async fetch(statement: Statement, options: CursorOptions = {}): Promise<Batch> {
    await this.send({
      kind: 'fetch',
      statement: statement.number,
      cursor: options.cursor ?? 0,
      rows: options.rows ?? 0,
    });
    return this.#rows();
  }

  /**
   * Closes a cursor of `statement`.
   *
   * @param statement - the statement whose cursor is open
   * @param cursor - the cursor's number, 0 by default
   * @throws {@link TurborelError} the server's: 24000 if it is not open; 08006 if the connection is lost
   */
  async close(statement: Statement, cursor = 0): Promise<void> {
    await this.send({ kind: 'close', statement: statement.number, cursor });
    await this.completion();
  }

  /**
   * Describes `statement` again, as it is now.
   *
   * @param statement - a statement this connection prepared
   * @returns it, its parameters' types and columns as the server now gives them
   * @throws {@link TurborelError} the server's: 26000 if it is no more; 08006 if `describe` was not granted
   */
  async describe(statement: Statement): Promise<Statement> {
    await this.send({ kind: 'describe', what: 'statement', statement: statement.number, cursor: 0 });
    return this.#prepared();
  }

  /**
   * The columns of an open cursor of `statement`.
   *
   * @param statement - the statement whose cursor is open
   * @param cursor - the cursor's number, 0 by default
   * @returns its columns
   * @throws {@link TurborelError} the server's: 24000 if it is not open; 08006 if `describe` was not granted
   */
  async describeCursor(statement: Statement, cursor = 0): Promise<readonly Column[]> {
    await this.send({ kind: 'describe', what: 'cursor', statement: statement.number, cursor });
    const reply = await this.receive();
    if (reply.kind === 'description') return reply.columns;
    throw this.unexpected(reply, 'the server sent no Description');
  }

  /**
   * Destroys `statement`, of no use after.
   *
   * @param statement - a statement this connection prepared
   * @throws {@link TurborelError} the server's: 26000 if it is no more, 24000 if its cursor is open; 08006 if the connection is lost
   */
  async deallocate(statement: Statement): Promise<void> {
    await this.send({ kind: 'deallocate', statement: statement.number });
    await this.completion();
  }

  /**
   * Whether the server answers, with no worker of its taken.
   *
   * @throws {@link TurborelError} 08006 if `ping` was not granted, or the server is gone
   */
  async ping(): Promise<void> {
    await this.send({ kind: 'ping' });
    const reply = await this.receive();
    if (reply.kind !== 'pong') throw this.unexpected(reply, 'the server sent no Pong');
  }

  /**
   * Puts the session back as it was at login: its transaction rolled
   * back, told by notice 01T01; its prepared statements, cursors,
   * temporary tables and settings gone; its user and cancel key kept.
   *
   * @throws {@link TurborelError} 08006 if `reset` was not granted, or the server is gone
   */
  async reset(): Promise<void> {
    await this.send({ kind: 'reset' });
    await this.completion();
  }

  /**
   * Sets the attributes each Query and Execute carries from now on, read
   * in SQL by QUERY_ATTRIBUTE(name).
   *
   * @param attributes - each name and value; none, for none
   * @throws {@link TurborelError} 08006 for attributes if `query-attributes` was not granted
   */
  setQueryAttributes(attributes: readonly Attribute[]): void {
    if (attributes.length > 0 && !this.has(cap.QUERY_ATTRIBUTES)) {
      throw connectionFailure(`the server did not grant ${cap.QUERY_ATTRIBUTES}`);
    }
    this.told.attributes = [...attributes];
  }

  /** @returns the log position of the last commit the server told of, once granted `commit-position` */
  get commitPosition(): bigint | undefined {
    return this.told.position;
  }

  /** @returns the rows the last statement changed, or the rows the last query returned once all were read, once granted `row-counts` */
  get rowsAffected(): bigint | undefined {
    return this.told.completed?.rows;
  }

  /** @returns the server's time for the last statement in microseconds, once granted `row-counts`: total, queued, locks */
  get serverTime(): Timing | undefined {
    return this.told.completed?.time;
  }

  /** @returns the identity values the last INSERT generated, in the order of its rows, once granted `generated-values` */
  get lastGenerated(): readonly string[] {
    return this.told.completed?.generated ?? [];
  }

  /** @returns each condition the last statement raised and completed with, once granted `conditions` */
  get conditions(): readonly TurborelError[] {
    return this.told.completed?.conditions ?? [];
  }

  /** @returns the conditions of `conditions`, taken, so each is told once */
  takeConditions(): TurborelError[] {
    const c = this.told.completed;
    if (c === undefined) return [];
    this.told.completed = { ...c, conditions: [] };
    return [...c.conditions];
  }

  /**
   * The columns a statement's first reply gives.
   *
   * @param reply - the reply
   * @returns its columns
   */
  #columns(reply: Reply): readonly Column[] {
    if (reply.kind === 'description') return reply.columns;
    throw this.unexpected(reply, 'the server sent no result');
  }

  /** @returns the server's Complete, of a request sent */
  protected async completion(): Promise<Completion> {
    const reply = await this.receive();
    if (reply.kind === 'complete') return reply.completion;
    throw this.unexpected(reply, 'the server sent no completion');
  }

  /** @returns the rows the server sends until it says whether the cursor has more, and whether it has */
  async #rows(): Promise<Batch> {
    const rows: Rows = [];
    for (;;) {
      const reply = await this.receive();
      if (reply.kind === 'rows') append(rows, reply.rows);
      else if (reply.kind === 'complete') return { rows, more: false };
      else if (reply.kind === 'suspended') return { rows, more: true };
      else throw this.unexpected(reply, 'the server broke off its rows');
    }
  }

  /**
   * The failure of a reply other than the one awaited: the server's, if it is an Error, else the connection lost.
   *
   * @param reply - the reply
   * @param message - what the server failed to send
   * @returns the failure, to be thrown
   */
  protected unexpected(reply: Reply, message: string): TurborelError {
    return reply.kind === 'error' ? this.failed(reply.failure) : this.lose(message);
  }
}

/**
 * Appends `batch` to `rows`, one by one, so no batch's length bounds it.
 *
 * @param rows - the rows so far
 * @param batch - the batch
 */
function append(rows: Rows, batch: readonly (readonly Value[])[]): void {
  for (const row of batch) rows.push(row);
}
