/**
 * Tests of the statements a connection runs, and of how it controls its
 * session, against a scripted server on loopback: the replies each
 * request takes, in their order, and those out of turn (RULES.md R-TEST-1).
 */

import assert from 'node:assert/strict';
import { after, test } from 'node:test';

import { type Mechanism, Trust } from '../../src/auth/mechanism.js';
import { Reader } from '../../src/codec/reader.js';
import { HEADER_BYTES } from '../../src/codec/frame.js';
import { type Request, encodeRequest } from '../../src/codec/requests.js';
import { type Column, writeColumn } from '../../src/codec/composite.js';
import { writeType } from '../../src/codec/types.js';
import { CURSORS, DESCRIBE, FETCH_ENDS, MULTI_STATEMENT, PING, RESET } from '../../src/session/capabilities.js';
import { connectTo } from '../../src/session/connect.js';
import type { Connection } from '../../src/session/connection.js';
import { TurborelError } from '../../src/error.js';
import { type Peer, type Scripted, scripted } from '../support/fake-server.js';
import { isConnectionFailure, isFailure } from '../support/failures.js';

const servers: Scripted[] = [];

after(async () => {
  await Promise.all(servers.map((s) => s.close()));
});

/** A column of an INTEGER. */
const ID: Column = { name: 'ID', type: { kind: 'varying', length: 10, units: 'characters' }, notNull: true };

/**
 * A connection to a server that grants `granted`, then runs `then`.
 *
 * @param granted - the capabilities it grants
 * @param then - what follows the login
 * @returns the connection
 */
async function connect(granted: readonly string[], then: (peer: Peer) => Promise<void>): Promise<Connection> {
  const s = await scripted(async (peer) => {
    await peer.frame();
    peer.ready(granted);
    await then(peer);
  });
  servers.push(s);
  return connectTo(s.target, 'ann', new Trust());
}

/**
 * The next request's kind, as its letter.
 *
 * @param peer - the peer
 * @returns its letter and body
 */
async function next(peer: Peer): Promise<{ letter: string; body: Uint8Array }> {
  const frame = await peer.frame();
  return { letter: String.fromCharCode(frame.kind), body: frame.body };
}

/**
 * The body of `request`, as a client sends it.
 *
 * @param request - the request
 * @returns its body, its header less
 */
function body(request: Request): Uint8Array {
  return encodeRequest(request).subarray(HEADER_BYTES);
}

/** Verifies: [PROTOCOL Query 'Q'] a query is answered by Description, Rows and Complete, another statement by Complete, a failure by Error. */
test('a query, a statement and a failure', async () => {
  const conn = await connect([], async (peer) => {
    await peer.frame();
    peer.description([ID]);
    peer.rows([['1']]);
    peer.rows([['2']]);
    peer.complete({ active: true });
    await peer.frame();
    peer.complete({ sqlcode: 100, sqlstate: '02000' });
    await peer.frame();
    peer.error(new TurborelError(-103, '42000', 'no such table', { position: 14n, rule: '§6.3 SR1' }));
    await peer.frame();
    peer.complete({ sqlstate: '01003', active: true });
  });
  assert.deepEqual(await conn.query('SELECT ID FROM T'), { kind: 'rows', columns: [ID], rows: [['1'], ['2']] });
  assert.equal(conn.inTransaction, true);
  const done = await conn.query('DELETE FROM T');
  assert.equal(done.kind === 'done' && done.completion.sqlstate, '02000');
  assert.equal(conn.inTransaction, false);
  await assert.rejects(conn.query('SELECT * FROM NOPE'), (e: unknown) => {
    assert.ok(e instanceof TurborelError);
    assert.deepEqual(
      [e.sqlcode, e.sqlstate, e.message, e.rule, e.position],
      [-103, '42000', 'no such table', '§6.3 SR1', 14n],
    );
    return true;
  });
  assert.equal(conn.warning, undefined);
  await conn.query('SELECT SUM(X) FROM T');
  assert.equal(conn.warning, '01003');
  conn.destroy();
});

