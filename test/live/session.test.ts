/**
 * Live tests of what the server tells of each statement and of how a
 * connection controls its session, against the server
 * TURBOREL_TEST_SERVER names (RULES.md R-TEST-8): notices, conditions,
 * counts, generated values, timing and commit positions; each capability
 * granted or not; ping, reset and change of user; query attributes; XML
 * and UUID values.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Password, Trust } from '../../src/auth/mechanism.js';
import { MAX_BODY } from '../../src/codec/frame.js';
import { type Reply, decodeReply } from '../../src/codec/replies.js';
import { type Request, encodeRequest } from '../../src/codec/requests.js';
import { Uuid, Xml } from '../../src/codec/values.js';
import * as cap from '../../src/session/capabilities.js';
import { connectTo } from '../../src/session/connect.js';
import type { Outcome } from '../../src/session/statements.js';
import { type Notice, Offer } from '../../src/session/told.js';
import { FrameStream } from '../../src/transport/frames.js';
import { local, open, tcp } from '../../src/transport/target.js';
import { PORT, USERS } from '../server/server.js';
import { isConnectionFailure, isFailure } from '../support/failures.js';
import { ann, live, liveServer } from '../support/live.js';

liveServer();

/** A query whose SUM leaves a null out, completing with warning 01003. */
const WARNS = 'SELECT SUM(V) FROM (VALUES (CAST(NULL AS INTEGER)), (1)) AS T(V)';

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
 * An offer of every capability but compression and those named.
 *
 * @param left - the capabilities left out
 * @returns the offer
 */
function without(...left: string[]): Offer {
  return new Offer(Offer.default().capabilities.filter((c) => !left.includes(c)));
}

/** Verifies: [CLIENT What the server tells] the rows a statement changed or a query returned; the identity values an INSERT generated; the server's time; the last commit's position. */
test('what the server tells of a statement', async (t) => {
  if (live(t) === undefined) return;
  const conn = await ann();
  await conn.query('CREATE TABLE G (ID INTEGER GENERATED ALWAYS AS IDENTITY, V INTEGER)');
  await conn.query('INSERT INTO G (V) VALUES (5), (6), (7)');
  assert.deepEqual([conn.rowsAffected, conn.lastGenerated], [3n, ['1', '2', '3']]);
  const time = conn.serverTime;
  assert.ok(time !== undefined && time.total >= time.queued && time.total >= time.locks);
  const none = conn.commitPosition;
  assert.equal(none, undefined, 'no commit yet');
  await conn.query('COMMIT');
  const position = conn.commitPosition;
  assert.ok(position !== undefined && position > 0n);
  await conn.query('UPDATE G SET V = V + 1 WHERE V > 5');
  assert.deepEqual([conn.rowsAffected, conn.lastGenerated], [2n, []]);
  await conn.query('SELECT V FROM G');
  assert.equal(conn.rowsAffected, 3n, 'a query, once all its rows were read');
  const kept = conn.commitPosition;
  assert.equal(kept, position, 'kept until the next commit');
  await conn.query('COMMIT');
  assert.ok((conn.commitPosition ?? 0n) > position);
  await conn.terminate();
});

