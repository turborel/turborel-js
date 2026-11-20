/**
 * Live tests of running statements, against the server
 * TURBOREL_TEST_SERVER names (RULES.md R-TEST-8): queries and their
 * failures, every kind of value, transactions and autocommit, several
 * statements in one request, prepared statements and their cursors.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Decimal } from '../../src/codec/decimal.js';
import { Datetime, Interval, PluginValue } from '../../src/codec/values.js';
import type { Connection } from '../../src/session/connection.js';
import type { Outcome } from '../../src/session/statements.js';
import { TurborelError } from '../../src/error.js';
import { isFailure } from '../support/failures.js';
import { ann, live, liveServer } from '../support/live.js';

liveServer();

/**
 * The rows of an outcome, or a failure if it has none.
 *
 * @param outcome - the outcome
 * @returns its rows
 */
function rowsOf(outcome: Outcome): readonly (readonly unknown[])[] {
  if (outcome.kind !== 'rows') throw new Error(`no rows: ${outcome.completion.sqlstate}`);
  return outcome.rows;
}

/**
 * A connection with the table `name` of IDs 1 to `count` and their names, committed.
 *
 * @param name - the table's name
 * @param count - how many rows
 * @returns the connection
 */
async function withTable(name: string, count: number): Promise<Connection> {
  const conn = await ann();
  await conn.query(`CREATE TABLE ${name} (ID INTEGER PRIMARY KEY, NAME VARCHAR(20))`);
  const values = Array.from({ length: count }, (_, i) => `(${String(i + 1)}, 'N${String(i + 1)}')`);
  await conn.query(`INSERT INTO ${name} VALUES ${values.join(', ')}`);
  await conn.query('COMMIT');
  return conn;
}

/** Verifies: [CLIENT Running statements] a query's columns and rows; another statement's completion, 02000 for no row; a failure's SQLCODE, SQLSTATE, message and diagnostics. */
test('queries, statements and failures', async (t) => {
  if (live(t) === undefined) return;
  const conn = await withTable('STAFF', 2);
  const staff = await conn.query('SELECT ID, NAME FROM STAFF ORDER BY ID');
  assert.deepEqual(staff.kind === 'rows' && staff.columns.map((c) => c.name), ['ID', 'NAME']);
  assert.deepEqual(rowsOf(staff), [
    [1n, 'N1'],
    [2n, 'N2'],
  ]);
  const none = await conn.query('DELETE FROM STAFF WHERE ID = 9');
  assert.deepEqual(none.kind === 'done' && [none.completion.sqlcode, none.completion.sqlstate], [100, '02000']);
  await assert.rejects(conn.query('SELECT * FROM NOPE'), (e: unknown) => {
    assert.ok(e instanceof TurborelError);
    assert.deepEqual([e.sqlcode, e.sqlstate, e.message], [-103, '2A000', 'table ANN.NOPE is not defined']);
    assert.deepEqual(e.diagnostics, { severity: 'ERROR', schema: 'ANN', table: 'NOPE' });
    return true;
  });
  await assert.rejects(conn.query("INSERT INTO STAFF VALUES (1, 'Dup')"), (e: unknown) => {
    assert.ok(e instanceof TurborelError);
    assert.deepEqual([e.sqlcode, e.sqlstate], [-201, '23000']);
    assert.equal(e.diagnostics?.constraint, 'STAFF_PRIMARY1');
    assert.equal(e.diagnostics.detail, 'the key (1) is held by another row');
    return true;
  });
  await assert.rejects(
    conn.query('SELECT FROM'),
    (e: unknown) => e instanceof TurborelError && e.position !== undefined,
  );
  await conn.terminate();
});

/** Verifies: [CLIENT Running statements] a query's rows given to a sink a batch at a time, as they come. */
test('rows a batch at a time', async (t) => {
  if (live(t) === undefined) return;
  const conn = await withTable('MANY', 100);
  const batches: number[] = [];
  const streamed = await conn.queryInto('SELECT A.ID, B.ID FROM MANY A, MANY B', {
    columns: (columns) => {
      assert.equal(columns.length, 2);
    },
    rows: (rows) => {
      batches.push(rows.length);
    },
  });
  assert.deepEqual(streamed, { kind: 'rows', count: 10_000 });
  assert.ok(batches.length > 1, 'more than one batch');
  assert.equal(
    batches.reduce((a, b) => a + b, 0),
    10_000,
  );
  await conn.terminate();
});

