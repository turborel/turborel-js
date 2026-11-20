/**
 * An import under way (`[CLIENT Importing]`), as turborel-client's
 * `import/insert.rs` and `import/copied.rs` run one: by the prepared
 * INSERT, a row at a time, a batch to each transaction; or by bulk copy,
 * a batch to each copy, each copy committing its batch as it ends, a row
 * the server refuses failing its copy, the failure's detail naming the
 * row, so the import says its record as it would of a row inserted alone.
 *
 * @packageDocumentation
 */

import {
  type Cause,
  DEFAULT_BATCH,
  type ImportOptions,
  ImportError,
  type Imported,
  type Rejected,
  assigned,
  cancelled,
  copies,
  longLob,
  prepared,
  sqlCause,
} from './import.js';
import { type Position, type Source, SourceError, type SourceRecord } from './source.js';
import type { Parameter } from '../codec/composite.js';
import type { Value } from '../codec/values.js';
import { TurborelError } from '../error.js';
import type { Connection } from '../session/connection.js';
import type { Copying } from '../session/copy.js';
import { endsConnection } from '../session/link.js';
import type { Statement } from '../session/statements.js';

/** What the server's detail of a row a copy refused is: `row 7 of the copy`. */
const COPY_ROW = /^row (\d+) of the copy$/u;

/**
 * Inserts `source`'s records into the table `options` names, over `conn`,
 * whose session has no transaction active, as an import commits its
 * batches.
 *
 * @param conn - the connection
 * @param source - where the rows come from
 * @param options - the table, the batch, and whether bad rows are skipped
 * @returns the rows committed, and those skipped
 * @throws {@link ImportError} why it stopped, where, and how many rows were committed; the batch under way rolled back
 */
export async function importInto(conn: Connection, source: Source, options: ImportOptions): Promise<Imported> {
  const { insert, columns, table } = await prepared(conn, source, options);
  if (copies(conn, insert, options)) {
    const types = insert.parameters;
    try {
      await conn.deallocate(insert);
    } catch (e) {
      throw new ImportError(undefined, sqlCause(e), { committed: 0n, rolledBack: 0n });
    }
    return new CopiedRun(conn, options, types).run(source, table, columns);
  }
  const run = new InsertRun(conn, insert, options);
  let done: Imported | undefined;
  let failure: unknown;
  try {
    done = await run.rows(source);
  } catch (e) {
    failure = e;
  }
  if (conn.isLost) throw failure;
  try {
    await conn.deallocate(insert);
  } catch (e) {
    if (failure === undefined) {
      throw new ImportError(undefined, sqlCause(e), { committed: done?.rows ?? 0n, rolledBack: 0n });
    }
  }
  if (done === undefined) throw failure;
  return done;
}

/**
 * The next record of `source`.
 *
 * @param source - the source
 * @param stop - what makes the import's error
 * @returns it, or undefined at the end
 */
async function nextRecord(
  source: Source,
  stop: (at: Position | undefined, cause: Cause) => Promise<ImportError> | ImportError,
): Promise<SourceRecord | undefined> {
  try {
    return await source.record();
  } catch (e) {
    if (e instanceof SourceError) throw await stop(e.at, { kind: 'input', message: e.why });
    throw await stop(undefined, sqlCause(e));
  }
}

/** An import by the prepared INSERT under way. */
class InsertRun {
  readonly #conn: Connection;
  readonly #insert: Statement;
  readonly #options: ImportOptions;
  #committed = 0n;
  #inBatch = 0n;
  #rejected = 0n;

