/**
 * A connection to a server (`[CLIENT Connecting]`): its link
 * (`link.ts`), the statements it runs (`runner.ts`), and, here, its large
 * objects (`[CLIENT Large objects]`), copies and exports
 * (`[CLIENT Copying and exporting]`), as turborel-client's `lobs.rs`,
 * `copy.rs` and `export.rs` give them.
 *
 * @packageDocumentation
 */

import type { Readable } from 'node:stream';

import { Canceller } from './cancel.js';
import { Copying } from './copy.js';
import { Debugger } from './debugger.js';
import { type ExportFormat, type ExportTarget, exportSink, nativeEnd } from './export.js';
import type { OpenOptions } from './link.js';
import { CHUNK_OCTETS, LobWriter, completed, heldRange, lobStream, octetsOf } from './lobs.js';
import { Pipeline } from './pipeline.js';
import { Runner } from './runner.js';
import * as cap from './capabilities.js';
import { Offer } from './told.js';
import type { Completion } from '../codec/replies.js';
import type { LobRequest } from '../codec/requests.js';
import { Lob, type LobKind, LobLocator, type Value } from '../codec/values.js';
import { connectionFailure, dataException } from '../error.js';
import type { Mechanism } from '../auth/mechanism.js';
import type { FrameStream } from '../transport/frames.js';

export { CONNECT_WITHIN, DEFAULT_TIMEOUTS, TERMINATE_WITHIN, VERSION, capabilitiesOf, endsConnection } from './link.js';
export type { OpenOptions, Timeouts } from './link.js';

/** The most statements a borrower may leave prepared for the connection to be given back rather than closed. */
export const RESET_MOST_STATEMENTS = 256;

/** SQLSTATE 22000, a data exception: a large object used as it cannot be. */
const DATA_EXCEPTION = '22000';

/** A connection to a server: its session, the statements it runs there, and its large objects, copies and exports. */
export class Connection extends Runner {
  #debugger: Debugger | undefined;

  /**
   * Opens a connection over `stream` as `user`, proved by `mechanism`.
   *
   * @param stream - a connected socket's frames
   * @param user - the user, read by the server as an identifier
   * @param mechanism - what proves the user
   * @param options - what it asks for, how long it waits, and where its server is
   * @returns the connection, logged in
   * @throws {@link TurborelError} the server's refusal, as 28000 or 08004; 08006 if the connection is lost
   */
  static async open(
    stream: FrameStream,
    user: string,
    mechanism: Mechanism,
    options: OpenOptions = {},
  ): Promise<Connection> {
    const connection = new Connection(stream, options);
    await connection.begin(user, mechanism, options.offer ?? Offer.default());
    return connection;
  }

  /** @returns this connection's routine debugger, which drives the routines another connection's session runs, once the server granted `debugger` *(extension)* */
  get debugger(): Debugger {
    this.#debugger ??= new Debugger(this, this.told.events);
    return this.#debugger;
  }

  /** @returns what cancels the statement this connection runs, from elsewhere; none for a connection over a stream given to `open`, whose server it cannot reach again */
  canceller(): Canceller | undefined {
    return Canceller.of(this);
  }

  /**
   * At most a chunk, 256 KiB, of a large object: of its octets from
   * `from`, or of a CLOB's characters, whole ones. Fewer than asked only
   * at its end, or at a chunk's.
   *
   * @param lob - a large object a result gave, whole or by its locator
   * @param from - the first octet or character, from 0
   * @param count - how many at most
   * @param characters - whether to count a CLOB's characters
   * @returns the octets read
   * @throws {@link TurborelError} the server's: 0F001 if its locator is no longer valid; 08006 if the connection is lost
   */
  async readLob(lob: Lob | LobLocator, from: bigint, count: bigint, characters = false): Promise<Uint8Array> {
    if (lob instanceof Lob) return heldRange(lob, from, count, characters);
    const reply = await this.#lob({ op: 'read', locator: lob.locator, from, count, characters });
    if (reply.kind === 'lobData') return reply.data;
    throw this.lose('the server sent a locator for a Read');
  }