/** Verifies: [CLIENT Running statements] every kind of value: exact, approximate, character, binary, datetime, interval, a plug-in's, null. */
test('every kind of value', async (t) => {
  if (live(t) === undefined) return;
  const conn = await ann();
  const [row = []] = rowsOf(
    await conn.query(
      "VALUES (CAST(1.5 AS DECIMAL(5,2)), CAST(1.5 AS DOUBLE PRECISION), 'x', X'0A', DATE '2026-11-19', " +
        "INTERVAL '1' DAY, ST_POINT(1, 2), CAST(NULL AS INTEGER), TRUE, 7)",
    ),
  );
  const [exact, approximate, char, binary, date, interval, plugin, nothing, truth, integer] = row;
  assert.ok(exact instanceof Decimal);
  assert.equal(String(exact), '1.50');
  assert.deepEqual([approximate, char, binary], [1.5, 'x', Uint8Array.of(10)]);
  assert.ok(date instanceof Datetime);
  assert.deepEqual([date.moment, date.utc], ['date', 63_930_643_200_000_000n], 'microseconds from 0001-01-01');
  assert.ok(interval instanceof Interval);
  assert.equal(interval.units, 86_400_000_000n);
  assert.ok(plugin instanceof PluginValue);
  assert.deepEqual([plugin.typeName, plugin.text], ['ST_GEOMETRY', 'POINT (1 2)']);
  assert.deepEqual([nothing, truth, integer], [null, true, 7n]);
  await conn.terminate();
});

/** Verifies: [PROTOCOL Conversations] [CLIENT Running statements] a transaction begun by the first statement lasts until COMMIT or ROLLBACK, as the connection tells; under autocommit each statement is its own. */
test('transactions and autocommit', async (t) => {
  if (live(t) === undefined) return;
  const conn = await withTable('TX', 1);
  assert.equal(conn.inTransaction, false);
  await conn.query("INSERT INTO TX VALUES (2, 'two')");
  assert.equal(conn.inTransaction, true, 'begun by the first statement');
  await conn.query('ROLLBACK');
  assert.equal(conn.inTransaction, false);
  conn.setAutocommit(true);
  await conn.query("INSERT INTO TX VALUES (3, 'three')");
  assert.equal(conn.inTransaction, false, 'committed as it succeeded');
  await assert.rejects(conn.query("INSERT INTO TX VALUES (3, 'again')"));
  assert.equal(conn.inTransaction, false, 'rolled back as it failed');
  const other = await ann();
  assert.deepEqual(rowsOf(await other.query('SELECT ID FROM TX ORDER BY ID')), [[1n], [3n]]);
  await other.terminate();
  await conn.query('CREATE TABLE DEF (ID INTEGER, CONSTRAINT POS CHECK (ID > 0) INITIALLY DEFERRED)');
  await assert.rejects(conn.query('INSERT INTO DEF VALUES (-1)'), isFailure(-913, '40002'), 'the commit fails');
  assert.equal(conn.inTransaction, false);
  await conn.terminate();
});

/** Verifies: [PROTOCOL Query 'Q'] a result that sent a locator keeps its transaction, under autocommit too. */
test('a locator keeps its transaction', async (t) => {
  if (live(t) === undefined) return;
  const conn = await ann();
  await conn.query('CREATE TABLE DOCS (ID INTEGER, C CLOB(1M))');
  const insert = await conn.prepare('INSERT INTO DOCS VALUES (1, ?)');
  await conn.execute(insert, ['x'.repeat(70_000)]);
  await conn.query('COMMIT');
  conn.setAutocommit(true);
  const [[doc] = []] = rowsOf(await conn.query('SELECT C FROM DOCS'));
  assert.ok(typeof doc === 'object' && doc !== null && !(doc instanceof Uint8Array), 'a locator, not the value');
  assert.equal(conn.inTransaction, true);
  await conn.query('COMMIT');
  await conn.terminate();
});

