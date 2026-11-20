/**
 * The driver's standard API (RULES.md D2, D22): `connect` gives a
 * `Client`, a connection whose every operation that waits on the server
 * is `async`: `query` runs a statement, with parameters; `prepare` makes
 * a prepared statement; `cursor` gives an async iterator of a query's
 * rows; `transaction` runs work in a transaction; large objects are
 * Node.js streams; an `AbortSignal` cancels a statement; `close()`, or
 * `await using`, ends it. Beneath it is the low-level client, a
 * `Connection`, which `connection` gives.
 *
 * @packageDocumentation
 */

import type { Readable } from 'node:stream';

import { Cursor, type CursorReadOptions } from './cursor.js';
import { type ResultColumn, resultColumns } from './columns.js';
import type { Completion } from '../codec/replies.js';
import type { Lob, LobKind, LobLocator, Value } from '../codec/values.js';
import { TurborelError, apiMisuse } from '../error.js';
import { Canceller } from '../session/cancel.js';
import type { Connection } from '../session/connection.js';
import type { Outcome, Statement } from '../session/statements.js';
import { type Key, KEYS, Options } from '../settings/options.js';
import { Settings } from '../settings/settings.js';

/** SQLCODE of an invalid transaction state. */
const SQLCODE_TRANSACTION_STATE = -917;
/** SQLCODE and SQLSTATE of a statement cancelled, as the server fails one. */
const CANCELLED = { sqlcode: -920, sqlstate: 'TB920' } as const;

/** The settings of a connection, by their names, as a URI's query writes them; and whether autocommit is on. */
export type ConnectOptions = Partial<Readonly<Record<Key, string | number | boolean>>> & {
  readonly autocommit?: boolean;
};

/** How a statement runs: an `AbortSignal` that cancels it. */
export interface RunOptions {
  /** Cancels the statement as it is aborted. */
  readonly signal?: AbortSignal;
}

/** What a statement gave. */
export interface Result {
  /** A query's rows, each a value for each column; none of another statement. */
  readonly rows: readonly (readonly Value[])[];
  /** A query's columns; none of another statement. */
  readonly columns: readonly ResultColumn[];
  /** The rows a statement changed or a query returned, as the server counts them, where it does. */
  readonly rowCount: bigint | undefined;
  /** Its completion: its SQLCODE and SQLSTATE, a warning's among them; of a query, undefined. */
  readonly completion: Completion | undefined;
}

/**
 * The settings of `settings`: a URI, or options by name.
 *
 * @param settings - a `turborel://` URI, or options
 * @returns the settings
 * @throws {@link TurborelError} 08001 if one cannot be read
 */
export function settingsOf(settings: string | ConnectOptions): Settings {
  if (typeof settings === 'string') return Settings.fromUri(settings);
  const options = new Options();
  for (const key of KEYS) {
    const value = settings[key];
    if (value !== undefined) options.set(key, String(value));
  }
  return Settings.resolve(options);
}

/**
 * The result of an outcome.
 *
 * @param outcome - what a statement gave
 * @param conn - the connection, for the count it told
 * @returns the result
 */
function resultOf(outcome: Outcome, conn: Connection): Result {
  if (outcome.kind === 'rows') {
    return {
      rows: outcome.rows,
      columns: resultColumns(outcome.columns),
      rowCount: conn.rowsAffected,
      completion: undefined,
    };
  }
  return { rows: [], columns: [], rowCount: outcome.completion.rows, completion: outcome.completion };
}

/** One operation of a connection at a time, in the order asked. */
export class Turns {
  #last: Promise<unknown> = Promise.resolve();

  /**
   * Runs `work` once the operations asked before it are done.
   *
   * @param work - the operation
   * @returns what it gives
   */
  run<T>(work: () => Promise<T>): Promise<T> {
    const next = this.#last.then(work, work);
    this.#last = next.catch(() => undefined);
    return next;
  }
}

/** A connection of the standard API. */
export class Client {
  /** The low-level connection beneath it, for what the standard API has no place for. */
  readonly connection: Connection;
  readonly #turns = new Turns();
  readonly #onClose: (conn: Connection) => Promise<void>;
  #closed = false;

