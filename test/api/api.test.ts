/**
 * Tests of the standard API against a scripted server on loopback that
 * answers every statement with rows of one column (RULES.md R-TEST-1).
 */

import assert from 'node:assert/strict';
import { after, test } from 'node:test';

import { Client, Turns, settingsOf } from '../../src/api/client.js';
import { ClientPool, createPool } from '../../src/api/pool.js';
import { Trust } from '../../src/auth/mechanism.js';
import type { Column } from '../../src/codec/composite.js';
import { REQUEST } from '../../src/codec/kinds.js';
import { Reader } from '../../src/codec/reader.js';
import { type Called, writeCalled } from '../../src/codec/called.js';
import { writeColumns } from '../../src/codec/declared.js';
import { readValues } from '../../src/codec/value-codec.js';
import { writeType } from '../../src/codec/types.js';
import { connectTo } from '../../src/session/connect.js';
import { Pool } from '../../src/pool/pool.js';
import { type Peer, type Scripted, scripted } from '../support/fake-server.js';
import { isFailure } from '../support/failures.js';

const servers: Scripted[] = [];
after(async () => {
  await Promise.all(servers.map((s) => s.close()));
});

/** The one column every query of the server gives. */
const ID: Column = { name: 'ID', type: { kind: 'varying', length: 10, units: 'characters' }, notNull: false };
/** The one column every prepared query of the server gives, of a distinct type it declares. */
const CODE: Column = { ...ID, name: 'CODE', declared: { name: 'USER-DEFINED', written: 'S.CODE' } };
/** What the server tells of every CALL: an IN `?` of parameter 1 and an OUT one of parameter 2. */
const CALLED: Called = {
  procedure: { schema: 'S', name: 'P' },
  parameters: [
    { mode: 'in', ordinal: 1, varying: false, type: ID.type },
    { mode: 'out', ordinal: 2, varying: false, type: ID.type },
  ],
};
/** The rows a cursor of the server reads. */
const ROWS = ['a', 'b', 'c', 'd', 'e'];

/**
 * Answers a peer as a server whose every query gives the rows of `ROWS`, and any other statement a completion.
 *
 * @param peer - the peer
 */
async function answer(peer: Peer): Promise<void> {
  const cursors = new Map<number, number>();
  for (;;) {
    const frame = await peer.frame();
    const r = new Reader(frame.body, 'request');
    if (frame.kind === REQUEST.TERMINATE) {
      peer.end();
      return;
    }
    if (frame.kind === REQUEST.QUERY) {
      const sql = r.string();
      if (sql.startsWith('VALUES')) {
        peer.description([ID]);
        peer.rows([[sql]]);
      }
      peer.complete({ active: !sql.startsWith('COMMIT') && !sql.startsWith('ROLLBACK') });
    } else if (frame.kind === REQUEST.PREPARE) {
      const [number, sql] = [r.u32(), r.string()];
      const query = sql.startsWith('SELECT');
      peer.reply('P', (w) => {
        w.u32(number).u32(1);
        writeType(w.flag(false), ID.type);
        writeColumns(w, query ? [CODE] : []);
        if (sql.startsWith('CALL')) writeCalled(w, CALLED);
      });
    } else if (frame.kind === REQUEST.EXECUTE) {
      const number = r.u32();
      const values = readValues(r);
      const rows = r.u32();
      if (rows === 0) {
        peer.rows([[values[0] ?? null]]);
        peer.complete({ active: true });
      } else {
        cursors.set(number, rows);
        peer.rows(ROWS.slice(0, rows).map((v) => [v]));
        peer.reply('S');
      }
    } else if (frame.kind === REQUEST.FETCH) {
      const number = r.u32();
      const at = cursors.get(number) ?? 0;
      const rows = r.u32();
      const next = ROWS.slice(at, at + rows);
      cursors.set(number, at + rows);
      peer.rows(next.map((v) => [v]));
      if (at + rows < ROWS.length) peer.reply('S');
      else peer.complete({ active: true });
    } else peer.complete({ active: true });
  }
}

/** @returns a client of a scripted server */
async function client(): Promise<Client> {
  const s = await scripted(async (peer) => {
    await peer.frame();
    peer.ready([]);
    await answer(peer);
  });
  servers.push(s);
  return new Client(await connectTo(s.target, 'ann', new Trust()));
}

/** Verifies: [DESIGN] D2 a query, with parameters by a statement prepared and destroyed; a prepared statement executed; one operation at a time, in order. */
test('queries and prepared statements', async () => {
  const c = await client();
  assert.deepEqual((await c.query('VALUES 1')).rows, [['VALUES 1']]);
  assert.deepEqual((await c.query('SELECT ?', ['x'])).rows, [['x']]);
  const done = await c.query('UPDATE T SET X = 1');
  assert.deepEqual([done.rows, done.completion?.sqlstate], [[], '00000']);
  const s = await c.prepare('SELECT ?');
  assert.deepEqual([s.parameterCount, s.columns.length], [1, 1]);
  const all = await Promise.all(['p', 'q', 'r'].map(async (v) => (await s.execute([v])).rows));
  assert.deepEqual(all, [[['p']], [['q']], [['r']]]);
  await s.close();
  await s.close();
  await c.close();
  await s[Symbol.asyncDispose]();
});