/** Verifies: [PROTOCOL Errors and notices] a statement's conditions come in its Complete with `conditions`, else as Notices with `notices`, else not at all; of severity WARNING. */
test('conditions, told one way', async (t) => {
  if (live(t) === undefined) return;
  const conditions = await ann();
  await conditions.query(WARNS);
  assert.deepEqual(
    conditions.conditions.map((c) => [c.sqlstate, c.diagnostics?.severity]),
    [['01003', 'WARNING']],
  );
  assert.equal(conditions.warning, '01003');
  assert.deepEqual(conditions.takeNotices(), [], 'not as a notice too');
  assert.deepEqual(
    conditions.takeConditions().map((c) => c.sqlstate),
    ['01003'],
  );
  assert.deepEqual(conditions.takeConditions(), [], 'taken once');
  await conditions.query(
    "CREATE PROCEDURE WARN_THEN_FAIL() LANGUAGE SQL CONTAINS SQL BEGIN SIGNAL SQLSTATE '01ABC' SET MESSAGE_TEXT = 'first'; SIGNAL SQLSTATE '22ABC' SET MESSAGE_TEXT = 'then'; END",
  );
  await assert.rejects(conditions.query('CALL WARN_THEN_FAIL()'), isFailure(-401, '22ABC'));
  assert.deepEqual(
    conditions.takeNotices().map((n) => n.sqlstate),
    ['01ABC'],
    "a failing statement's conditions, as notices",
  );
  await conditions.terminate();
  const notices = await ann(without(cap.CONDITIONS));
  await notices.query(WARNS);
  assert.deepEqual(notices.conditions, []);
  assert.deepEqual(
    notices.takeNotices().map((n) => n.sqlstate),
    ['01003'],
  );
  await notices.terminate();
  const neither = await ann(without(cap.CONDITIONS, cap.NOTICES));
  await neither.query(WARNS);
  assert.deepEqual([neither.conditions, neither.takeNotices()], [[], []]);
  assert.equal(neither.warning, '01003', 'the completion still warns');
  await neither.terminate();
});

/** Verifies: [PROTOCOL Conversations] [CLIENT What the server tells] notices go to a handler as they come, before the statement's last reply; with none, the last are kept and taken. */
test('notices, to a handler or kept', async (t) => {
  if (live(t) === undefined) return;
  const conn = await ann(without(cap.CONDITIONS));
  const order: string[] = [];
  conn.setNoticeHandler((n: Notice) => order.push(`notice ${n.sqlstate}`));
  const streamed = await conn.queryInto(WARNS, {
    columns: () => {
      order.push('columns');
    },
    rows: () => {
      order.push('rows');
    },
  });
  order.push(streamed.kind);
  assert.deepEqual(order, ['columns', 'rows', 'notice 01003', 'rows'], 'rows, then the notice, then the end');
  conn.setNoticeHandler(undefined);
  await conn.query(WARNS);
  assert.equal(conn.takeNotices().length, 1);
  await conn.terminate();
});

/** Verifies: [PROTOCOL Capabilities] without `diagnostics` a failure has none; without `row-counts`, `generated-values` or `commit-position` the Complete says none of them. */
test('capabilities not asked for', async (t) => {
  if (live(t) === undefined) return;
  const conn = await ann(Offer.none());
  assert.deepEqual(conn.granted, []);
  await assert.rejects(conn.query('SELECT * FROM NOPE'), (e: unknown) => {
    assert.ok(isFailure(-103, '2A000')(e));
    return (e as { diagnostics?: unknown }).diagnostics === undefined;
  });
  await conn.query('CREATE TABLE H (ID INTEGER GENERATED ALWAYS AS IDENTITY, V INTEGER)');
  await conn.query('INSERT INTO H (V) VALUES (1)');
  assert.deepEqual([conn.rowsAffected, conn.lastGenerated, conn.serverTime], [undefined, [], undefined]);
  await conn.query('COMMIT');
  assert.equal(conn.commitPosition, undefined);
  await conn.query(WARNS);
  assert.deepEqual([conn.conditions, conn.takeNotices()], [[], []], 'no conditions, no notices');
  for (const refused of [conn.ping(), conn.reset(), conn.queryMany('VALUES 1'), conn.changeUser('bob', new Trust())]) {
    await assert.rejects(refused, isConnectionFailure);
  }
  assert.throws(() => {
    conn.setQueryAttributes([['app', 'x']]);
  }, isConnectionFailure);
  const s = await conn.prepare('VALUES (1), (2), (3)');
  for (const refused of [conn.describe(s), conn.openCursor(s, [], { cursor: 1 })]) {
    await assert.rejects(refused, isConnectionFailure);
  }
  conn.setAutocommit(true);
  await conn.openCursor(s, [], { rows: 1 });
  assert.equal(conn.inTransaction, true, 'without fetch-ends the cursor keeps its transaction');
  await conn.fetch(s);
  assert.equal(conn.inTransaction, true);
  await conn.query('COMMIT');
  await conn.terminate();
});