  /**
   * An import by `insert`.
   *
   * @param conn - the connection
   * @param insert - the INSERT
   * @param options - the import
   */
  constructor(conn: Connection, insert: Statement, options: ImportOptions) {
    [this.#conn, this.#insert, this.#options] = [conn, insert, options];
  }

  /**
   * Inserts each of `source`'s records, then commits the last batch.
   *
   * @param source - the source
   * @returns what it did
   */
  async rows(source: Source): Promise<Imported> {
    for (;;) {
      const record = await nextRecord(source, (at, cause) => this.#stop(at, cause));
      if (record === undefined) break;
      await this.#row(record);
    }
    await this.#commit();
    return { rows: this.#committed, rejected: this.#rejected };
  }

  /**
   * Inserts `record`, committing its batch if it ends one.
   *
   * @param record - the record
   */
  async #row(record: SourceRecord): Promise<void> {
    const wanted = this.#insert.parameters.length;
    if (record.values.length !== wanted) {
      const message = `${String(record.values.length)} fields, for ${String(wanted)} columns`;
      await this.#reject({ position: record.position, cause: { kind: 'input', message } });
      return;
    }
    try {
      const values = await this.#located(assigned(record.values, this.#insert.parameters));
      await this.#conn.execute(this.#insert, values);
    } catch (e) {
      const failure = e instanceof TurborelError ? e : undefined;
      // A row is skipped only if it alone was undone: the batch's
      // transaction goes on, and the connection.
      const alone = this.#inBatch === 0n || this.#conn.inTransaction;
      if (failure === undefined || !alone || endsConnection(failure) || cancelled(failure) || this.#conn.isLost) {
        throw await this.#stop(record.position, sqlCause(e));
      }
      await this.#reject({ position: record.position, cause: sqlCause(failure) });
      return;
    }
    this.#inBatch += 1n;
    if (this.#inBatch === BigInt(this.#options.batch ?? DEFAULT_BATCH)) await this.#commit();
  }

  /**
   * `values`, each long one for a large object parameter sent ahead a piece at a time and given by its locator.
   *
   * @param values - the values
   * @returns them, the long ones as locators
   */
  async #located(values: Value[]): Promise<Value[]> {
    const types: readonly Parameter[] = this.#insert.parameters;
    const out: Value[] = [];
    for (const [i, v] of values.entries()) {
      const type = types[i]?.type;
      const long = type?.kind === 'clob' || type?.kind === 'blob' ? longLob(v) : undefined;
      if (long === undefined) {
        out.push(v);
        continue;
      }
      const writer = await this.#conn.createLob(type?.kind === 'clob' ? 'character' : 'binary');
      await writer.write(long);
      out.push(await writer.finish());
    }
    return out;
  }

  /**
   * Skips `row` and gives it to the program, if the import skips bad rows; else stops.
   *
   * @param row - the row
   */
  async #reject(row: Rejected): Promise<void> {
    if (this.#options.skip !== true) throw await this.#stop(row.position, row.cause);
    this.#rejected += 1n;
    this.#options.rejected?.(row);
  }

  /**
   * Stops the import, the batch under way rolled back.
   *
   * @param at - where, if a record
   * @param cause - why
   * @returns the error
   */
  async #stop(at: Position | undefined, cause: Cause): Promise<ImportError> {
    if (!this.#conn.isLost && this.#conn.inTransaction) {
      // The import has failed already: a rollback that fails too loses
      // the connection, which ends the session's transaction.
      await this.#conn.query('ROLLBACK').catch(() => undefined);
    }
    return new ImportError(at, cause, { committed: this.#committed, rolledBack: this.#inBatch });
  }

  /** Commits the batch under way, if a transaction is active. */
  async #commit(): Promise<void> {
    if (this.#conn.inTransaction) {
      try {
        await this.#conn.query('COMMIT');
      } catch (e) {
        throw new ImportError(undefined, sqlCause(e), { committed: this.#committed, rolledBack: this.#inBatch });
      }
    }
    this.#committed += this.#inBatch;
    this.#inBatch = 0n;
  }
}

/** An import by bulk copy under way. */
class CopiedRun {
  readonly #conn: Connection;
  readonly #options: ImportOptions;
  readonly #types: readonly Parameter[];
  #committed = 0n;
  /** Where each record of the batch under way began. */
  #batch: Position[] = [];

  /**
   * An import by copy of rows checked as `types` take them.
   *
   * @param conn - the connection
   * @param options - the import
   * @param types - the INSERT's parameters
   */
  constructor(conn: Connection, options: ImportOptions, types: readonly Parameter[]) {
    [this.#conn, this.#options, this.#types] = [conn, options, types];
  }

  /**
   * Stops the import, `rolledBack` rows of the batch undone.
   *
   * @param at - where, if a record
   * @param cause - why
   * @param rolledBack - the rows undone
   * @returns the error
   */
  #stop(at: Position | undefined, cause: Cause, rolledBack = this.#batch.length): ImportError {
    return new ImportError(at, cause, { committed: this.#committed, rolledBack: BigInt(rolledBack) });
  }

  /**
   * Imports every batch of `source`.
   *
   * @param source - the source
   * @param table - the table, delimited
   * @param columns - its columns, delimited
   * @returns what it did
   */
  async run(source: Source, table: string, columns: string[]): Promise<Imported> {
    while (await this.#copied(source, table, columns));
    return { rows: this.#committed, rejected: 0n };
  }

  /**
   * The next record, checked as the INSERT's parameters take it.
   *
   * @param source - the source
   * @returns where it began and its values, or undefined at the end
   */
  async #checked(source: Source): Promise<[Position, Value[]] | undefined> {
    const record = await nextRecord(source, (at, cause) => this.#stop(at, cause));
    if (record === undefined) return undefined;
    const wanted = this.#types.length;
    if (record.values.length !== wanted) {
      const message = `${String(record.values.length)} fields, for ${String(wanted)} columns`;
      throw this.#stop(record.position, { kind: 'input', message });
    }
    try {
      return [record.position, assigned(record.values, this.#types)];
    } catch (e) {
      throw this.#stop(record.position, sqlCause(e));
    }
  }

  /**
   * Copies a batch of records, its copy begun at its first and ended at its last, abandoned if a record fails first.
   *
   * @param source - the source
   * @param table - the table
   * @param columns - its columns
   * @returns whether records may follow
   */
  async #copied(source: Source, table: string, columns: string[]): Promise<boolean> {
    let next = await this.#checked(source);
    if (next === undefined) return false;
    let copy: Copying;
    try {
      copy = await this.#conn.copyBegin(table, columns, true);
    } catch (e) {
      throw this.#stop(undefined, sqlCause(e), 0);
    }
    try {
      while (next !== undefined) {
        const [at, values] = next;
        try {
          await copy.send(values);
        } catch (e) {
          throw this.#stop(at, sqlCause(e));
        }
        this.#batch.push(at);
        if (this.#batch.length === (this.#options.batch ?? DEFAULT_BATCH)) {
          await this.#ended(copy);
          return true;
        }
        next = await this.#checked(source);
      }
      await this.#ended(copy);
      return false;
    } finally {
      await copy[Symbol.asyncDispose]().catch(() => undefined);
    }
  }

  /**
   * Ends the batch's copy: its rows committed, or why it failed, at the row it names.
   *
   * @param copy - the copy
   */
  async #ended(copy: Copying): Promise<void> {
    try {
      this.#committed += await copy.finish();
      this.#batch = [];
    } catch (e) {
      const detail = e instanceof TurborelError ? e.diagnostics?.detail : undefined;
      const row = Number(COPY_ROW.exec(detail ?? '')?.[1] ?? 0);
      const named = row > 0 && row <= this.#batch.length;
      throw this.#stop(named ? this.#batch[row - 1] : undefined, sqlCause(e), named ? row - 1 : this.#batch.length);
    }
  }
}