/** Verifies: [CLIENT Prepared statements] the standard API's columns give each column's type's name and its type as SQL writes it: as declared where the server told it, else as its tag says. */
test('columns tell their types', async () => {
  const c = await client();
  const [id] = (await c.query('VALUES 1')).columns;
  assert.deepEqual([id?.name, id?.typeName, id?.typeWritten], ['ID', 'CHARACTER VARYING', 'CHARACTER VARYING(10)']);
  const s = await c.prepare('SELECT CODE FROM T');
  const [code] = s.columns;
  assert.deepEqual([code?.typeName, code?.typeWritten, code?.type.kind], ['USER-DEFINED', 'S.CODE', 'varying']);
  assert.equal(s.columns, s.columns, 'made once');
  const cursor = await s.cursor([], { batch: 2 });
  assert.equal(cursor.columns[0]?.typeWritten, 'S.CODE');
  await cursor.close();
  await c.close();
});

/** Verifies: [CLIENT Prepared statements] a prepared statement's parameters, each `?` with its mode and ordinal position, of a CALL as the server told them, of another statement each IN; the procedure a CALL invokes. */
test('a prepared CALL tells the modes of its parameters', async () => {
  const c = await client();
  const call = await c.prepare('CALL P(?, ?)');
  assert.deepEqual(
    call.parameters.map((p) => [p.mode, p.ordinal]),
    [
      ['in', 1],
      ['out', 2],
    ],
  );
  assert.deepEqual([call.procedure, call.parameterCount], [{ schema: 'S', name: 'P' }, 1]);
  const query = await c.prepare('SELECT CODE FROM T WHERE ID = ?');
  assert.deepEqual(
    [query.procedure, query.parameters.map((p) => [p.mode, p.ordinal])],
    [undefined, [['in', undefined]]],
  );
  await c.close();
});

/** Verifies: [DESIGN] D2 a cursor read a batch at a time by for await, by next, its own statement or a prepared one's. */
test('cursors read in batches', async () => {
  const c = await client();
  const read: unknown[] = [];
  for await (const [v] of await c.cursor('SELECT ?', ['x'], { batch: 2 })) read.push(v);
  assert.deepEqual(read, ROWS);
  const s = await c.prepare('SELECT ?');
  const cursor = await s.cursor(['x'], { batch: 3 });
  assert.equal(cursor.columns.length, 1);
  assert.deepEqual(await cursor.next(), ['a']);
  await cursor[Symbol.asyncDispose]();
  for await (const row of await s.cursor(['x'], { batch: 9 })) assert.ok(row.length === 1);
  await c[Symbol.asyncDispose]();
});

/** Verifies: [DESIGN] D2 a transaction committed as its work succeeds, rolled back as it fails; a client closed refuses work (TB910); a signal aborted before sends nothing (TB920). */
test('transactions, closing and signals', async () => {
  const c = await client();
  assert.equal(await c.transaction(async (t) => (await t.query('VALUES 1')).rows.length), 1);
  await assert.rejects(
    c.transaction(() => Promise.reject(new Error('no'))),
    /no/u,
  );
  c.autocommit = true;
  assert.equal(c.autocommit, true);
  await assert.rejects(c.query('VALUES 1', [], { signal: AbortSignal.abort() }), isFailure(-920, 'TB920'));
  await c.close();
  await assert.rejects(c.query('VALUES 1'), isFailure(-910, 'TB910'));
  assert.equal(c.closed, true);
});

/** Verifies: [DESIGN] D2 operations of one connection run in the order asked, a failure not stopping the next. */
test('turns', async () => {
  const turns = new Turns();
  const order: number[] = [];
  const first = turns.run(async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
    order.push(1);
    throw new Error('first');
  });
  const second = turns.run(() => {
    order.push(2);
    return Promise.resolve(2);
  });
  await assert.rejects(first);
  assert.equal(await second, 2);
  assert.deepEqual(order, [1, 2]);
});

/** Verifies: [DESIGN] D2 a pool's clients give their connections back as they close; its query runs on one; options read as settings. */
test('a pool of clients', async () => {
  const s = await scripted(async (peer) => {
    await peer.frame();
    peer.ready(['ping', 'reset']);
    await answer(peer);
  });
  servers.push(s);
  const pool = new ClientPool('turborel://ann@h/?tls_mode=disable');
  Object.defineProperty(pool, 'pool', { value: new Pool(() => connectTo(s.target, 'ann', new Trust())) });
  assert.deepEqual((await pool.query('VALUES 7')).rows, [['VALUES 7']]);
  assert.deepEqual(pool.pool.counts, { made: 1, idle: 1 });
  await pool[Symbol.asyncDispose]();
  assert.deepEqual(pool.pool.counts, { made: 0, idle: 0 });
  assert.ok(createPool({ user: 'ann', host: 'h', port: 1 }) instanceof ClientPool);
  const settings = settingsOf({ user: 'ann', host: 'db', port: 7000, tls_mode: 'disable', connect_timeout: 5 });
  assert.deepEqual([settings.hosts, settings.connectTimeout], [[{ kind: 'tcp', name: 'db', port: 7000 }], 5000]);
  assert.throws(() => settingsOf('other://x'), isFailure(-919, '08001'));
});