  /**
   * A client of `connection`.
   *
   * @param connection - the connection
   * @param onClose - what ends it: by default, Terminate
   */
  constructor(connection: Connection, onClose: (conn: Connection) => Promise<void> = (c) => c.terminate()) {
    this.connection = connection;
    this.#onClose = onClose;
  }

  /**
   * Runs `work` in the connection's turn, cancelling its statement if `signal` aborts.
   *
   * @param work - what to run
   * @param signal - what cancels it, if anything
   * @returns what it gives
   */
  turn<T>(work: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (this.#closed) return Promise.reject(apiMisuse('the connection is closed'));
    return this.#turns.run(async () => {
      if (signal?.aborted === true) {
        throw new TurborelError(
          CANCELLED.sqlcode,
          CANCELLED.sqlstate,
          'the statement was cancelled before it was sent',
        );
      }
      const cancel = (): void => {
        void Canceller.of(this.connection)
          ?.cancel()
          .catch(() => undefined);
      };
      signal?.addEventListener('abort', cancel, { once: true });
      try {
        return await work();
      } finally {
        signal?.removeEventListener('abort', cancel);
      }
    });
  }

  /**
   * Runs `sql`, a statement, its `?` taking `params` in order.
   *
   * @param sql - the statement
   * @param params - a value for each `?`
   * @param options - an `AbortSignal` that cancels it
   * @returns its rows and columns, or its count and completion
   * @throws {@link TurborelError} the statement's failure; TB920 if it was cancelled
   */
  query(sql: string, params: readonly Value[] = [], options: RunOptions = {}): Promise<Result> {
    return this.turn(async () => {
      if (params.length === 0) return resultOf(await this.connection.query(sql), this.connection);
      const statement = await this.connection.prepare(sql);
      try {
        return resultOf(await this.connection.execute(statement, params), this.connection);
      } finally {
        await this.connection.deallocate(statement).catch(() => undefined);
      }
    }, options.signal);
  }

  /**
   * Prepares `sql`, its parameters written `?`.
   *
   * @param sql - the statement
   * @returns the statement, to execute as often as wanted
   * @throws {@link TurborelError} the server's: 37000 if it is not preparable
   */
  async prepare(sql: string): Promise<PreparedStatement> {
    return new PreparedStatement(this, await this.turn(() => this.connection.prepare(sql)));
  }

  /**
   * A cursor of `sql`, a query, its rows read as they are asked for, a batch at a time.
   *
   * @param sql - the query
   * @param params - a value for each `?`
   * @param options - its batch, and an `AbortSignal`
   * @returns the cursor, an async iterator of rows
   */
  async cursor(sql: string, params: readonly Value[] = [], options: CursorReadOptions = {}): Promise<Cursor> {
    const statement = await this.turn(() => this.connection.prepare(sql));
    return Cursor.open(this, statement, params, { ...options, owned: true });
  }

  /** @returns whether each statement is its own transaction */
  get autocommit(): boolean {
    return this.connection.autocommit;
  }

  /** @param on - whether each statement is its own transaction from now on */
  set autocommit(on: boolean) {
    this.connection.setAutocommit(on);
  }

  /** @returns whether a transaction is active */
  get inTransaction(): boolean {
    return this.connection.inTransaction;
  }

  /** Commits the transaction. */
  async commit(): Promise<void> {
    await this.query('COMMIT');
  }

  /** Rolls the transaction back. */
  async rollback(): Promise<void> {
    await this.query('ROLLBACK');
  }

  /**
   * Runs `work` in a transaction of its own: committed as it succeeds, rolled back as it fails, autocommit off within it.
   *
   * @param work - the work, given this client
   * @returns what it gives
   * @throws {@link TurborelError} 25000 if a transaction is active already; what the work throws, the transaction rolled back; a failing commit's
   */
  async transaction<T>(work: (client: this) => Promise<T>): Promise<T> {
    if (this.inTransaction)
      throw new TurborelError(SQLCODE_TRANSACTION_STATE, '25000', 'a transaction is active already');
    const autocommit = this.autocommit;
    this.autocommit = false;
    try {
      const done = await work(this);
      await this.commit();
      return done;
    } catch (e) {
      if (this.connection.inTransaction && !this.connection.isLost) await this.rollback().catch(() => undefined);
      throw e;
    } finally {
      this.autocommit = autocommit;
    }
  }

  /**
   * A large object's octets as a Node.js readable stream.
   *
   * @param lob - a large object a result gave, whole or by its locator
   * @returns the stream
   */
  readLob(lob: Lob | LobLocator): Readable {
    return this.connection.lobReader(lob);
  }

  /**
   * A new large object written from `source`, a Node.js stream or any async iterable of octets or text.
   *
   * @param kind - character or binary
   * @param source - the value's pieces
   * @returns its locator, to pass as a parameter, valid until the transaction ends
   */
  writeLob(
    kind: LobKind,
    source: AsyncIterable<Uint8Array | string> | Iterable<Uint8Array | string>,
  ): Promise<LobLocator> {
    return this.turn(async () => {
      const writer = await this.connection.createLob(kind);
      for await (const piece of source) await writer.write(piece);
      return writer.finish();
    });
  }

  /** @returns whether it is closed, or its connection lost */
  get closed(): boolean {
    return this.#closed || this.connection.isLost;
  }

  /** Ends the connection, once its operations are done; again, nothing. */
  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    await this.#turns.run(() => this.#onClose(this.connection));
  }

  /** Closes it, as `await using` disposes of it. */
  async [Symbol.asyncDispose](): Promise<void> {
    await this.close();
  }
}

