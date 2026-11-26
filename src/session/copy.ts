/**
 * Bulk copy in (`[CLIENT Copying and exporting]`), as turborel-client's
 * `copy.rs` copies: rows sent into a table with no round trip but the
 * copy's end, in messages of about 256 KiB of rows; the end's reply the
 * rows inserted, or the copy's failure, every row of it undone. A copy is
 * all or nothing, within the transaction, or its own under autocommit. A
 * copy given up, or disposed of before it ends, is abandoned, so the
 * connection takes requests again. Rows of text go by column, in
 * CopyColumns, once the server grants `columns`, mixed with rows of
 * values as they come.
 *
 * @packageDocumentation
 */

import { Cells } from './cells.js';
import { completed } from './lobs.js';
import type { Link } from './link.js';
import { rowSize } from '../codec/composite.js';
import type { Value } from '../codec/values.js';
import { COLUMNS } from './capabilities.js';
import { connectionFailure } from '../error.js';

/** About the bytes of rows a CopyData carries at most: 256 KiB. */
export const CHUNK_BYTES = 262_144;

/** A copy under way, over its connection. */
export class Copying {
  readonly #conn: Link;
  #waiting: (readonly Value[])[] = [];
  #bytes = 0;
  readonly #cells = new Cells();
  #ended = false;

  /**
   * A copy begun over `conn`, its CopyIn sent.
   *
   * @param conn - the connection
   */
  constructor(conn: Link) {
    this.#conn = conn;
  }

  /**
   * Sends `row`, with those before it once they are about 256 KiB.
   *
   * @param row - a value for each column copied
   * @throws {@link TurborelError} 08006 if the connection is lost; a row the server refuses comes as `finish`'s failure
   */
  async send(row: readonly Value[]): Promise<void> {
    await this.#flushCells();
    this.#bytes += rowSize(row);
    this.#waiting.push(row);
    if (this.#bytes >= CHUNK_BYTES) await this.#flush();
  }

  /**
   * Sends a row of text by column, with those before it once they are
   * about 256 KiB: a cell for each column, the text a field of a file
   * holds, or null. The server takes each cell as the character string of
   * its text, cast to its column's type and assigned as INSERT assigns it,
   * so one too long fails rather than being cut. The rows keep their order
   * among those `send` sends.
   *
   * @param row - a cell for each column copied
   * @throws {@link TurborelError} 08006 if `columns` was not granted, refused before anything is sent, or the connection is lost; TB910 for a row of no cells, or of another count of cells than the rows before it; a row the server refuses comes as `finish`'s failure
   */
  async sendText(row: readonly (string | null)[]): Promise<void> {
    if (!this.#conn.has(COLUMNS)) throw connectionFailure('the server did not grant columns');
    await this.#flushRows();
    this.#cells.add(row);
    if (this.#cells.octets >= CHUNK_BYTES) await this.#flushCells();
  }

  /** Sends the rows waiting, of values or of text. */
  async #flush(): Promise<void> {
    await this.#flushRows();
    await this.#flushCells();
  }

  /** Sends the rows of text waiting, in a CopyColumns. */
  async #flushCells(): Promise<void> {
    if (this.#cells.rows > 0) await this.#conn.send(this.#cells.take());
  }

  /** Sends the rows of values waiting, in a CopyData. */
  async #flushRows(): Promise<void> {
    if (this.#waiting.length === 0) return;
    const rows = this.#waiting;
    [this.#waiting, this.#bytes] = [[], 0];
    await this.#conn.send({ kind: 'copyData', rows });
  }

  /**
   * Asks whether the server answers, as a copy goes on.
   *
   * @throws {@link TurborelError} 08006 if `ping` was not granted, or the server is gone
   */
  async ping(): Promise<void> {
    await this.#flush();
    await this.#conn.send({ kind: 'ping' });
    const reply = await this.#conn.receive();
    if (reply.kind !== 'pong') {
      throw reply.kind === 'error' ? this.#conn.failed(reply.failure) : this.#conn.lose('the server sent no Pong');
    }
  }

  /**
   * Ends the copy.
   *
   * @returns the rows inserted
   * @throws {@link TurborelError} the copy's failure, every row of it undone: the table or a column not found, a row of too many or too few values, a value its column refuses, its detail naming the row; 08006 if the connection is lost
   */
  async finish(): Promise<bigint> {
    await this.#flush();
    return this.#end(false);
  }

  /**
   * Gives the copy up, every row of it undone.
   *
   * @throws {@link TurborelError} 08006 if the connection is lost
   */
  async abandon(): Promise<void> {
    await this.#end(true);
  }

  /** @returns whether it ended, finished or abandoned */
  get ended(): boolean {
    return this.#ended;
  }

  /**
   * Sends CopyEnd.
   *
   * @param abandon - whether the copy is given up
   * @returns the rows inserted
   */
  async #end(abandon: boolean): Promise<bigint> {
    this.#ended = true;
    this.#waiting = [];
    this.#cells.take();
    const done = await completed(this.#conn, { kind: 'copyEnd', abandon });
    return done.rows ?? 0n;
  }

  /** Abandons the copy if it has not ended and the connection is not lost, as `await using` disposes of it. */
  async [Symbol.asyncDispose](): Promise<void> {
    if (!this.#ended && !this.#conn.isLost) await this.#end(true);
  }
}