  /**
   * A large object's octets as a stream, read a chunk at a time.
   *
   * @param lob - a large object a result gave
   * @returns a readable stream of its octets
   */
  lobReader(lob: Lob | LobLocator): Readable {
    const octets = lob instanceof Lob ? BigInt(octetsOf(lob).byteLength) : lob.octets;
    return lobStream((from) => this.readLob(lob, from, BigInt(CHUNK_OCTETS)), octets);
  }

  /**
   * A new large object, written a piece at a time.
   *
   * @param kind - character or binary
   * @returns its writer
   * @throws {@link TurborelError} 08006 if the connection is lost; the server's
   */
  async createLob(kind: LobKind): Promise<LobWriter> {
    const reply = await this.#lob({ op: 'create', lobKind: kind });
    if (reply.kind === 'lobLocator') return new LobWriter(this, kind, reply.locator);
    throw this.lose('the server sent data for a Create');
  }

  /**
   * Ends a large object's locator, and the value it named.
   *
   * @param lob - a large object a result gave by its locator
   * @returns the completion
   * @throws {@link TurborelError} 0F001 if it is not valid; 22000 for one sent whole, which has no locator
   */
  async freeLob(lob: Lob | LobLocator): Promise<Completion> {
    return await completed(this, { kind: 'lob', lob: { op: 'free', locator: locatorOf(lob) } });
  }

  /**
   * Keeps a large object's locator valid past its transaction's commit, until it is freed or a rollback.
   *
   * @param lob - a large object a result gave by its locator
   * @returns the completion
   * @throws {@link TurborelError} 0F001 if it is not valid; 22000 for one sent whole, which has no locator
   */
  async holdLob(lob: Lob | LobLocator): Promise<Completion> {
    return await completed(this, { kind: 'lob', lob: { op: 'hold', locator: locatorOf(lob) } });
  }

