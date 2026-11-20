/**
 * Live tests of pipelines, pools and the SQL-agent, against the server
 * TURBOREL_TEST_SERVER names (RULES.md R-TEST-8).
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Agent } from '../../src/agent/agent.js';
import { Trust } from '../../src/auth/mechanism.js';
import type { Value } from '../../src/codec/values.js';
import { Pool } from '../../src/pool/pool.js';
import * as cap from '../../src/session/capabilities.js';
import { connectTo } from '../../src/session/connect.js';
import type { Connection } from '../../src/session/connection.js';
import type { Outcome } from '../../src/session/statements.js';
import { Offer } from '../../src/session/told.js';
import { PIPELINE_WINDOW, type Piped } from '../../src/session/pipeline.js';
import { tcp } from '../../src/transport/target.js';
import { PORT } from '../server/server.js';
import { isFailure } from '../support/failures.js';
import { ann, live, liveServer } from '../support/live.js';

liveServer();

/**
 * The rows of an outcome, or a failure if it has none.
 *
 * @param outcome - the outcome
 * @returns its rows
 */
function rowsOf(outcome: Outcome | undefined): readonly (readonly Value[])[] {
  if (outcome?.kind !== 'rows') throw new Error('no rows');
  return outcome.rows;
}

/**
 * Each piped outcome's kind.
 *
 * @param piped - the outcomes
 * @returns their kinds
 */
function kinds(piped: readonly Piped[]): string[] {
  return piped.map((p) => p.kind);
}

/**
 * The count of a table's rows.
 *
 * @param conn - the connection
 * @param table - the table
 * @returns how many
 */
async function count(conn: Connection, table: string): Promise<Value> {
  return rowsOf(await conn.query(`SELECT COUNT(*) FROM ${table}`))[0]?.[0] ?? null;
}

/** Verifies: [CLIENT Pipelines] queued queries and executions run, one outcome each in order, a failure its request's own; written a window at a time; each its own transaction under autocommit. */
test('a pipeline', async (t) => {
  if (live(t) === undefined) return;
  const conn = await ann();
  await conn.query('CREATE TABLE P (ID INTEGER PRIMARY KEY, NAME VARCHAR(200))');
  await conn.query('COMMIT');
  const insert = await conn.prepare('INSERT INTO P VALUES (?, ?)');
  const ran = await conn
    .pipeline()
    .query("INSERT INTO P VALUES (1, 'one')")
    .execute(insert, [2n, 'two'])
    .execute(insert, [1n, 'again'])
    .query('SELECT ID FROM P ORDER BY ID')
    .run();
  assert.deepEqual(kinds(ran), ['done', 'done', 'failed', 'done']);
  assert.ok(ran[2]?.kind === 'failed' && isFailure(-201, '23000')(ran[2].failure));
  assert.deepEqual(rowsOf(ran[3]?.kind === 'done' ? ran[3].outcome : undefined), [[1n], [2n]]);
  await conn.query('ROLLBACK');
  const long = 'x'.repeat(150);
  const many = conn.pipeline();
  for (let i = 0; i < 2000; i += 1) many.execute(insert, [BigInt(i), long]);
  assert.ok(many.length * long.length > PIPELINE_WINDOW * 4, 'several windows');
  const all = await many.run();
  assert.ok(all.every((p) => p.kind === 'done'));
  assert.equal(await count(conn, 'P'), 2000n);
  await conn.query('ROLLBACK');
  conn.setAutocommit(true);
  await conn.pipeline().execute(insert, [1n, 'a']).execute(insert, [2n, 'b']).run();
  assert.equal(conn.inTransaction, false, 'each its own transaction');
  assert.equal(await count(conn, 'P'), 2n);
  await conn.terminate();
});

/** Verifies: [CLIENT Pipelines] skip on error: the requests after a failure rolled back and skipped, those before kept, the batch one transaction committed under autocommit where it began none. */
test('a pipeline that skips', async (t) => {
  if (live(t) === undefined) return;
  const conn = await ann();
  await conn.query('CREATE TABLE S (ID INTEGER PRIMARY KEY)');
  await conn.query('COMMIT');
  conn.setAutocommit(true);
  const ran = await conn
    .pipeline()
    .onError('skip')
    .query('INSERT INTO S VALUES (1)')
    .query('INSERT INTO S VALUES (2)')
    .query('INSERT INTO S VALUES (1)')
    .query('INSERT INTO S VALUES (3)')
    .run();
  assert.deepEqual(kinds(ran), ['done', 'done', 'failed', 'skipped']);
  assert.equal(conn.inTransaction, false, 'committed as it ended');
  assert.deepEqual(rowsOf(await conn.query('SELECT ID FROM S ORDER BY ID')), [[1n], [2n]]);
  conn.setAutocommit(false);
  await conn.query('INSERT INTO S VALUES (9)');
  const within = await conn.pipeline().onError('skip').query('INSERT INTO S VALUES (10)').query('VALUES 1').run();
  assert.deepEqual(kinds(within), ['done', 'done']);
  assert.equal(conn.inTransaction, true, 'left as a statement would leave it');
  await conn.query('ROLLBACK');
  await conn.terminate();
});