/** Verifies: [CLIENT Running statements] a query's rows are given to a sink a batch at a time, each awaited. */
test('rows given to a sink', async () => {
  const conn = await connect([], async (peer) => {
    await peer.frame();
    peer.description([ID]);
    peer.rows([['1'], ['2']]);
    peer.rows([['3']]);
    peer.complete();
    await peer.frame();
    peer.complete();
    await peer.frame();
    peer.description([ID]);
    peer.error(new TurborelError(-305, '22012', 'division by zero'));
  });
  const seen: unknown[] = [];
  const sink = {
    columns: (columns: readonly unknown[]): void => {
      seen.push(columns.length);
    },
    rows: async (rows: readonly unknown[]): Promise<void> => {
      await Promise.resolve();
      seen.push(rows.length);
    },
  };
  assert.deepEqual(await conn.queryInto('SELECT ID FROM T', sink), { kind: 'rows', count: 3 });
  assert.deepEqual(seen, [1, 2, 1]);
  assert.equal((await conn.queryInto('COMMIT', sink)).kind, 'done');
  await assert.rejects(conn.queryInto('SELECT 1/0 FROM T', sink), isFailure(-305, '22012'));
  conn.destroy();
});

/** Verifies: [PROTOCOL Query 'Q'] with tag 2, each statement's replies in turn, tag 5 on each Complete but the last; the first failure ends them. */
test('several statements in one request', async () => {
  const conn = await connect([MULTI_STATEMENT], async (peer) => {
    await peer.frame();
    peer.complete({ more: true });
    peer.description([ID]);
    peer.rows([['7']]);
    peer.complete({ more: true });
    peer.complete();
    await peer.frame();
    peer.complete({ more: true });
    peer.error(new TurborelError(-803, '23505', 'a duplicate key'));
    await peer.frame();
    peer.complete({ more: true });
    peer.end();
  });
  const ran = await conn.queryMany('INSERT INTO T VALUES (7); SELECT ID FROM T; COMMIT');
  assert.deepEqual(
    ran.outcomes.map((o) => o.kind),
    ['done', 'rows', 'done'],
  );
  assert.deepEqual(ran.outcomes[1], { kind: 'rows', columns: [ID], rows: [['7']] });
  assert.equal(ran.failure, undefined);
  const stopped = await conn.queryMany('INSERT INTO T VALUES (7); INSERT INTO T VALUES (7); COMMIT');
  assert.equal(stopped.outcomes.length, 1);
  assert.equal(stopped.failure?.sqlstate, '23505');
  await assert.rejects(conn.queryMany('COMMIT; COMMIT'), isConnectionFailure, 'lost within');
});

/** Verifies: [PROTOCOL Execute 'E'] a prepared query's rows come with no Description, then Complete; another statement's Complete; the values sent. */
test('prepare and execute', async () => {
  const sent: Uint8Array[] = [];
  const conn = await connect([], async (peer) => {
    assert.equal((await next(peer)).letter, 'P');
    peer.reply('P', (w) => {
      w.u32(0).u32(1).flag(false);
      writeType(w, ID.type);
      w.u32(1);
      writeColumn(w, ID);
    });
    for (let i = 0; i < 2; i += 1) {
      sent.push((await next(peer)).body);
      peer.rows([[String(i)]]);
      peer.complete();
    }
    await next(peer);
    peer.reply('P', (w) => w.u32(1).u32(0).u32(0));
    await next(peer);
    peer.complete({ active: true });
    await next(peer);
    peer.complete();
  });
  const byId = await conn.prepare('SELECT ID FROM T WHERE ID = ?');
  assert.deepEqual([byId.number, byId.parameters.length, byId.columns], [0, 1, [ID]]);
  assert.deepEqual(await conn.execute(byId, ['1']), { kind: 'rows', columns: [ID], rows: [['0']] });
  assert.deepEqual(await conn.execute(byId, ['2']), { kind: 'rows', columns: [ID], rows: [['1']] });
  const execute = { kind: 'execute', statement: 0, cursor: 0, rows: 0, ends: false, attributes: [] } as const;
  assert.deepEqual(sent, [body({ ...execute, values: ['1'] }), body({ ...execute, values: ['2'] })]);
  const insert = await conn.prepare('INSERT INTO T VALUES (1)');
  assert.equal(insert.number, 1);
  assert.equal((await conn.execute(insert)).kind, 'done');
  await conn.deallocate(insert);
  conn.destroy();
});