/** Verifies: [PROTOCOL Conversations] [CLIENT Controlling the session] ping; reset rolls the transaction back, told by notice 01T01, its statements, temporary tables and settings gone, every setting told again. */
test('ping and reset', async (t) => {
  if (live(t) === undefined) return;
  const conn = await ann();
  await conn.ping();
  await conn.query("SET TIME ZONE INTERVAL '+02:00' HOUR TO MINUTE");
  assert.equal(conn.setting('SESSION.TIME_ZONE'), '+02:00');
  await conn.query('DECLARE LOCAL TEMPORARY TABLE MODULE.TMP (X INTEGER)');
  const s = await conn.prepare('VALUES 1');
  await conn.query('VALUES 1');
  assert.equal(conn.inTransaction, true);
  const key = conn.cancelKey();
  await conn.reset();
  assert.equal(conn.inTransaction, false);
  assert.deepEqual([conn.cancelKey(), conn.authorization], [key, 'ANN'], 'its user and cancel key kept');
  const [notice] = conn.takeNotices();
  assert.deepEqual([notice?.sqlstate, notice?.diagnostics?.severity], ['01T01', 'NOTICE']);
  assert.equal(conn.setting('SESSION.TIME_ZONE'), '+00:00', 'settings told again');
  await conn.reset();
  assert.deepEqual(conn.takeNotices(), [], 'no transaction, no notice');
  await assert.rejects(conn.execute(s), isFailure(-921, '26000'), 'its statements gone');
  await assert.rejects(conn.query('SELECT X FROM MODULE.TMP'), isFailure(-103, '2A000'), 'its temporary tables gone');
  await conn.terminate();
});

/** Verifies: [CLIENT Controlling the session] change of user: the session renewed as the new user's, a transaction rolled back by notice 01T01; a refusal closes the connection. */
test('change user', async (t) => {
  const s = live(t);
  if (s === undefined) return;
  const conn = await connectTo(local(s.socket), 'ann', new Trust());
  const key = conn.cancelKey();
  await conn.query('VALUES 1');
  await conn.changeUser('bob', new Password(USERS.bob));
  assert.equal(conn.authorization, 'BOB');
  assert.equal(conn.setting('AUTHORIZATION'), 'BOB');
  assert.notDeepEqual(conn.cancelKey(), key, 'a new cancel key');
  assert.deepEqual(conn.granted, Offer.default().capabilities, 'the same capabilities');
  assert.deepEqual(
    conn.takeNotices().map((n) => n.sqlstate),
    ['01T01'],
  );
  assert.equal(conn.inTransaction, false);
  await conn.changeUser('ann', new Trust());
  assert.equal(conn.authorization, 'ANN');
  await assert.rejects(conn.changeUser('bob', new Password('wrong')), (e: unknown) => {
    assert.ok(isFailure(-919, '28000')(e));
    return (e as { diagnostics?: { severity?: string } }).diagnostics?.severity === 'FATAL';
  });
  assert.equal(conn.isLost, true);
});

/** Verifies: [CLIENT Controlling the session] query attributes are carried by every later statement, until set again. */
test('query attributes', async (t) => {
  if (live(t) === undefined) return;
  const conn = await ann();
  const read = "VALUES QUERY_ATTRIBUTE('app')";
  conn.setQueryAttributes([['app', 'reports']]);
  assert.deepEqual(rowsOf(await conn.query(read)), [['reports']]);
  const prepared = await conn.prepare(read);
  assert.deepEqual(rowsOf(await conn.execute(prepared)), [['reports']], 'an Execute too');
  conn.setQueryAttributes([]);
  assert.deepEqual(rowsOf(await conn.query(read)), [[null]]);
  await conn.terminate();
});

