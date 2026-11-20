/**
 * A cursor of the standard API (RULES.md D2, D22): an async iterator of a
 * query's rows, read by `for await`, a batch fetched as the rows before it
 * are taken, so a result of any size is held a batch at a time. Its
 * statement is the cursor's own, destroyed as it closes, or a prepared
 * statement's, kept.
 *
 * @packageDocumentation
 */

import type { Client } from './client.js';
import { type ResultColumn, resultColumns } from './columns.js';
import type { Value } from '../codec/values.js';
import type { Statement } from '../session/statements.js';

/** The rows a cursor fetches at a time unless told. */
export const DEFAULT_CURSOR_BATCH = 100;

/** How a cursor reads its rows. */
export interface CursorReadOptions {
  /** The rows fetched at a time: 100 by default. */
  readonly batch?: number;
  /** Cancels the statement as it is aborted, as it opens or fetches. */
  readonly signal?: AbortSignal;
}

/** A query's rows, as they are asked for. */
export class Cursor implements AsyncIterable<readonly Value[]> {
  readonly #client: Client;
  readonly #statement: Statement;
  readonly #owned: boolean;
  readonly #batch: number;
  readonly #signal: AbortSignal | undefined;
  #rows: (readonly Value[])[] = [];
  #more = true;
  #closed = false;

  /**
   * A cursor of `statement`, not yet open.
   *
   * @param client - its client
   * @param statement - its statement
   * @param options - its batch, its signal, and whether its statement is its own
   */
  private constructor(client: Client, statement: Statement, options: CursorReadOptions & { owned: boolean }) {
    [this.#client, this.#statement, this.#owned] = [client, statement, options.owned];
    this.#batch = options.batch ?? DEFAULT_CURSOR_BATCH;
    this.#signal = options.signal;
  }

  /**
   * Opens a cursor of `statement` with `params`, taking its first batch.
   *
   * @param client - the client
   * @param statement - a query it prepared
   * @param params - a value for each `?`
   * @param options - its batch, its signal, and whether its statement is its own
   * @returns the cursor
   */
  static async open(
    client: Client,
    statement: Statement,
    params: readonly Value[],
    options: CursorReadOptions & { owned: boolean },
  ): Promise<Cursor> {
    const cursor = new Cursor(client, statement, options);
    try {
      const batch = await client.turn(
        () => client.connection.openCursor(statement, params, { rows: cursor.#batch }),
        options.signal,
      );
      [cursor.#rows, cursor.#more] = [[...batch.rows], batch.more];
    } catch (e) {
      await cursor.#release(false);
      throw e;
    }
    return cursor;
  }

  /** @returns the columns of its rows */
  get columns(): readonly ResultColumn[] {
    return resultColumns(this.#statement.columns);
  }

  /**
   * The next row, a batch fetched when the rows before it are taken.
   *
   * @returns the row, or undefined once all are read
   */
  async next(): Promise<readonly Value[] | undefined> {
    if (this.#rows.length === 0 && this.#more && !this.#closed) {
      const batch = await this.#client.turn(
        () => this.#client.connection.fetch(this.#statement, { rows: this.#batch }),
        this.#signal,
      );
      [this.#rows, this.#more] = [[...batch.rows], batch.more];
    }
    const row = this.#rows.shift();
    if (row === undefined) await this.close();
    return row;
  }

  /**
   * Its rows, read by `for await`; leaving the loop early closes it.
   *
   * @returns an async iterator of its rows
   */
  async *[Symbol.asyncIterator](): AsyncGenerator<readonly Value[]> {
    try {
      for (let row = await this.next(); row !== undefined; row = await this.next()) yield row;
    } finally {
      await this.close();
    }
  }

  /**
   * Ends the cursor, closing it on the server if it is open, and its own statement.
   *
   * @param open - whether the cursor may be open on the server
   */
  async #release(open: boolean): Promise<void> {
    this.#closed = true;
    if (this.#client.closed) return;
    const conn = this.#client.connection;
    await this.#client.turn(async () => {
      if (open) await conn.close(this.#statement);
      if (this.#owned) await conn.deallocate(this.#statement);
    });
  }

  /** Closes it; again, nothing. */
  async close(): Promise<void> {
    if (this.#closed) return;
    const open = this.#more;
    [this.#rows, this.#more] = [[], false];
    await this.#release(open);
  }

  /** Closes it, as `await using` disposes of it. */
  async [Symbol.asyncDispose](): Promise<void> {
    await this.close();
  }
}
