/**
 * Every request a client sends (`[PROTOCOL Requests]`), encoded as a frame,
 * as turborel-protocol's `request.rs` and `request/added.rs` write them.
 * A tail field is written only where it says something, so a request
 * with none is its first form exactly. Internal.
 *
 * @packageDocumentation
 */

import { writeRow } from './composite.js';
import { encodeFrame } from './frame.js';
import { DESCRIBED, LOB_OP, REQUEST } from './kinds.js';
import { type Attribute, CURSOR, MULTI, writeAttributes, writeMark, writeNumber } from './tail.js';
import { LOB_BINARY, LOB_CHARACTER } from './tags.js';
import { writeValues } from './value-codec.js';
import type { LobKind, Value } from './values.js';
import { Writer } from './writer.js';
import { type DebugRequest, writeDebug } from './debug.js';

/** A Lob request's operation (`[PROTOCOL Lob 'L']`, the request). */
export type LobRequest =
  | {
      readonly op: 'read';
      readonly locator: number;
      readonly from: bigint;
      readonly count: bigint;
      readonly characters: boolean;
    }
  | { readonly op: 'create'; readonly lobKind: LobKind }
  | { readonly op: 'append'; readonly locator: number; readonly bytes: Uint8Array }
  | { readonly op: 'free' | 'hold'; readonly locator: number };

/** A request, as a client sends it. */
export type Request =
  | {
      readonly kind: 'hello';
      readonly version: number;
      readonly user: string;
      readonly mechanism: string;
      readonly initial: Uint8Array;
      readonly capabilities: readonly string[];
      readonly attributes: readonly Attribute[];
    }
  | { readonly kind: 'answer'; readonly answer: Uint8Array }
  | {
      readonly kind: 'query';
      readonly sql: string;
      readonly ends: boolean;
      readonly attributes: readonly Attribute[];
      readonly multi: boolean;
    }
  | { readonly kind: 'prepare'; readonly statement: number; readonly sql: string }
  | {
      readonly kind: 'execute';
      readonly statement: number;
      readonly cursor: number;
      readonly values: readonly Value[];
      readonly rows: number;
      readonly ends: boolean;
      readonly attributes: readonly Attribute[];
    }
  | { readonly kind: 'fetch'; readonly statement: number; readonly cursor: number; readonly rows: number }
  | { readonly kind: 'close'; readonly statement: number; readonly cursor: number }
  | { readonly kind: 'deallocate'; readonly statement: number }
  | { readonly kind: 'lob'; readonly lob: LobRequest }
  | { readonly kind: 'cancel'; readonly key: Uint8Array }
  | { readonly kind: 'terminate' | 'ping' | 'reset' }
  | {
      readonly kind: 'describe';
      readonly what: 'statement' | 'cursor';
      readonly statement: number;
      readonly cursor: number;
    }
  | { readonly kind: 'changeUser'; readonly user: string; readonly mechanism: string; readonly initial: Uint8Array }
  | { readonly kind: 'copyIn'; readonly table: string; readonly columns: readonly string[]; readonly ends: boolean }
  | { readonly kind: 'copyData'; readonly rows: readonly (readonly Value[])[] }
  | { readonly kind: 'copyEnd'; readonly abandon: boolean }
  | { readonly kind: 'debug'; readonly debug: DebugRequest };

/** Writes the body of a request of kind `K`, and gives its kind's octet. */
type BodyWriter<K extends Request['kind']> = (w: Writer, q: Extract<Request, { kind: K }>) => number;

/** How each request's body is written, by its kind: every kind has one, as the type requires. */
const WRITERS: { readonly [K in Request['kind']]: BodyWriter<K> } = {
  hello: (w, q) => {
    w.u32(q.version).string(q.user).string(q.mechanism).bytes(q.initial).strings(q.capabilities);
    writeAttributes(w, q.attributes);
    return REQUEST.HELLO;
  },
  answer: (w, q) => (w.bytes(q.answer), REQUEST.ANSWER),
  query: (w, q) => {
    w.string(q.sql).flag(q.ends);
    writeAttributes(w, q.attributes);
    writeMark(w, MULTI, q.multi);
    return REQUEST.QUERY;
  },
  prepare: (w, q) => (w.u32(q.statement).string(q.sql), REQUEST.PREPARE),
  execute: (w, q) => {
    writeValues(w.u32(q.statement), q.values);
    w.u32(q.rows).flag(q.ends);
    writeAttributes(w, q.attributes);
    writeNumber(w, CURSOR, q.cursor);
    return REQUEST.EXECUTE;
  },
  fetch: (w, q) => (writeNumber(w.u32(q.statement).u32(q.rows), CURSOR, q.cursor), REQUEST.FETCH),
  close: (w, q) => (writeNumber(w.u32(q.statement), CURSOR, q.cursor), REQUEST.CLOSE),
  deallocate: (w, q) => (w.u32(q.statement), REQUEST.DEALLOCATE),
  lob: (w, q) => (writeLob(w, q.lob), REQUEST.LOB),
  cancel: (w, q) => (w.key(q.key), REQUEST.CANCEL),
  terminate: () => REQUEST.TERMINATE,
  ping: () => REQUEST.PING,
  reset: () => REQUEST.RESET,
  describe: (w, q) => {
    const statement = q.what === 'statement';
    w.u8(statement ? DESCRIBED.STATEMENT : DESCRIBED.CURSOR)
      .u32(q.statement)
      .u32(statement ? 0 : q.cursor);
    return REQUEST.DESCRIBE;
  },
  changeUser: (w, q) => (w.string(q.user).string(q.mechanism).bytes(q.initial), REQUEST.CHANGE_USER),
  copyIn: (w, q) => (w.string(q.table).strings(q.columns).flag(q.ends), REQUEST.COPY_IN),
  copyData: (w, q) => (w.list(q.rows, writeRow), REQUEST.COPY_DATA),
  copyEnd: (w, q) => (w.flag(q.abandon), REQUEST.COPY_END),
  debug: (w, q) => (writeDebug(w, q.debug), REQUEST.DEBUG),
};

/**
 * The frame of `request`.
 *
 * @param request - the request
 * @returns its bytes, header and body
 * @throws {@link TurborelError} TB910 for a field out of its range; 22003 or 22021 for a value the protocol cannot carry
 */
export function encodeRequest(request: Request): Uint8Array {
  const w = new Writer();
  // The writer of a request's own kind, which the table's type pairs with it.
  const write = WRITERS[request.kind] as (w: Writer, q: Request) => number;
  return encodeFrame(write(w, request), w.finish());
}

/**
 * Writes a Lob request's operation and its fields.
 *
 * @param w - the writer
 * @param lob - the operation
 */
function writeLob(w: Writer, lob: LobRequest): void {
  switch (lob.op) {
    case 'read':
      w.u8(LOB_OP.READ).u32(lob.locator).u64(lob.from).u64(lob.count).flag(lob.characters);
      return;
    case 'create':
      w.u8(LOB_OP.CREATE).u8(lob.lobKind === 'character' ? LOB_CHARACTER : LOB_BINARY);
      return;
    case 'append':
      w.u8(LOB_OP.APPEND).u32(lob.locator).bytes(lob.bytes);
      return;
    case 'free':
      w.u8(LOB_OP.FREE).u32(lob.locator);
      return;
    case 'hold':
      w.u8(LOB_OP.HOLD).u32(lob.locator);
  }
}
