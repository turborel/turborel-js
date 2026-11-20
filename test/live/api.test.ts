/**
 * Live tests of the standard API (RULES.md D2), against the server
 * TURBOREL_TEST_SERVER names (RULES.md R-TEST-8).
 */

import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { test } from 'node:test';

import { type Client, connect } from '../../src/api/client.js';
import { createPool } from '../../src/api/pool.js';
import { Decimal } from '../../src/codec/decimal.js';
import { DecFloat } from '../../src/codec/decfloat.js';
import { LobLocator } from '../../src/codec/values.js';
import { PORT } from '../server/server.js';
import { isFailure } from '../support/failures.js';
import { live, liveServer } from '../support/live.js';

liveServer();

/** The server's URI, by trust over TCP. */
const URI = `turborel://ann@127.0.0.1:${String(PORT)}/?tls_mode=disable`;

/**
 * A client with a table T of `count` rows.
 *
 * @param table - the table's name
 * @param count - its rows
 * @returns the client
 */
async function withTable(table: string, count: number): Promise<Client> {
  const client = await connect(URI);
  await client.query(`CREATE TABLE ${table} (ID INTEGER PRIMARY KEY, NAME VARCHAR(20))`);
  for (let i = 1; i <= count; i += 1)
    await client.query(`INSERT INTO ${table} VALUES (?, ?)`, [BigInt(i), `N${String(i)}`]);
  await client.commit();
  return client;
}

/** Verifies: [DESIGN] D2 connect of a URI or options gives a connection; query with parameters; close and await using. */
test('connect and query', async (t) => {
  if (live(t) === undefined) return;
  {
    await using client = await connect({
      host: '127.0.0.1',
      port: PORT,
      user: 'ann',
      tls_mode: 'disable',
      autocommit: true,
    });
    assert.equal(client.autocommit, true);
    const { rows, columns } = await client.query('VALUES (CAST(? AS INTEGER), CAST(? AS VARCHAR(5)))', [1n, 'one']);
    assert.deepEqual([rows, columns.length], [[[1n, 'one']], 2]);
    const made = await client.query('CREATE TABLE Q (ID INTEGER)');
    assert.deepEqual([made.rows, made.completion?.sqlstate], [[], '00000']);
    const inserted = await client.query('INSERT INTO Q VALUES (1), (2)');
    assert.equal(inserted.rowCount, 2n);
  }
  const client = await withTable('STAFF', 3);
  const { rows, rowCount } = await client.query('SELECT ID, NAME FROM STAFF WHERE ID < ? ORDER BY ID', [3n]);
  assert.deepEqual(rows, [
    [1n, 'N1'],
    [2n, 'N2'],
  ]);
  assert.equal(rowCount, 2n);
  await assert.rejects(client.query('SELECT * FROM NOPE'), isFailure(-103, '2A000'));
  await client.close();
  await client.close();
  assert.equal(client.closed, true);
  await assert.rejects(client.query('VALUES 1'), isFailure(-910, 'TB910'));
});

/** Verifies: [DESIGN] D2 prepare, and the statement executed as often as wanted, closed; concurrent queries of one connection run in turn. */
test('prepared statements', async (t) => {
  if (live(t) === undefined) return;
  await using client = await withTable('PS', 3);
  await using byId = await client.prepare('SELECT NAME FROM PS WHERE ID = ?');
  assert.equal(byId.parameterCount, 1);
  assert.deepEqual(
    byId.columns.map((c) => c.name),
    ['NAME'],
  );
  const names = await Promise.all([1n, 2n, 3n].map(async (id) => (await byId.execute([id])).rows[0]?.[0]));
  assert.deepEqual(names, ['N1', 'N2', 'N3'], 'in turn, each its own reply');
  const both = await Promise.all([client.query('VALUES 1'), client.query('VALUES 2')]);
  assert.deepEqual(
    both.map((r) => r.rows),
    [[[1n]], [[2n]]],
  );
});

/** Verifies: [DESIGN] D2 a cursor is an async iterator of rows, read by `for await`, a batch at a time; leaving it early closes it. */
test('cursors', async (t) => {
  if (live(t) === undefined) return;
  await using client = await withTable('CUR', 250);
  const seen: unknown[] = [];
  for await (const [id] of await client.cursor('SELECT ID FROM CUR WHERE ID > ? ORDER BY ID', [200n], { batch: 7 })) {
    seen.push(id);
  }
  assert.equal(seen.length, 50);
  assert.deepEqual([seen[0], seen.at(-1)], [201n, 250n]);
  const all = await client.prepare('SELECT ID FROM CUR ORDER BY ID');
  for await (const [id] of await all.cursor([], { batch: 10 })) {
    if (id === 3n) break;
  }
  let count = 0;
  for await (const row of await all.cursor()) count += row.length;
  assert.equal(count, 250, 'the statement kept, its cursor closed by the break');
  await using cursor = await all.cursor([], { batch: 2 });
  assert.deepEqual(await cursor.next(), [1n]);
  assert.equal(cursor.columns.length, 1);
  await cursor.close();
  assert.equal(await cursor.next(), undefined);
  await all.close();
  await client.commit();
});

