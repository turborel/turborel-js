/**
 * Pipelining (`[CLIENT Pipelines]`, `[PROTOCOL Requests]`), as
 * turborel-client's `pipeline.rs` pipelines: a pipeline queues requests,
 * writes them at once, and reads one outcome for each, in order, as the
 * server answers each request alone and in turn, so a batch costs one
 * round trip, not one a request.
 *
 * The requests are written a window at a time, each at most 64 KiB, and
 * its replies read before the next is written: a window fits the buffers
 * of the two sockets between client and server, so neither waits on the
 * other to read.
 *
 * By default a failure is its request's outcome alone, and the rest run.
 * `onError('skip')` makes the batch stop at its first failure, the
 * requests before it kept: a savepoint is set before each request but the
 * first, and the requests after a failed one are undone to the savepoint
 * set after it, or never sent if their window was not yet written. Its
 * requests are of one transaction, which under autocommit, of a batch that
 * began none, is committed as the batch ends.
 *
 * @packageDocumentation
 */

import type { Outcome, Statement } from './statements.js';
import { encodeRequest, type Request } from '../codec/requests.js';
import type { Attribute } from '../codec/tail.js';
import type { Value } from '../codec/values.js';
import type { TurborelError } from '../error.js';

/** The most bytes of requests written before their replies are read: 64 KiB. */
export const PIPELINE_WINDOW = 65_536;

/** What the savepoints of a skipping batch are named by, then each its place. */
const SAVEPOINT = 'TURBOREL_PIPELINE';

/** What a pipeline does after a request fails: every request runs, or the batch stops. */
export type OnError = 'continue' | 'skip';

/** The outcome of one request of a pipeline. */
export type Piped =
  | { readonly kind: 'done'; readonly outcome: Outcome }
  | { readonly kind: 'failed'; readonly failure: TurborelError }
  | { readonly kind: 'skipped' };

/** A request queued, and how its reply is read. */
export type Queued =
  | { readonly kind: 'query'; readonly sql: string }
  | { readonly kind: 'execute'; readonly statement: Statement; readonly values: readonly Value[] }
  | { readonly kind: 'close' | 'deallocate'; readonly number: number }
  | { readonly kind: 'savepoint'; readonly place: number };

/** What a pipeline asks of its connection. */
export interface PipelineLink {
  /** Whether a transaction is active. */
  readonly inTransaction: () => boolean;
  /** Whether each statement is its own transaction. */
  readonly autocommit: () => boolean;
  /** Whether the connection is lost. */
  readonly isLost: () => boolean;
  /** The attributes each Query and Execute carries. */
  readonly attributes: () => readonly Attribute[];
  /** Writes requests at once. */
  readonly sendAll: (requests: readonly Request[]) => Promise<void>;
  /** Reads a Query's reply. */
  readonly queryReply: () => Promise<Outcome>;
  /** Reads an Execute's reply. */
  readonly executeReply: (statement: Statement) => Promise<Outcome>;
  /** Reads a completion. */
  readonly completion: () => Promise<Outcome>;
}

/**
 * The savepoint set before the request of `place`.
 *
 * @param place - its place
 * @returns its name
 */
function savepoint(place: number): string {
  return `${SAVEPOINT}_${String(place)}`;
}

/**
 * The request `q` sends.
 *
 * @param q - what is queued
 * @param ends - whether the transaction ends with a statement of the program's
 * @param attributes - what a statement of the program's carries
 * @returns the request
 */
export function requestOf(q: Queued, ends: boolean, attributes: readonly Attribute[]): Request {
  switch (q.kind) {
    case 'query':
      return { kind: 'query', sql: q.sql, ends, attributes, multi: false };
    case 'execute':
      return { kind: 'execute', statement: q.statement.number, cursor: 0, values: q.values, rows: 0, ends, attributes };
    case 'close':
      return { kind: 'close', statement: q.number, cursor: 0 };
    case 'deallocate':
      return { kind: 'deallocate', statement: q.number };
    case 'savepoint':
      return { kind: 'query', sql: `SAVEPOINT ${savepoint(q.place)}`, ends: false, attributes: [], multi: false };
  }
}

/**
 * The requests of `queued` grouped into windows of at most 64 KiB, in order, a longer one alone in its own.
 *
 * @param queued - the requests
 * @param ends - whether a statement of the program's ends its transaction
 * @param attributes - what a statement of the program's carries
 * @returns the windows, each request and its request
 */
export function windows(
  queued: readonly Queued[],
  ends: boolean,
  attributes: readonly Attribute[],
): [Queued, Request][][] {
  const out: [Queued, Request][][] = [];
  let filled = PIPELINE_WINDOW;
  for (const q of queued) {
    const request = requestOf(q, ends, attributes);
    const bytes = encodeRequest(request).byteLength;
    filled += bytes;
    if (filled > PIPELINE_WINDOW) {
      out.push([]);
      filled = bytes;
    }
    out[out.length - 1]?.push([q, request]);
  }
  return out;
}

/**
 * `queued`, a savepoint of its own before each request but the first.
 *
 * @param queued - the requests
 * @returns them guarded
 */
