/**
 * Every reply a client receives (`[PROTOCOL Replies]`), decoded from its
 * kind and body, as turborel-protocol's `reply.rs` reads them. A kind of
 * no reply, a body cut short, a tail out of order or bytes after the last
 * field fail the connection (SQLCODE -919, SQLSTATE 08006). Internal.
 *
 * @packageDocumentation
 */

import { type Column, type Parameter, readDiagnostics, readFailure, readParameter, readRow } from './composite.js';
import { readColumns } from './declared.js';
import { LOB_REPLY, REPLY } from './kinds.js';
import { Reader } from './reader.js';
import { CONDITIONS, GENERATED, MORE, POSITION, ROWS, TIME, Tail } from './tail.js';
import type { Value } from './values.js';
import { type Diagnostics, TurborelError, connectionFailure } from '../error.js';

/** The server's time for a statement, in microseconds (`[PROTOCOL Complete 'K']`, tag 18). */
export interface Timing {
  /** From when a worker began the request until its completion was ready. */
  readonly total: bigint;
  /** How long the request waited for a worker before that. */
  readonly queued: bigint;
  /** The part of the total spent waiting for locks. */
  readonly locks: bigint;
}

/** A statement's completion, with its tail as granted (`[PROTOCOL Complete 'K']`). */
export interface Completion {
  /** Its SQLCODE: 0, or 100 of no data. */
  readonly sqlcode: number;
  /** Its SQLSTATE: 00000, a warning's of class 01, or 02000. */
  readonly sqlstate: string;
  /** Whether a transaction is active after it. */
  readonly active: boolean;
  /** Tag 4: the log position of the commit it made. */
  readonly position?: bigint;
  /** Tag 5: whether another statement's replies follow. */
  readonly more: boolean;
  /** Tag 6: the rows its statement counted. */
  readonly rows?: bigint;
  /** Tag 16: the identity values an INSERT generated, as SQL writes them. */
  readonly generated: readonly string[];
  /** Tag 17: the conditions its statement raised, each a failure. */
  readonly conditions: readonly TurborelError[];
  /** Tag 18: the server's time for it. */
  readonly time?: Timing;
}

/** A reply, as a client receives it. */
export type Reply =
  | { readonly kind: 'challenge'; readonly challenge: Uint8Array }
  | {
      readonly kind: 'ready';
      readonly authorization: string;
      readonly key: Uint8Array;
      readonly capabilities: readonly string[];
      readonly server: string;
    }
  | {
      readonly kind: 'prepared';
      readonly statement: number;
      readonly parameters: readonly Parameter[];
      readonly columns: readonly Column[];
    }
  | { readonly kind: 'description'; readonly columns: readonly Column[] }
  | { readonly kind: 'rows'; readonly rows: readonly (readonly Value[])[] }
  | { readonly kind: 'suspended' | 'pong' }
  | { readonly kind: 'complete'; readonly completion: Completion }
  | { readonly kind: 'error'; readonly failure: TurborelError }
  | { readonly kind: 'lobData'; readonly data: Uint8Array }
  | { readonly kind: 'lobLocator'; readonly locator: number }
  | { readonly kind: 'notice'; readonly sqlstate: string; readonly message: string; readonly diagnostics?: Diagnostics }
  | { readonly kind: 'status'; readonly name: string; readonly value: string };

/** The tail tags a Complete takes. */
const COMPLETE_TAGS: readonly number[] = [POSITION, MORE, ROWS, GENERATED, CONDITIONS, TIME];

/**
 * Reads a condition of tag 17: a failure as bytes, its own tail ending where its length does.
 *
 * @param r - the reader
 * @returns the failure
 */
function readCondition(r: Reader): TurborelError {
  const inner = new Reader(r.bytesField(), 'condition');
  try {
    const condition = readFailure(inner);
    inner.finish();
    return condition;
  } catch (e) {
    // A condition's bytes are a field of the Complete, read whole by
    // their count: one that cannot be taken is a value's failure.
    throw e instanceof TurborelError && !e.sqlstate.startsWith('08')
      ? e
      : r.damaged(`a condition cannot be read: ${(e as Error).message}`);
  }
}

/** A completion's tail as it is read, every field mutable until the end. */
interface Found {
  position?: bigint;
  more: boolean;
  rows?: bigint;
  generated: readonly string[];
  conditions: readonly TurborelError[];
  time?: Timing;
}

/**
 * Reads a Complete's body: SQLCODE, SQLSTATE, active, then its tail.
 *
 * @param r - the reader
 * @returns the completion
 */
function readCompletion(r: Reader): Completion {
  const sqlcode = r.i32();
  const sqlstate = r.string();
  const active = r.flag();
  const found: Found = { more: false, generated: [], conditions: [] };
  const tail = new Tail(COMPLETE_TAGS);
  for (let t = tail.next(r); t !== undefined; t = tail.next(r)) {
    if (t === POSITION) found.position = r.u64();
    else if (t === MORE) found.more = true;
    else if (t === ROWS) found.rows = r.u64();
    else if (t === GENERATED) found.generated = r.strings();
    else if (t === CONDITIONS) found.conditions = r.list(readCondition);
    else found.time = { total: r.u64(), queued: r.u64(), locks: r.u64() };
  }
  return { sqlcode, sqlstate, active, ...found };
}