/** Verifies: [DESIGN] D2 transactions: a transaction's work committed as it succeeds, rolled back as it fails; autocommit. */
test('transactions', async (t) => {
  if (live(t) === undefined) return;
  await using client = await withTable('TX', 0);
  await client.transaction(async (c) => {
    await c.query('INSERT INTO TX VALUES (1, ?)', ['kept']);
  });
  await assert.rejects(
    client.transaction(async (c) => {
      await c.query('INSERT INTO TX VALUES (2, ?)', ['undone']);
      throw new Error('no');
    }),
    /no/u,
  );
  assert.deepEqual((await client.query('SELECT ID FROM TX')).rows, [[1n]]);
  assert.equal(client.inTransaction, true);
  await assert.rejects(
    client.transaction(() => Promise.resolve()),
    isFailure(-917, '25000'),
  );
  await client.rollback();
  client.autocommit = true;
  await client.query("INSERT INTO TX VALUES (3, 'auto')");
  assert.equal(client.inTransaction, false);
});

/** Verifies: [DESIGN] D11 exact numbers come as bigint and Decimal, and DECFLOAT as DecFloat; each goes back as it came. */
test('exact numbers', async (t) => {
  if (live(t) === undefined) return;
  await using client = await connect(URI);
  const { rows } = await client.query(
    "VALUES (CAST(? AS BIGINT), CAST(? AS DECIMAL(18,10)), CAST('1.5E400' AS DECFLOAT))",
    [9_007_199_254_740_993n, new Decimal(123_456_789_012_345_678n, 10)],
  );
  const [big, decimal, decfloat] = rows[0] ?? [];
  assert.equal(big, 9_007_199_254_740_993n, 'past 2^53, exact');
  assert.ok(decimal instanceof Decimal && decfloat instanceof DecFloat);
  assert.equal(String(decimal), '12345678.9012345678');
  assert.equal(String(decfloat), '1.5E400');
});

/** Verifies: [DESIGN] D2 large objects as Node.js streams: written from a readable stream, read as one. */
test('large objects as streams', async (t) => {
  if (live(t) === undefined) return;
  await using client = await connect(URI);
  await client.query('CREATE TABLE DOCS (B BLOB(10M))');
  const source = Readable.from(Array.from({ length: 64 }, () => Buffer.alloc(4096, 9)));
  const blob = await client.writeLob('binary', source);
  await client.query('INSERT INTO DOCS VALUES (?)', [blob]);
  const [[value] = []] = (await client.query('SELECT B FROM DOCS')).rows;
  assert.ok(value instanceof LobLocator);
  let octets = 0;
  for await (const chunk of client.readLob(value)) octets += (chunk as Uint8Array).byteLength;
  assert.equal(octets, 262_144);
  await client.rollback();
});

/** Verifies: [DESIGN] D2 an AbortSignal cancels a statement, which fails with TB920; one aborted before is not sent. */
test('cancelled by a signal', async (t) => {
  if (live(t) === undefined) return;
  await using client = await withTable('SLOW', 300);
  const aborted = AbortSignal.abort();
  await assert.rejects(client.query('VALUES 1', [], { signal: aborted }), isFailure(-920, 'TB920'));
  for (;;) {
    const controller = new AbortController();
    const running = client.query('SELECT COUNT(*) FROM SLOW A, SLOW B, SLOW C', [], { signal: controller.signal });
    setTimeout(() => {
      controller.abort();
    }, 20);
    const outcome = await running.then(
      () => 'ran',
      (e: unknown) => e,
    );
    if (outcome === 'ran') continue;
    assert.ok(isFailure(-920, 'TB920')(outcome));
    break;
  }
  assert.deepEqual((await client.query('VALUES 1')).rows, [[1n]], 'the connection goes on');
});

/** Verifies: [DESIGN] D2 a pool hands out clients whose close gives them back; its query runs on one; close and await using. */
test('pools', async (t) => {
  if (live(t) === undefined) return;
  await using pool = createPool(URI, { max: 2 });
  const results = await Promise.all([1n, 2n, 3n, 4n].map((n) => pool.query('VALUES CAST(? AS INTEGER)', [n])));
  assert.deepEqual(
    results.map((r) => r.rows[0]?.[0]),
    [1n, 2n, 3n, 4n],
  );
  {
    await using client = await pool.connect();
    await client.query('VALUES 1');
  }
  assert.deepEqual(pool.pool.counts, { made: 2, idle: 2 });
});