/** Verifies: [PROTOCOL Fetch 'F'] a cursor is opened with its first rows, Suspended while it has more, fetched until Complete, closed; numbered once `cursors` is granted. */
test('a cursor read in parts', async () => {
  const conn = await connect([CURSORS, DESCRIBE, FETCH_ENDS], async (peer) => {
    await next(peer);
    peer.reply('P', (w) => {
      w.u32(0).u32(0).u32(1);
      writeColumn(w, ID);
    });
    const opened = (await next(peer)).body;
    const ends = { kind: 'execute', statement: 0, cursor: 2, values: [], rows: 1, ends: true, attributes: [] } as const;
    assert.deepEqual(opened, body(ends), 'cursor 2, a row, ended under autocommit with fetch-ends');
    peer.rows([['1']]);
    peer.reply('S');
    assert.equal((await next(peer)).letter, 'Y');
    peer.description([ID]);
    assert.equal((await next(peer)).letter, 'F');
    peer.rows([['2']]);
    peer.complete();
    assert.equal((await next(peer)).letter, 'C');
    peer.complete();
    assert.equal((await next(peer)).letter, 'Y');
    peer.reply('P', (w) => w.u32(0).u32(0).u32(0));
  });
  conn.setAutocommit(true);
  assert.equal(conn.autocommit, true);
  const all = await conn.prepare('SELECT ID FROM T');
  assert.deepEqual(await conn.openCursor(all, [], { rows: 1, cursor: 2 }), { rows: [['1']], more: true });
  assert.deepEqual(await conn.describeCursor(all, 2), [ID]);
  assert.deepEqual(await conn.fetch(all, { cursor: 2 }), { rows: [['2']], more: false });
  await conn.close(all, 2);
  assert.deepEqual((await conn.describe(all)).columns, []);
  conn.destroy();
});

/** Verifies: [PROTOCOL Capabilities] a request whose capability was not granted fails before it is sent: a numbered cursor, describe, ping, reset, several statements, query attributes. */
test('capabilities not granted', async () => {
  const conn = await connect([], async (peer) => {
    await next(peer);
    peer.reply('P', (w) => w.u32(0).u32(0).u32(0));
  });
  const s = await conn.prepare('VALUES 1');
  const refused = [
    conn.openCursor(s, [], { cursor: 1 }),
    conn.fetch(s, { cursor: 1 }),
    conn.close(s, 1),
    conn.describe(s),
    conn.describeCursor(s),
    conn.ping(),
    conn.reset(),
    conn.queryMany('VALUES 1; VALUES 2'),
    conn.changeUser('bob', new Trust()),
  ];
  for (const r of refused) await assert.rejects(r, isConnectionFailure);
  assert.throws(() => {
    conn.setQueryAttributes([['traceparent', 'x']]);
  }, isConnectionFailure);
  conn.setQueryAttributes([]);
  assert.equal(conn.isLost, false, 'refused, not lost');
  conn.destroy();
});

/** Verifies: [PROTOCOL Ping 'G'] [PROTOCOL Reset 'W'] Ping is answered by Pong; Reset by its Notice, Statuses and a Complete saying no transaction is active. */
test('ping and reset', async () => {
  const conn = await connect([PING, RESET], async (peer) => {
    assert.equal((await next(peer)).letter, 'G');
    peer.reply('G');
    assert.equal((await next(peer)).letter, 'W');
    peer.reply('N', (w) => w.string('01T01').string('the transaction was rolled back'));
    peer.reply('T', (w) => w.string('SCHEMA').string('ANN'));
    peer.complete();
    await next(peer);
    peer.complete();
  });
  await conn.ping();
  await conn.reset();
  assert.deepEqual(
    conn.takeNotices().map((n) => n.sqlstate),
    ['01T01'],
  );
  assert.equal(conn.setting('SCHEMA'), 'ANN');
  await assert.rejects(conn.ping(), isConnectionFailure, 'a Complete for a Pong loses the connection');
  assert.equal(conn.isLost, true);
});

/** A mechanism that answers each challenge with its bytes reversed. */
const MIRROR: Mechanism = {
  name: 'mirror',
  secret: false,
  initial: () => Uint8Array.of(1),
  answer: (challenge) => Promise.resolve(challenge.slice().reverse()),
  ready: () => undefined,
  bind: () => undefined,
  refused: () => undefined,
};