/** Verifies: [CLIENT Pools] a bounded set of connections: get an idle one or make one, wait for one to come back, fail with 08001 past `wait`; given back reset by the protocol's Reset, autocommit off, then `reset`'s statements. */
test('a pool', async (t) => {
  if (live(t) === undefined) return;
  const pool = new Pool(() => ann(), { max: 2, wait: 200, reset: ["SET TIME ZONE INTERVAL '+01:00' HOUR TO MINUTE"] });
  const first = await pool.get();
  const second = await pool.get();
  assert.deepEqual(pool.counts, { made: 2, idle: 0 });
  await assert.rejects(pool.get(), isFailure(-919, '08001'), 'none came back in time');
  const waiting = pool.get();
  first.connection.setAutocommit(true);
  await first.connection.prepare('VALUES 1');
  await first.connection.query('DECLARE LOCAL TEMPORARY TABLE MODULE.TMP (X INTEGER)');
  await first.release();
  const again = await waiting;
  assert.equal(again.connection, first.connection, 'the one given back');
  assert.equal(again.connection.autocommit, false);
  assert.equal(again.connection.setting('SESSION.TIME_ZONE'), '+01:00', 'its reset statements ran');
  await assert.rejects(
    again.connection.query('SELECT X FROM MODULE.TMP'),
    isFailure(-103, '2A000'),
    'its session renewed',
  );
  await again.release();
  await again.release();
  {
    await using held = await pool.get();
    assert.ok(held.connection.authorization === 'ANN');
  }
  second.connection.destroy();
  await second.release();
  assert.deepEqual(pool.counts, { made: 1, idle: 1 }, 'a lost one closed');
  pool.close();
  assert.deepEqual(pool.counts, { made: 0, idle: 0 });
});

/** Verifies: [CLIENT Pools] of a server that takes neither Ping nor Reset, the check is ROLLBACK and the reset one pipeline: the transaction rolled back, its statements closed and destroyed, its schema that of its login. */
test('a pool of a server without Ping or Reset', async (t) => {
  if (live(t) === undefined) return;
  const offer = new Offer(Offer.default().capabilities.filter((c) => c !== cap.PING && c !== cap.RESET));
  const pool = new Pool(() => connectTo(tcp('127.0.0.1', PORT), 'ann', new Trust(), { offer }), { max: 1 });
  const lent = await pool.get();
  const conn = lent.connection;
  assert.equal(conn.has(cap.RESET), false);
  const s = await conn.prepare('SELECT 1 FROM (VALUES (1), (2)) AS T(X)');
  await conn.openCursor(s, [], { rows: 1 });
  await conn.query('CREATE SCHEMA OTHER');
  await conn.query("SET SCHEMA 'OTHER'");
  await lent.release();
  const back = await pool.get();
  assert.equal(back.connection, conn);
  assert.equal(back.connection.inTransaction, false, 'rolled back');
  assert.equal(back.connection.setting('SCHEMA'), 'ANN', 'the schema of its login');
  await assert.rejects(back.connection.execute(s), isFailure(-921, '26000'), 'its statements destroyed');
  await back.release();
  pool.close();
});

/** Verifies: [CLIENT The SQL-agent] connections named, one current; CONNECT through the connector, SET CONNECTION, DISCONNECT; every other statement to the current connection. */
test('the SQL-agent', async (t) => {
  if (live(t) === undefined) return;
  const asked: (string | undefined)[][] = [];
  const agent = new Agent({
    connect: (server, user) => {
      asked.push([server, user]);
      return connectTo(tcp('127.0.0.1', PORT), user ?? 'ann', new Trust());
    },
  });
  await assert.rejects(agent.query('VALUES 1'), isFailure(-919, '08003'), 'no current connection');
  const connected = await agent.query("CONNECT TO 'local' AS 'one' USER 'ann'");
  assert.equal(connected.kind === 'done' && connected.completion.sqlstate, '00000');
  assert.equal(agent.currentName, 'ONE');
  await agent.query("CONNECT TO 'local' AS 'two' USER 'bob'");
  assert.deepEqual(rowsOf(await agent.query('VALUES CURRENT_USER')), [['BOB']]);
  await assert.rejects(agent.query("CONNECT TO 'local' AS 'one'"), isFailure(-900, '0A001'), 'not in a transaction');
  await agent.query('ROLLBACK');
  await assert.rejects(agent.query("CONNECT TO 'local' AS 'two'"), isFailure(-919, '08002'));
  await agent.query("SET CONNECTION 'one'");
  assert.deepEqual(rowsOf(await agent.query('VALUES CURRENT_USER')), [['ANN']]);
  await agent.query('ROLLBACK');
  await agent.query('INSERT INTO NOPE VALUES (1)').catch(() => undefined);
  await agent.query('CREATE TABLE AG (X INTEGER)');
  await assert.rejects(agent.query("SET CONNECTION 'two'"), isFailure(-900, '0A001'), 'not in a transaction');
  await agent.query('ROLLBACK');
  await assert.rejects(agent.query("SET CONNECTION 'third'"), isFailure(-919, '08003'));
  await agent.query('DISCONNECT CURRENT');
  assert.equal(agent.currentName, undefined);
  await assert.rejects(agent.query('VALUES 1'), isFailure(-919, '08003'));
  await assert.rejects(agent.query("CONNECT TO 'x' USER 'a b'"), isFailure(-104, '28000'));
  await agent.query("SET CONNECTION 'two'");
  assert.notEqual(agent.canceller(), undefined);
  assert.equal(agent.isLost, false);
  await agent.query('DISCONNECT ALL');
  assert.deepEqual(asked, [
    ['local', 'ann'],
    ['local', 'bob'],
  ]);
  await agent.terminate();
});