/** Verifies: [CLIENT Controlling the session] several statements as one request: each outcome in turn, and the failure that stopped the rest. */
test('several statements in one request', async (t) => {
  if (live(t) === undefined) return;
  const conn = await withTable('MULTI', 1);
  const ran = await conn.queryMany("INSERT INTO MULTI VALUES (2, 'b'); SELECT ID FROM MULTI ORDER BY ID; COMMIT");
  assert.deepEqual(
    ran.outcomes.map((o) => o.kind),
    ['done', 'rows', 'done'],
  );
  assert.deepEqual(ran.outcomes[1] && rowsOf(ran.outcomes[1]), [[1n], [2n]]);
  assert.equal(ran.failure, undefined);
  const stopped = await conn.queryMany("INSERT INTO MULTI VALUES (3, 'c'); INSERT INTO MULTI VALUES (3, 'd'); COMMIT");
  assert.equal(stopped.outcomes.length, 1);
  assert.equal(stopped.failure?.sqlstate, '23000');
  const empty = await conn.queryMany('');
  assert.equal(empty.outcomes.length, 1, 'text of no statement, one Complete');
  await conn.query('ROLLBACK');
  await conn.terminate();
});

/** Verifies: [CLIENT Prepared statements] prepared once, its parameters' types and columns given; executed with values as often as wanted, across transactions; deallocated. */
test('prepared statements', async (t) => {
  if (live(t) === undefined) return;
  const conn = await withTable('PREP', 3);
  const byId = await conn.prepare('SELECT NAME FROM PREP WHERE ID = ?');
  assert.equal(byId.parameters[0]?.type.kind, 'exact');
  assert.deepEqual(
    byId.columns.map((c) => c.name),
    ['NAME'],
  );
  assert.deepEqual(rowsOf(await conn.execute(byId, [2n])), [['N2']]);
  await conn.query('COMMIT');
  assert.deepEqual(rowsOf(await conn.execute(byId, [3n])), [['N3']], 'valid across transactions');
  const insert = await conn.prepare('INSERT INTO PREP VALUES (?, ?)');
  const done = await conn.execute(insert, [4n, 'N4']);
  assert.equal(done.kind, 'done');
  await assert.rejects(conn.execute(insert, [5n]), isFailure(-921, '07001'));
  assert.deepEqual((await conn.describe(byId)).columns, byId.columns, 'described again');
  await conn.deallocate(insert);
  await assert.rejects(conn.execute(insert, [6n, 'N6']), isFailure(-921, '26000'));
  await assert.rejects(conn.deallocate(insert), isFailure(-921, '26000'));
  await assert.rejects(conn.prepare('SELECT FROM'));
  await conn.query('ROLLBACK');
  await conn.terminate();
});

/** Verifies: [CLIENT Prepared statements] a cursor opened with its first rows, fetched a batch at a time, closed; several numbered cursors at once; described while open. */
test('cursors', async (t) => {
  if (live(t) === undefined) return;
  const conn = await withTable('CUR', 5);
  const all = await conn.prepare('SELECT ID FROM CUR ORDER BY ID');
  assert.deepEqual(await conn.openCursor(all, [], { rows: 2 }), { rows: [[1n], [2n]], more: true });
  await assert.rejects(conn.openCursor(all, []), isFailure(-501, '24000'), 'already open');
  await assert.rejects(conn.deallocate(all), isFailure(-501, '24000'), 'its cursor open');
  assert.deepEqual(await conn.fetch(all, { rows: 2 }), { rows: [[3n], [4n]], more: true });
  assert.deepEqual(await conn.fetch(all), { rows: [[5n]], more: false });
  await assert.rejects(conn.fetch(all), isFailure(-501, '24000'), 'closed once read');
  await conn.openCursor(all, [], { rows: 1, cursor: 1 });
  await conn.openCursor(all, [], { rows: 3, cursor: 2 });
  assert.deepEqual(
    (await conn.describeCursor(all, 2)).map((c) => c.name),
    ['ID'],
  );
  assert.deepEqual(await conn.fetch(all, { rows: 1, cursor: 1 }), { rows: [[2n]], more: true });
  assert.deepEqual(await conn.fetch(all, { rows: 1, cursor: 2 }), { rows: [[4n]], more: true });
  await conn.send({ kind: 'prepare', statement: all.number, sql: 'VALUES 1' });
  await assert.rejects(
    conn.receive().then((reply) => {
      if (reply.kind === 'error') throw reply.failure;
    }),
    isFailure(-501, '24000'),
    'a statement whose cursor is open is not replaced',
  );
  await conn.close(all, 1);
  await conn.close(all, 2);
  await conn.send({ kind: 'prepare', statement: all.number, sql: "VALUES ('replaced')" });
  assert.equal((await conn.receive()).kind, 'prepared');
  const [replaced] = rowsOf(await conn.execute(all));
  assert.deepEqual(replaced, ['replaced'], 'its number now the new statement');
  await assert.rejects(conn.close(all, 2), isFailure(-501, '24000'));
  await conn.query('COMMIT');
  await conn.terminate();
});