/**
 * Reads a Lob reply: its data, or the locator a create made.
 *
 * @param r - the reader
 * @returns the reply
 */
function readLobReply(r: Reader): Reply {
  const what = r.u8();
  if (what === LOB_REPLY.DATA) return { kind: 'lobData', data: r.bytesField() };
  if (what === LOB_REPLY.LOCATOR) return { kind: 'lobLocator', locator: r.u32() };
  throw r.corrupt('no Lob reply is of this kind');
}

/**
 * Reads a Notice: its SQLSTATE, message and diagnostics.
 *
 * @param r - the reader
 * @returns the reply
 */
function readNotice(r: Reader): Reply {
  const sqlstate = r.string();
  const message = r.string();
  const diagnostics = readDiagnostics(r);
  return { kind: 'notice', sqlstate, message, ...(diagnostics === undefined ? {} : { diagnostics }) };
}

/** How each reply's body is read, by its kind. */
const READERS: Readonly<Partial<Record<number, (r: Reader) => Reply>>> = {
  [REPLY.CHALLENGE]: (r) => ({ kind: 'challenge', challenge: r.bytesField() }),
  [REPLY.READY]: (r) => ({
    kind: 'ready',
    authorization: r.string(),
    key: r.key(),
    capabilities: r.strings(),
    server: r.string(),
  }),
  [REPLY.PREPARED]: (r) => ({
    kind: 'prepared',
    statement: r.u32(),
    parameters: r.list(readParameter),
    columns: readColumns(r),
  }),
  [REPLY.DESCRIPTION]: (r) => ({ kind: 'description', columns: readColumns(r) }),
  [REPLY.ROWS]: (r) => ({ kind: 'rows', rows: r.list(readRow) }),
  [REPLY.SUSPENDED]: () => ({ kind: 'suspended' }),
  [REPLY.COMPLETE]: (r) => ({ kind: 'complete', completion: readCompletion(r) }),
  [REPLY.ERROR]: (r) => ({ kind: 'error', failure: readFailure(r) }),
  [REPLY.LOB]: readLobReply,
  [REPLY.NOTICE]: readNotice,
  [REPLY.STATUS]: (r) => ({ kind: 'status', name: r.string(), value: r.string() }),
  [REPLY.PONG]: () => ({ kind: 'pong' }),
};

/**
 * Whether a reply of `kind` and `body`, decoded or not, is the last its
 * request is answered with, by the order of a statement's replies, as
 * turborel-protocol's `ends_request` tells it: a Description, Rows, a
 * Notice or a Status has more after it; a Complete has if its tail says
 * more (tag 5); any other reply ends its request's.
 *
 * @param kind - its kind
 * @param body - its body
 * @returns true if no reply of its request follows
 */
export function endsRequest(kind: number, body: Uint8Array): boolean {
  if (kind === REPLY.DESCRIPTION || kind === REPLY.ROWS || kind === REPLY.NOTICE || kind === REPLY.STATUS) return false;
  if (kind !== REPLY.COMPLETE) return true;
  return completedHead(kind, body)?.more !== true;
}

/**
 * The head of a Complete whose head reads, as turborel-protocol's
 * `completed_head` reads it: its SQLCODE, SQLSTATE and whether a
 * transaction is active, and of its tail the commit's position and
 * whether more replies follow, which come before any field a client may
 * fail to take.
 *
 * @param kind - the reply's kind
 * @param body - its body
 * @returns the head, or undefined if it is no Complete, or its head does not read
 */
export function completedHead(kind: number, body: Uint8Array): Completion | undefined {
  if (kind !== REPLY.COMPLETE) return undefined;
  try {
    const r = new Reader(body, 'reply');
    const head: Found & { sqlcode: number; sqlstate: string; active: boolean } = {
      sqlcode: r.i32(),
      sqlstate: r.string(),
      active: r.flag(),
      more: false,
      generated: [],
      conditions: [],
    };
    const tail = new Tail(COMPLETE_TAGS);
    for (let t = tail.next(r); t === POSITION || t === MORE; t = tail.next(r)) {
      if (t === POSITION) head.position = r.u64();
      else head.more = true;
    }
    return head;
  } catch {
    return undefined;
  }
}

/**
 * The reply of kind `kind` whose body is `body`.
 *
 * @param kind - the frame's kind
 * @param body - its body, all of it
 * @returns the reply
 * @throws {@link TurborelError} 08006 for a kind of no reply, or a body malformed
 */
export function decodeReply(kind: number, body: Uint8Array): Reply {
  const read = READERS[kind];
  if (read === undefined) throw connectionFailure(`no reply is of kind ${String(kind)}`);
  const r = new Reader(body, 'reply');
  const reply = read(r);
  r.finish();
  return reply;
}
