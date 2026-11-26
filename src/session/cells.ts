/**
 * Rows of a copy gathered by column, as text, for a CopyColumns
 * (`[PROTOCOL CopyColumns 'O']`): each column's null bits, the end of
 * each row's cell, and the cells' UTF-8 one after another, as
 * turborel-client's `Cells` gathers them. Internal.
 *
 * @packageDocumentation
 */

import type { ColumnCells, Request } from '../codec/requests.js';
import { apiMisuse } from '../error.js';

/** The rows of a byte of null bits. */
const BITS = 8;
/** The octets a cell takes besides its text: its end. */
const END_OCTETS = 4;
/** UTF-8, as a cell's text is. */
const UTF8 = new TextEncoder();

/** A column's cells as they are gathered. */
interface Column {
  nulls: number[];
  ends: number[];
  text: Uint8Array[];
  length: number;
}

/** Rows gathered by column, until sent. */
export class Cells {
  #columns: Column[] = [];
  #rows = 0;
  #octets = 0;

  /** @returns how many rows are gathered */
  get rows(): number {
    return this.#rows;
  }

  /** @returns about the octets a CopyColumns of the rows would be */
  get octets(): number {
    return this.#octets;
  }

  /**
   * Gathers a row: a cell for each column, its text, or null.
   *
   * @param row - the cells
   * @throws {@link TurborelError} TB910 if it has no cell, or not as many as the rows before it
   */
  add(row: readonly (string | null)[]): void {
    if (this.#rows === 0) this.#columns = row.map(() => ({ nulls: [], ends: [], text: [], length: 0 }));
    if (row.length === 0 || row.length !== this.#columns.length) {
      throw apiMisuse(
        `a row of a copy by column has ${String(row.length)} cells, for ${String(this.#columns.length)} columns`,
      );
    }
    const at = this.#rows;
    this.#columns.forEach((c, i) => {
      const cell = row[i] ?? null;
      if (at % BITS === 0) c.nulls.push(0);
      const last = c.nulls.length - 1;
      if (cell === null) c.nulls[last] = (c.nulls[last] ?? 0) | (1 << (at % BITS));
      else {
        const bytes = UTF8.encode(cell);
        c.text.push(bytes);
        c.length += bytes.byteLength;
        this.#octets += bytes.byteLength;
      }
      c.ends.push(c.length);
      this.#octets += END_OCTETS;
    });
    this.#rows += 1;
  }

  /** @returns the CopyColumns of the rows gathered, which are taken */
  take(): Request {
    const columns: ColumnCells[] = this.#columns.map((c) => ({
      nulls: Uint8Array.from(c.nulls),
      ends: c.ends,
      text: Buffer.concat(c.text),
    }));
    const request: Request = { kind: 'copyColumns', rows: this.#rows, columns };
    [this.#columns, this.#rows, this.#octets] = [[], 0, 0];
    return request;
  }
}