/** A statement prepared by a client, executed as often as wanted. */
export class PreparedStatement {
  readonly #client: Client;
  /** The statement, as the low-level client gives it. */
  readonly statement: Statement;
  #closed = false;

  /**
   * A prepared statement of `client`.
   *
   * @param client - its client
   * @param statement - the statement
   */
  constructor(client: Client, statement: Statement) {
    [this.#client, this.statement] = [client, statement];
  }

  /** @returns the columns of its rows, of a query; of a CALL, its output parameters' */
  get columns(): readonly ResultColumn[] {
    return resultColumns(this.statement.columns);
  }

  /** @returns how many parameters it takes */
  get parameterCount(): number {
    return this.statement.parameters.length;
  }

  /**
   * Executes it with `params`.
   *
   * @param params - a value for each `?`
   * @param options - an `AbortSignal` that cancels it
   * @returns its rows and columns, or its count and completion
   */
  execute(params: readonly Value[] = [], options: RunOptions = {}): Promise<Result> {
    const conn = this.#client.connection;
    return this.#client.turn(async () => resultOf(await conn.execute(this.statement, params), conn), options.signal);
  }

  /**
   * A cursor of it, a query, with `params`.
   *
   * @param params - a value for each `?`
   * @param options - its batch, and an `AbortSignal`
   * @returns the cursor
   */
  cursor(params: readonly Value[] = [], options: CursorReadOptions = {}): Promise<Cursor> {
    return Cursor.open(this.#client, this.statement, params, { ...options, owned: false });
  }

  /** Destroys it; again, nothing. */
  async close(): Promise<void> {
    if (this.#closed || this.#client.closed) return;
    this.#closed = true;
    await this.#client.turn(() => this.#client.connection.deallocate(this.statement));
  }

  /** Closes it, as `await using` disposes of it. */
  async [Symbol.asyncDispose](): Promise<void> {
    await this.close();
  }
}

/**
 * Connects as `settings` say: a `turborel://` URI, or options by name.
 *
 * @param settings - the URI, or options
 * @returns the client
 * @throws {@link TurborelError} 08001 if a setting cannot be read, or no server is kept; 28000 if the user is refused
 */
export async function connect(settings: string | ConnectOptions): Promise<Client> {
  const client = new Client(await settingsOf(settings).connect());
  if (typeof settings !== 'string' && settings.autocommit !== undefined) client.autocommit = settings.autocommit;
  return client;
}