function guarded(queued: readonly Queued[]): Queued[] {
  return queued.flatMap((q, place) => (place > 0 ? [{ kind: 'savepoint', place } as const, q] : [q]));
}

/** Requests queued on a connection, written at once by `run`. */
export class Pipeline {
  readonly #link: PipelineLink;
  readonly #queued: Queued[] = [];
  #onError: OnError = 'continue';

  /**
   * A pipeline on a connection.
   *
   * @param link - what it asks of the connection
   */
  constructor(link: PipelineLink) {
    this.#link = link;
  }

  /**
   * Queues `sql`, run as `query` runs it.
   *
   * @param sql - the statement
   * @returns the pipeline
   */
  query(sql: string): this {
    this.#queued.push({ kind: 'query', sql });
    return this;
  }

  /**
   * Queues an execution of `statement` with `values`, as `execute` runs it: all of a query's rows.
   *
   * @param statement - a statement the connection prepared
   * @param values - a value for each parameter
   * @returns the pipeline
   */
  execute(statement: Statement, values: readonly Value[] = []): this {
    this.#queued.push({ kind: 'execute', statement, values });
    return this;
  }

  /**
   * Queues the closing of a statement's cursor, then its destruction, by its number: a pool's reset of what a borrower left.
   *
   * @param number - the statement's number
   * @returns the pipeline
   */
  release(number: number): this {
    this.#queued.push({ kind: 'close', number }, { kind: 'deallocate', number });
    return this;
  }

  /**
   * What the batch does after a request fails.
   *
   * @param onError - `continue`, by default, or `skip`
   * @returns the pipeline
   */
  onError(onError: OnError): this {
    this.#onError = onError;
    return this;
  }

  /** @returns how many requests are queued */
  get length(): number {
    return this.#queued.length;
  }

  /** @returns whether none is queued */
  get isEmpty(): boolean {
    return this.#queued.length === 0;
  }

  /**
   * Writes the requests, a window at a time, and reads one outcome for each, in the order they were queued.
   *
   * @returns each request's outcome
   * @throws {@link TurborelError} 08006 once the connection is lost, what the requests answered before it not given; under `skip`, the failure of undoing the requests after a failed one
   */
  async run(): Promise<Piped[]> {
    const link = this.#link;
    const skip = this.#onError === 'skip';
    const began = link.inTransaction();
    const sent = skip ? guarded(this.#queued) : [...this.#queued];
    const outcomes: Piped[] = [];
    for (const window of windows(sent, link.autocommit() && !skip, link.attributes())) {
      if (skip && outcomes.some((o) => o.kind === 'failed')) {
        outcomes.push(...window.map((): Piped => ({ kind: 'skipped' })));
        continue;
      }
      outcomes.push(...(await this.#window(window)));
    }
    if (skip) await this.#settle(sent, outcomes, began);
    return outcomes.filter((_, i) => sent[i]?.kind !== 'savepoint');
  }

  /**
   * Writes `window` at once and reads its outcomes.
   *
   * @param window - its requests
   * @returns their outcomes
   */
  async #window(window: readonly [Queued, Request][]): Promise<Piped[]> {
    const link = this.#link;
    await link.sendAll(window.map(([, request]) => request));
    const outcomes: Piped[] = [];
    for (const [q] of window) {
      try {
        const outcome =
          q.kind === 'execute'
            ? await link.executeReply(q.statement)
            : q.kind === 'close' || q.kind === 'deallocate'
              ? await link.completion()
              : await link.queryReply();
        outcomes.push({ kind: 'done', outcome });
      } catch (e) {
        if (link.isLost()) throw e;
        outcomes.push({ kind: 'failed', failure: e as TurborelError });
      }
    }
    return outcomes;
  }

  /**
   * Ends a skipping batch: the requests after the first that failed undone and skipped, the savepoints released, its work committed under autocommit where it began no transaction.
   *
   * @param sent - the requests, savepoints among them
   * @param outcomes - their outcomes, changed in place
   * @param began - whether a transaction was active as it began
   */
  async #settle(sent: readonly Queued[], outcomes: Piped[], began: boolean): Promise<void> {
    const failed = outcomes.findIndex((o) => o.kind === 'failed');
    const statements: string[] = [];
    if (failed >= 0) {
      const after = sent[failed + 1];
      if (after?.kind === 'savepoint' && outcomes[failed + 1]?.kind === 'done') {
        statements.push(`ROLLBACK TO SAVEPOINT ${savepoint(after.place)}`);
      }
      for (let i = failed + 1; i < outcomes.length; i += 1) outcomes[i] = { kind: 'skipped' };
    }
    const first = sent[1];
    if (first?.kind === 'savepoint' && outcomes[1]?.kind === 'done')
      statements.push(`RELEASE SAVEPOINT ${savepoint(first.place)}`);
    if (!began && this.#link.autocommit()) statements.push('COMMIT');
    for (const sql of statements) {
      await this.#link.sendAll([{ kind: 'query', sql, ends: false, attributes: [], multi: false }]);
      await this.#link.queryReply();
    }
  }
}