/** Verifies: [PROTOCOL Conversations] [PROTOCOL Execute 'E'] under autocommit with `fetch-ends`, a cursor's transaction ends as it does: its last row's fetch commits, close commits, a failing fetch rolls back. */
test('a cursor ends its transaction', async (t) => {
  if (live(t) === undefined) return;
  const conn = await withTable('ENDS', 3);
  conn.setAutocommit(true);
  const all = await conn.prepare('SELECT ID FROM ENDS ORDER BY ID');
  await conn.openCursor(all, [], { rows: 1 });
  assert.equal(conn.inTransaction, true, 'kept while the cursor is open');
  await conn.fetch(all);
  assert.equal(conn.inTransaction, false, 'the last row committed it');
  await conn.openCursor(all, [], { rows: 1 });
  await conn.close(all);
  assert.equal(conn.inTransaction, false, 'close committed it');
  // The fourth row's value, an attribute alone, has no serialization:
  // the fetch that sends it fails.
  await conn.query('CREATE TABLE MARKED (ID INTEGER, B XML)');
  for (const id of [1, 2, 3, 4]) {
    await conn.query(
      `INSERT INTO MARKED VALUES (${String(id)}, XMLPARSE(CONTENT '<a n="${String(id)}">${String(id)}</a>' PRESERVE WHITESPACE))`,
    );
  }
  const failing = await conn.prepare(
    `SELECT XMLQUERY('$b/a[. = 4]/@n' PASSING BY VALUE B AS "b" RETURNING SEQUENCE NULL ON EMPTY) FROM MARKED ORDER BY ID`,
  );
  await conn.openCursor(failing, [], { rows: 1 });
  assert.equal(conn.inTransaction, true);
  await assert.rejects(conn.fetch(failing), isFailure(-301, '2200W'));
  assert.equal(conn.inTransaction, false, 'a failing fetch rolled it back');
  await conn.terminate();
});

/** Verifies: [PROTOCOL Execute 'E'] [PROTOCOL Prepared 'P'] a CALL's parameters are its inputs, its columns its OUT and INOUT parameters; executed, it gives one row of their values. */
test('CALL output parameters', async (t) => {
  if (live(t) === undefined) return;
  const conn = await ann();
  await conn.query(
    'CREATE PROCEDURE TWICE(IN A INTEGER, INOUT B INTEGER, OUT C INTEGER) LANGUAGE SQL CONTAINS SQL BEGIN SET C = A * 2; SET B = B + 1; END',
  );
  const call = await conn.prepare('CALL TWICE(?, ?, ?)');
  assert.equal(call.parameters.length, 2, 'A and B, the inputs');
  assert.deepEqual(
    call.columns.map((c) => c.name),
    ['B', 'C'],
  );
  assert.deepEqual(rowsOf(await conn.execute(call, [21n, 1n])), [[2n, 42n]]);
  await conn.query('ROLLBACK');
  await conn.terminate();
});