  /**
   * The server's Lob reply to `lob`.
   *
   * @param lob - the operation
   * @returns the reply
   */
  async #lob(
    lob: LobRequest,
  ): Promise<{ kind: 'lobData'; data: Uint8Array } | { kind: 'lobLocator'; locator: number }> {
    await this.send({ kind: 'lob', lob });
    const reply = await this.receive();
    if (reply.kind === 'lobData' || reply.kind === 'lobLocator') return reply;
    throw this.unexpected(reply, 'the server sent no Lob reply');
  }

  /**
   * Begins a copy into `table`, as SQL names it, of `columns`, in order,
   * all of the table's if none: the copy its own transaction under
   * autocommit. Until it ends, the connection sends nothing else.
   *
   * @param table - the table
   * @param columns - its columns, or none for all
   * @returns the copy
   * @throws {@link TurborelError} 08006 if `copy` was not granted, or the connection is lost; the table not found comes as `finish`'s failure
   */
  async copyIn(table: string, columns: readonly string[] = []): Promise<Copying> {
    return this.copyBegin(table, columns, this.autocommit);
  }

  /**
   * Begins a copy into `table`'s `columns`, its transaction ended with it if `ends`.
   *
   * @param table - the table
   * @param columns - its columns
   * @param ends - whether the transaction ends with it
   * @returns the copy
   */
  async copyBegin(table: string, columns: readonly string[], ends: boolean): Promise<Copying> {
    await this.send({ kind: 'copyIn', table, columns, ends });
    return new Copying(this);
  }

  /**
   * Copies the rows `rows` gives into `table`'s `columns`, abandoning the copy if a row cannot be sent.
   *
   * @param table - the table
   * @param columns - its columns, or none for all
   * @param rows - the rows, as an iterable or an async iterable
   * @returns the rows inserted
   * @throws {@link TurborelError} as `copyIn`'s and `finish`'s; what the iterable throws, the copy abandoned
   */
  async copyRows(
    table: string,
    columns: readonly string[],
    rows: Iterable<readonly Value[]> | AsyncIterable<readonly Value[]>,
  ): Promise<bigint> {
    await using copying = await this.copyIn(table, columns);
    for await (const row of rows) await copying.send(row);
    return await copying.finish();
  }

  /** @returns a pipeline of requests on this connection, empty, continuing past a failure */
  pipeline(): Pipeline {
    return new Pipeline({
      inTransaction: () => this.inTransaction,
      autocommit: () => this.autocommit,
      isLost: () => this.isLost,
      attributes: () => this.told.carried(),
      sendAll: (requests) => this.sendAll(requests),
      queryReply: () => this.queryReply(),
      executeReply: (statement) => this.executeReply(statement),
      completion: async () => ({ kind: 'done', completion: await this.completion() }),
    });
  }

  /**
   * Puts the session back as it logged in, for the next to use, as a
   * pool gives a connection back: autocommit off; by the protocol's Reset
   * where the server grants it; else, in one pipeline, its transaction
   * rolled back, the statements it prepared closed and destroyed, its
   * user, schema and time zone those of its login; then `more`.
   *
   * @param more - statements run after, as a pool's `reset`
   * @throws {@link TurborelError} 08006 for a connection lost, or past 256 statements left prepared; any statement's failure but those destroying statements already gone
   */
  async giveBack(more: readonly string[] = []): Promise<void> {
    if (this.isLost) throw connectionFailure('a lost connection is not given back');
    this.setAutocommit(false);
    if (this.has(cap.RESET)) {
      await this.reset();
      this.forgetStatements();
      for (const sql of more) await this.query(sql);
      return;
    }
    const prepared = this.nextStatement;
    if (prepared > RESET_MOST_STATEMENTS) throw connectionFailure('too many statements were left prepared to destroy');
    const login = quotedName(this.authorization);
    const pipeline = this.pipeline().query('ROLLBACK');
    for (let n = 0; n < prepared; n += 1) pipeline.release(n);
    pipeline.query(`SET SESSION AUTHORIZATION ${login}`).query(`SET SCHEMA ${login}`).query('SET TIME ZONE LOCAL');
    for (const sql of more) pipeline.query(sql);
    const outcomes = await pipeline.run();
    // Each statement released is a Close and a Deallocate.
    const releases = prepared + prepared;
    const kept = [outcomes[0], ...outcomes.slice(1 + releases)];
    const failed = kept.find((o) => o?.kind === 'failed');
    if (failed?.kind === 'failed') throw failed.failure;
    this.forgetStatements();
  }

  /**
   * Runs the query `sql` and writes its rows to `out` as `format` says, as they come.
   *
   * @param sql - the query
   * @param out - what takes the bytes, each write awaited
   * @param format - CSV, with a header of the columns' names, or native rows
   * @returns how many rows
   * @throws {@link TurborelError} the query's, as `queryInto`'s; 08006 for a statement that is no query
   */
  async export(sql: string, out: ExportTarget, format: ExportFormat): Promise<number> {
    const streamed = await this.queryInto(sql, exportSink(out, format));
    if (streamed.kind !== 'rows') throw connectionFailure('an export runs a query');
    if (format === 'native') await out.write(nativeEnd());
    return streamed.count;
  }
}

/**
 * `name` as a character string literal of a delimited identifier, as SET SESSION AUTHORIZATION and SET SCHEMA take one.
 *
 * @param name - the name
 * @returns the literal
 */
function quotedName(name: string): string {
  return `'"${name.replaceAll('"', '""').replaceAll("'", "''")}"'`;
}

/**
 * The locator of a large object a result sent by one.
 *
 * @param lob - the large object
 * @returns its locator
 * @throws {@link TurborelError} 22000 for one sent whole
 */
function locatorOf(lob: Lob | LobLocator): number {
  if (lob instanceof LobLocator) return lob.locator;
  throw dataException(DATA_EXCEPTION, 'the large object was sent whole: it has no locator');
}