/** Verifies: [CLIENT XML values] an XML value read as its serialization and parsed for its nodes; a parameter made of its text; one with no serialization fails the fetch (2200W). */
test('XML values', async (t) => {
  if (live(t) === undefined) return;
  const conn = await ann();
  await conn.query('CREATE TABLE ORDERS (ID INTEGER, BODY XML)');
  const insert = await conn.prepare('INSERT INTO ORDERS VALUES (?, ?)');
  await conn.execute(insert, [18n, new Xml('<order no="18"><item>jam</item></order>')]);
  const [[body] = []] = rowsOf(await conn.query('SELECT BODY FROM ORDERS WHERE ID = 18'));
  assert.ok(body instanceof Xml);
  assert.equal(body.text, '<order no="18"><item>jam</item></order>');
  const [order] = body.nodes();
  assert.equal(order?.kind === 'element' && order.attributes[0]?.value, '18');
  await assert.rejects(
    conn.query(
      `SELECT XMLQUERY('$b/order/@no' PASSING BY VALUE BODY AS "b" RETURNING SEQUENCE NULL ON EMPTY) FROM ORDERS`,
    ),
    isFailure(-301, '2200W'),
  );
  await conn.query('ROLLBACK');
  await conn.terminate();
});

/** Verifies: [CLIENT UUIDs] a UUID read as its octets and text; a parameter made of its octets or its text. */
test('UUIDs', async (t) => {
  if (live(t) === undefined) return;
  const conn = await ann();
  await conn.query('CREATE TABLE TICKETS (ID UUID, SEAT VARCHAR(4))');
  const insert = await conn.prepare('INSERT INTO TICKETS VALUES (?, ?)');
  const text = '919108f7-52d1-4320-9bac-f847db4148a8';
  await conn.execute(insert, [Uuid.parse(text), '12A']);
  await conn.execute(insert, [new Uuid(new Uint8Array(16).fill(0xab)), '12B']);
  const rows = rowsOf(await conn.query('SELECT ID FROM TICKETS ORDER BY SEAT'));
  const [[first] = [], [second] = []] = rows;
  assert.ok(first instanceof Uuid && second instanceof Uuid);
  assert.equal(String(first), text);
  assert.deepEqual(second.octets, new Uint8Array(16).fill(0xab));
  await conn.query('ROLLBACK');
  await conn.terminate();
});

/**
 * The names of the Statuses a raw connection receives before the reply that ends `request`'s replies.
 *
 * @param frames - the connection's frames
 * @param request - the request, sent first
 * @param ends - the kind of the reply that ends them
 * @returns the names, in order
 */
async function statusesOf(frames: FrameStream, request: Request, ends: Reply['kind']): Promise<string[]> {
  await frames.write(encodeRequest(request), 5000);
  const names: string[] = [];
  for (;;) {
    const frame = await frames.next(MAX_BODY, 5000);
    const reply = decodeReply(frame.kind, frame.body);
    if (reply.kind === 'status' && reply.name === 'CATALOG') assert.notEqual(reply.value, '', 'CATALOG never empty');
    if (reply.kind === 'status') names.push(reply.name);
    else if (reply.kind === ends) return names;
    else if (reply.kind === 'error') throw reply.failure;
  }
}

/** The names of the page's table, in its order. */
const TABLE = ['SERVER_VERSION', 'AUTHORIZATION', 'SCHEMA', 'READ_ONLY', 'SERVER_READ_ONLY', 'CATALOG', 'OWNER'];

