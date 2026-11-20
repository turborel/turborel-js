/**
 * Helpers of the live tests (RULES.md R-TEST-7): the server started once
 * for a test file, ANN's schema made in it, and a statement run over a connection's requests and
 * replies, until the statements' layer gives one.
 */

import { after, before } from 'node:test';

import type { Completion } from '../../src/codec/replies.js';
import type { Value } from '../../src/codec/values.js';
import type { Connection } from '../../src/session/connection.js';
import { type Live, PORT, startLive } from '../server/server.js';
import { Trust } from '../../src/auth/mechanism.js';
import { connectTo } from '../../src/session/connect.js';
import { tcp } from '../../src/transport/target.js';

/** The server of a test file, once started; undefined where none is named. */
export const server: { live: Live | undefined } = { live: undefined };

/** Starts the live server before a file's tests, and stops it after. */
export function liveServer(): void {
  before(async () => {
    server.live = await startLive();
    if (server.live === undefined) return;
    const owner = await connectTo(tcp('127.0.0.1', PORT), 'ann', new Trust());
    await run(owner, 'CREATE SCHEMA AUTHORIZATION ANN');
    await owner.terminate();
  });
  after(async () => {
    await server.live?.stop();
  });
}

/** What a statement gave: its rows, if a query, and its completion. */
export interface Ran {
  /** The rows of a query. */
  readonly rows: Value[][];
  /** Its completion. */
  readonly completion: Completion;
}

/**
 * Runs `sql` as a Query, its transaction ended with it unless told.
 *
 * @param conn - the connection
 * @param sql - the statement
 * @param ends - whether its transaction ends with it
 * @returns its rows and completion
 */
export async function run(conn: Connection, sql: string, ends = true): Promise<Ran> {
  await conn.send({ kind: 'query', sql, ends, attributes: [], multi: false });
  const rows: Value[][] = [];
  for (;;) {
    const reply = await conn.receive();
    if (reply.kind === 'rows') rows.push(...reply.rows.map((r) => [...r]));
    else if (reply.kind === 'complete') return { rows, completion: reply.completion };
    else if (reply.kind === 'error') throw reply.failure;
  }
}