/** Verifies: [PROTOCOL ChangeUser 'U'] ChangeUser is answered by the Challenge and Answer steps, then Ready: the session's new user and cancel key; a refusal fails it. */
test('change user', async () => {
  const conn = await connect(['change-user'], async (peer) => {
    await next(peer);
    peer.complete({ active: true });
    const asked = new Reader((await next(peer)).body, 'request');
    assert.deepEqual([asked.string(), asked.string()], ['bob', 'mirror']);
    peer.reply('C', (w) => w.bytes(Uint8Array.of(1, 2)));
    const answer = await next(peer);
    assert.deepEqual([answer.letter, [...new Reader(answer.body, 'request').bytesField()]], ['A', [2, 1]]);
    peer.ready(['change-user'], 'BOB');
    await next(peer);
    peer.error(new TurborelError(-919, '28000', 'credentials refused'));
    peer.end();
  });
  await conn.query('VALUES 1');
  assert.equal(conn.inTransaction, true);
  await conn.changeUser('bob', MIRROR);
  assert.equal(conn.authorization, 'BOB');
  assert.equal(conn.inTransaction, false, 'renewed as by a reset');
  await assert.rejects(conn.changeUser('carl', new Trust()), isFailure(-919, '28000'));
  assert.equal(conn.isLost, true, 'a refusal closes the connection');
});

/** Verifies: [PROTOCOL Errors and notices] TBR01, a replica behind, fails the statement and keeps the connection. */
test('a replica behind', async () => {
  const conn = await connect([], async (peer) => {
    await next(peer);
    peer.error(new TurborelError(-920, 'TBR01', 'the replica has not applied the position in time'));
    await next(peer);
    peer.complete();
  });
  await assert.rejects(conn.query('SELECT 1'), isFailure(-920, 'TBR01'));
  assert.equal(conn.isLost, false);
  assert.equal((await conn.query('COMMIT')).kind, 'done');
  conn.destroy();
});

/**
 * A connection whose server answers its first request with `answer`.
 *
 * @param answer - what the server sends
 * @returns the connection
 */
function answering(answer: (peer: Peer) => void): Promise<Connection> {
  return connect([MULTI_STATEMENT, 'change-user'], async (peer) => {
    await next(peer);
    answer(peer);
  });
}

/** Replies out of turn, and the requests they answer. */
const OUT_OF_TURN: [(peer: Peer) => void, (c: Connection) => Promise<unknown>][] = [
  [
    (peer) => {
      peer.reply('G');
    },
    (c) => c.query('SELECT 1'),
  ],
  [
    (peer) => {
      peer.description([ID]);
      peer.reply('G');
    },
    (c) => c.query('SELECT 1'),
  ],
  [
    (peer) => {
      peer.complete();
    },
    (c) => c.prepare('SELECT 1'),
  ],
  [
    (peer) => {
      peer.reply('G');
    },
    (c) => c.changeUser('bob', new Trust()),
  ],
  [
    (peer) => {
      peer.description([ID]);
      peer.reply('S');
    },
    (c) => c.queryMany('SELECT 1'),
  ],
  [
    (peer) => {
      peer.reply('S');
    },
    (c) => c.queryMany('SELECT 1'),
  ],
  [
    (peer) => {
      peer.reply('G');
    },
    (c) => c.queryInto('SELECT 1', { columns: () => undefined, rows: () => undefined }),
  ],
];

/** Verifies: [PROTOCOL Requests] a reply out of turn loses the connection. */
test('replies out of turn', async () => {
  for (const [answer, ask] of OUT_OF_TURN) {
    const conn = await answering(answer);
    await assert.rejects(ask(conn), isConnectionFailure);
    assert.equal(conn.isLost, true);
  }
});

/** Verifies: [PROTOCOL Requests] no request but Hello and Answer goes before Ready: a statement waits for the login. */
test('nothing before Ready', async () => {
  const seen: string[] = [];
  const s = await scripted(async (peer) => {
    seen.push((await next(peer)).letter);
    await new Promise((resolve) => setTimeout(resolve, 50));
    peer.ready();
    seen.push((await next(peer)).letter);
    peer.complete();
  });
  servers.push(s);
  const conn = await connectTo(s.target, 'ann', new Trust());
  await conn.query('COMMIT');
  assert.deepEqual(seen, ['H', 'Q']);
  conn.destroy();
});