/** Verifies: [PROTOCOL Status 'T'] at login and after Reset one of each name of the table, in its order, then the session's settings; after a statement only what it changed; CATALOG never empty. */
test('statuses in their order', async (t) => {
  if (live(t) === undefined) return;
  const { socket } = await open(tcp('127.0.0.1', PORT), 5000);
  const frames = new FrameStream(socket);
  const hello: Request = {
    kind: 'hello',
    version: 1,
    user: 'ann',
    mechanism: 'trust',
    initial: new Uint8Array(0),
    capabilities: Offer.default().capabilities,
    attributes: [],
  };
  const login = await statusesOf(frames, hello, 'ready');
  assert.deepEqual(login.slice(0, TABLE.length), TABLE);
  assert.ok(login.includes('SESSION.TIME_ZONE') && login.includes('TRANSACTION.ISOLATION'));
  const query = (sql: string): Request => ({ kind: 'query', sql, ends: true, attributes: [], multi: false });
  assert.deepEqual(await statusesOf(frames, query('VALUES 1'), 'complete'), [], 'a statement that changed nothing');
  const zone = "SET TIME ZONE INTERVAL '+02:00' HOUR TO MINUTE";
  assert.deepEqual(await statusesOf(frames, query(zone), 'complete'), ['SESSION.TIME_ZONE']);
  const reset = await statusesOf(frames, { kind: 'reset' }, 'complete');
  assert.deepEqual(reset, login, 'every name again, in the same order');
  frames.destroy();
});

/**
 * The kinds of the replies to `request`, up to the one of kind `ends`, or an Error.
 *
 * @param frames - the connection's frames
 * @param request - the request
 * @param ends - the kind of its last reply
 * @returns each reply's kind, in order
 */
async function kindsOf(frames: FrameStream, request: Request, ends: Reply['kind']): Promise<Reply['kind'][]> {
  await frames.write(encodeRequest(request), 5000);
  const kinds: Reply['kind'][] = [];
  for (;;) {
    const frame = await frames.next(MAX_BODY, 5000);
    const { kind } = decodeReply(frame.kind, frame.body);
    kinds.push(kind);
    if (kind === ends || kind === 'error') return kinds;
  }
}

/** Verifies: [PROTOCOL Query 'Q'] a query that fails before its first batch is sent is answered by its Error alone, with no Description or Rows, and the driver gives no columns, the connection going on. */
test('a query failing at its first batch has no columns', async (t) => {
  if (live(t) === undefined) return;
  const conn = await ann();
  await conn.query('CREATE TABLE ODD (N INTEGER)');
  await conn.query('INSERT INTO ODD VALUES (0)');
  await conn.query('COMMIT');
  const seen: string[] = [];
  const sink = {
    columns: (): void => {
      seen.push('columns');
    },
    rows: (): void => {
      seen.push('rows');
    },
  };
  await assert.rejects(conn.queryInto('SELECT 1/N FROM ODD', sink), isFailure(-301, '22012'));
  assert.deepEqual(seen, [], 'no columns, no rows');
  await assert.rejects(conn.query('SELECT 1/N FROM ODD'), isFailure(-301, '22012'));
  assert.equal(conn.isLost, false);
  const { socket } = await open(tcp('127.0.0.1', PORT), 5000);
  const frames = new FrameStream(socket);
  const hello: Request = {
    kind: 'hello',
    version: 1,
    user: 'ann',
    mechanism: 'trust',
    initial: new Uint8Array(0),
    capabilities: [],
    attributes: [],
  };
  assert.equal((await kindsOf(frames, hello, 'ready')).at(-1), 'ready');
  const query: Request = { kind: 'query', sql: 'SELECT 1/N FROM ODD', ends: true, attributes: [], multi: false };
  assert.deepEqual(await kindsOf(frames, query, 'complete'), ['error'], 'its Error alone');
  frames.destroy();
  await conn.query('DROP TABLE ODD RESTRICT');
  await conn.query('COMMIT');
  await conn.terminate();
});
