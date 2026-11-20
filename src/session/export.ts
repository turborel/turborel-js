/**
 * Export (`[CLIENT Copying and exporting]`), as turborel-client's
 * `export.rs` writes it: a query's rows streamed from the server and
 * written as they come, a batch at a time. As CSV (RFC 4180): a header of
 * the columns' names, then a record for each row, a field quoted where it
 * holds a comma, a quote, a line break or spaces at either end, a quote in
 * it written twice; a null an empty field, an empty string `""`. Or as
 * native rows: the protocol's own frames, a Description, then Rows, then a
 * Complete, which `readNative` reads back, every value as it was.
 *
 * @packageDocumentation
 */

import type { Sink } from './statements.js';
import { type Column, writeColumn, writeRow } from '../codec/composite.js';
import { HEADER_BYTES, MAX_BODY, decodeHeader, encodeFrame } from '../codec/frame.js';
import { REPLY } from '../codec/kinds.js';
import { decodeReply } from '../codec/replies.js';
import { textOf } from '../codec/text.js';
import type { Value } from '../codec/values.js';
import { Writer } from '../codec/writer.js';
import { connectionFailure } from '../error.js';

/** How an export writes rows: CSV, or the protocol's own frames. */
export type ExportFormat = 'csv' | 'native';

/** What an export writes to: a write that resolves once the bytes are taken, as a Node.js stream's, wrapped. */
export interface ExportTarget {
  /**
   * Takes `bytes`.
   *
   * @param bytes - what to write
   */
  write(bytes: Uint8Array): void | Promise<void>;
}

/** What may quote a CSV field: a comma, a quote, or a line break. */
const MUST_QUOTE = /[,"\n\r]/u;
/** White space at a field's start or end, which a quoted field keeps. */
const EDGE_SPACE = /^\p{White_Space}|\p{White_Space}$/u;
/** UTF-8. */
const UTF8 = new TextEncoder();

/**
 * A CSV field, quoted where it must be.
 *
 * @param field - the text
 * @returns the field as written
 */
export function csvField(field: string): string {
  const quoted = field === '' || MUST_QUOTE.test(field) || EDGE_SPACE.test(field);
  return quoted ? `"${field.replaceAll('"', '""')}"` : field;
}

/**
 * A value as a CSV field: a null empty and not quoted, any other its text.
 *
 * @param v - the value
 * @returns the field
 */
export function csvValue(v: Value): string {
  return v === null ? '' : csvField(textOf(v));
}

/**
 * A CSV record of `fields`, ended by CR LF.
 *
 * @param fields - the fields as written
 * @returns its line
 */
function csvRecord(fields: readonly string[]): string {
  return `${fields.join(',')}\r\n`;
}

/**
 * The sink that writes a query's columns and rows to `out` as `format` says.
 *
 * @param out - what takes the bytes
 * @param format - CSV or native
 * @returns the sink
 */
export function exportSink(out: ExportTarget, format: ExportFormat): Sink {
  if (format === 'csv') {
    return {
      columns: (columns) => out.write(UTF8.encode(csvRecord(columns.map((c) => csvField(c.name ?? ''))))),
      rows: (rows) => out.write(UTF8.encode(rows.map((row) => csvRecord(row.map(csvValue))).join(''))),
    };
  }
  return {
    columns: (columns) => {
      const w = new Writer().u32(columns.length);
      for (const c of columns) writeColumn(w, c);
      return out.write(encodeFrame(REPLY.DESCRIPTION, w.finish()));
    },
    rows: (rows) => {
      const w = new Writer().u32(rows.length);
      for (const r of rows) writeRow(w, r);
      return out.write(encodeFrame(REPLY.ROWS, w.finish()));
    },
  };
}

/** @returns the Complete that ends native rows: SQLCODE 0, SQLSTATE 00000, no transaction active */
export function nativeEnd(): Uint8Array {
  return encodeFrame(REPLY.COMPLETE, new Writer().i32(0).string('00000').flag(false).finish());
}

/** What native rows held: the columns, and the rows. */
export interface NativeRows {
  /** The columns. */
  readonly columns: readonly Column[];
  /** The rows, every value as it was. */
  readonly rows: (readonly Value[])[];
}

/**
 * Reads native rows from `input`, as an export wrote them.
 *
 * @param input - the bytes, whole or in chunks, as a Node.js stream gives them
 * @returns the columns, and the rows
 * @throws {@link TurborelError} 08006 for input that is not native rows, or cut short
 */
export async function readNative(input: AsyncIterable<Uint8Array> | Iterable<Uint8Array>): Promise<NativeRows> {
  const parts: Uint8Array[] = [];
  for await (const chunk of input) parts.push(chunk);
  const bytes = Buffer.concat(parts);
  const notNative = (why: string): Error => connectionFailure(`not native rows: ${why}`);
  let at = 0;
  const next = (): ReturnType<typeof decodeReply> => {
    if (bytes.byteLength - at < HEADER_BYTES) throw notNative('cut short');
    const { kind, length } = decodeHeader(bytes.subarray(at, at + HEADER_BYTES), MAX_BODY);
    const body = bytes.subarray(at + HEADER_BYTES, at + HEADER_BYTES + length);
    if (body.byteLength < length) throw notNative('cut short');
    at += HEADER_BYTES + length;
    return decodeReply(kind, body);
  };
  const first = next();
  if (first.kind !== 'description') throw notNative('no Description first');
  const rows: (readonly Value[])[] = [];
  for (;;) {
    const reply = next();
    if (reply.kind === 'complete') return { columns: first.columns, rows };
    if (reply.kind !== 'rows') throw notNative('a frame other than Rows before the Complete');
    for (const row of reply.rows) rows.push(row);
  }
}
