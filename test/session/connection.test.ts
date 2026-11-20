/**
 * Tests of a connection against a scripted server on loopback: the login,
 * what is asked for and granted, what the server tells, and how a
 * connection is lost (RULES.md R-TEST-1).
 */

import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { inspect } from 'node:util';

import { Password, Trust } from '../../src/auth/mechanism.js';
import { Scram } from '../../src/auth/scram.js';
import { Reader } from '../../src/codec/reader.js';
import type { Writer } from '../../src/codec/writer.js';
import { REQUEST } from '../../src/codec/kinds.js';
import { writeFailure } from '../../src/codec/composite.js';
import { ALL_CAPABILITIES, COMPRESSION, PING } from '../../src/session/capabilities.js';
import { connectTo } from '../../src/session/connect.js';
import { DEFAULT_TIMEOUTS, endsConnection } from '../../src/session/connection.js';
import { KEPT_NOTICES, Offer } from '../../src/session/told.js';
import { TurborelError } from '../../src/error.js';
import { tcp } from '../../src/transport/target.js';
import { type Peer, type Scripted, scripted } from '../support/fake-server.js';
import { isConnectionFailure, isFailure } from '../support/failures.js';

const servers: Scripted[] = [];

after(async () => {
  await Promise.all(servers.map((s) => s.close()));
});

/**
 * A scripted server, closed after the tests.
 *
 * @param script - what each connection is answered with
 * @param at - TCP or a local socket
 * @returns the server
 */
async function server(script: (peer: Peer) => Promise<void>, at: 'tcp' | 'local' = 'tcp'): Promise<Scripted> {
  const s = await scripted(script, at);
  servers.push(s);
  return s;
}

/**
 * The Hello a peer receives first, read.
 *
 * @param peer - the peer
 * @returns its fields
 */
async function hello(
  peer: Peer,
): Promise<{ user: string; mechanism: string; capabilities: string[]; attributes: string[][] }> {
  const frame = await peer.frame();
  assert.equal(frame.kind, REQUEST.HELLO);
  const r = new Reader(frame.body, 'request');
  assert.equal(r.u32(), 1, 'version 1');
  const [user, mechanism] = [r.string(), r.string()];
  r.bytesField();
  const capabilities = r.strings();
  const attributes = r.atEnd() ? [] : (r.u8(), r.list((x) => [x.string(), x.string()]));
  return { user, mechanism, capabilities, attributes };
}

/** Verifies: [PROTOCOL Opening a connection] Hello names version 1, the user, the mechanism; Statuses then Ready; the capabilities granted in the table's order. */
test('a login by trust', async () => {
  let asked: Awaited<ReturnType<typeof hello>> | undefined;
  const s = await server(async (peer) => {
    asked = await hello(peer);
    peer.reply('T', (w) => w.string('AUTHORIZATION').string('ANN'));
    peer.reply('T', (w) => w.string('SESSION.TIME_ZONE').string('+00:00'));
    peer.ready(['ping', 'notices', 'no-such']);
  });
  const conn = await connectTo(s.target, 'ann', new Trust());
  assert.deepEqual([asked?.user, asked?.mechanism], ['ann', 'trust']);
  assert.deepEqual(
    asked?.capabilities,
    ALL_CAPABILITIES.filter((c) => c !== COMPRESSION),
    'every capability but compression',
  );
  assert.deepEqual([conn.authorization, conn.server], ['ANN', 'turborel 0.0.0 (alpha)']);
  assert.deepEqual(conn.granted, ['notices', 'ping'], "Ready's names, in the table's order, an unknown one left out");
  assert.equal(conn.has(PING), true);
  assert.equal(conn.setting('SESSION.TIME_ZONE'), '+00:00');
  assert.deepEqual([...conn.settings().keys()], ['AUTHORIZATION', 'SESSION.TIME_ZONE']);
  assert.equal(conn.cancelKey()?.byteLength, 16);
  assert.equal(String(conn), 'Connection(ANN)');
  conn.destroy();
  assert.equal(conn.isLost, true);
});

/** Verifies: [CLIENT What a connection asks for] an offer of none, of compression, and of connection attributes, which Hello carries as its tail. */
test('what a connection asks for', async () => {
  const seen: Awaited<ReturnType<typeof hello>>[] = [];
  const s = await server(async (peer) => {
    seen.push(await hello(peer));
    peer.ready();
  });
  (await connectTo(s.target, 'ann', new Trust(), { offer: Offer.none() })).destroy();
  const offer = Offer.none().compressed().compressed().attribute('application', 'reports').compressingFrom(10);
  (await connectTo(s.target, 'ann', new Trust(), { offer })).destroy();
  const [none, compressed] = seen;
  assert.deepEqual(none?.capabilities, []);
  assert.deepEqual([compressed?.capabilities, compressed?.attributes], [['compression'], [['application', 'reports']]]);
  assert.deepEqual(Offer.default().capabilities.length, ALL_CAPABILITIES.length - 1);
});

/** Verifies: [PROTOCOL Opening a connection] each Challenge answered by an Answer until Ready; a refusal is the server's Error, the connection closed. */
test('challenges, and a refusal', async () => {
  const s = await server(async (peer) => {
    const { user } = await hello(peer);
    if (user === 'bob') {
      peer.reply('E', (w) => {
        writeFailure(w, new TurborelError(-919, '28000', 'the user or the password is wrong'));
      });
      peer.end();
      return;
    }
    peer.reply('C', (w) => w.bytes(Uint8Array.of(1)));
    const answer = await peer.frame();
    assert.equal(answer.kind, REQUEST.ANSWER);
    peer.ready();
  });
  const answering = {
    name: 'test',
    secret: false,
    initial: () => new Uint8Array(0),
    answer: (c: Uint8Array) => Promise.resolve(Uint8Array.of(c[0] ?? 0, 2)),
    ready: () => undefined,
    bind: () => undefined,
    refused: () => undefined,
  };
  (await connectTo(s.target, 'ann', answering)).destroy();
  await assert.rejects(connectTo(s.target, 'bob', new Trust()), isFailure(-919, '28000'));
  await assert.rejects(
    connectTo(s.target, 'ann', new Trust()),
    isConnectionFailure,
    'trust has no answer to a challenge',
  );
});

/** Verifies: [PROTOCOL Opening a connection] a reply other than Challenge, Ready or Error before Ready loses the connection. */
test('no Ready', async () => {
  const s = await server(async (peer) => {
    await hello(peer);
    peer.reply('G');
  });
  await assert.rejects(connectTo(s.target, 'ann', new Trust()), isConnectionFailure);
});

/** Verifies: [CLIENT Connecting] a password, or SCRAM, is refused over plain TCP before anything is sent (SQLSTATE 28000). */
test('secrets over plain TCP', async () => {
  const nowhere = tcp('127.0.0.1', 9);
  await assert.rejects(connectTo(nowhere, 'ann', new Password('x')), isFailure(-919, '28000'));
  await assert.rejects(connectTo(nowhere, 'ann', new Scram('x')), isFailure(-919, '28000'));
  await assert.rejects(
    connectTo(nowhere, 'ann', new Trust()),
    isConnectionFailure,
    'trust connects, and finds nothing',
  );
  assert.equal(String(new Password('secret')), 'Password(..)');
});

/** Verifies: [PROTOCOL Capabilities] no request of a capability not granted is sent: it fails before anything is written. */
test('a request not granted is refused before it is sent', async () => {
  const kinds: number[] = [];
  const s = await server(async (peer) => {
    await hello(peer);
    peer.ready([]);
    kinds.push((await peer.frame()).kind);
    peer.reply('G');
  });
  const conn = await connectTo(s.target, 'ann', new Trust());
  await assert.rejects(conn.send({ kind: 'ping' }), isConnectionFailure);
  await assert.rejects(
    conn.send({ kind: 'query', sql: 'S', ends: false, attributes: [['a', 'b']], multi: false }),
    isConnectionFailure,
  );
  await assert.rejects(conn.send({ kind: 'fetch', statement: 1, cursor: 2, rows: 0 }), isConnectionFailure);
  await conn.send({ kind: 'query', sql: 'S', ends: false, attributes: [], multi: false });
  assert.equal(conn.isLost, false, 'refusing a request loses nothing');
  await conn.receive();
  conn.destroy();
  assert.deepEqual(kinds.slice(0, 1), [REQUEST.QUERY]);
});

/** Verifies: [PROTOCOL Compressed frames] once compression is granted, long requests go compressed and compressed replies are inflated; Ready is never compressed. */
test('compression, once granted', async () => {
  const s = await server(async (peer) => {
    await hello(peer);
    peer.ready(['compression']);
    const request = await peer.frame();
    assert.equal(request.kind, 0x7a, 'a long request goes compressed');
    peer.reply('z', (w) =>
      w
        .u8(0x47)
        .u32(0)
        .raw(Uint8Array.of(0x78, 0x9c, 0x03, 0x00, 0x00, 0x00, 0x00, 0x01)),
    );
  });
  const conn = await connectTo(s.target, 'ann', new Trust(), { offer: Offer.none().compressed() });
  await conn.send({ kind: 'query', sql: 'S'.repeat(5000), ends: false, attributes: [], multi: false });
  assert.deepEqual(await conn.receive(), { kind: 'pong' });
  conn.destroy();
  const early = await server(async (peer) => {
    await hello(peer);
    peer.reply('z', (w) =>
      w
        .u8(0x52)
        .u32(0)
        .raw(Uint8Array.of(0x78, 0x9c, 0x03, 0x00, 0x00, 0x00, 0x00, 0x01)),
    );
  });
  await assert.rejects(
    connectTo(early.target, 'ann', new Trust(), { offer: Offer.none().compressed() }),
    isConnectionFailure,
  );
});

/** Verifies: [CLIENT What the server tells] notices go to a handler, or the last 64 are kept; Statuses keep each setting as last told. */
test('notices and statuses', async () => {
  const s = await server(async (peer) => {
    await hello(peer);
    peer.ready(['notices', 'status']);
    await peer.frame();
    for (let i = 0; i <= KEPT_NOTICES; i += 1) peer.reply('N', (w) => w.string('01000').string(String(i)));
    peer.reply('T', (w) => w.string('SCHEMA').string('ANN'));
    peer.reply('N', (w) => w.string('01000').string('handled').u8(7).string('WARNING'));
    peer.reply('G');
  });
  const conn = await connectTo(s.target, 'ann', new Trust());
  const heard: string[] = [];
  await conn.send({ kind: 'query', sql: 'S', ends: false, attributes: [], multi: false });
  const first = conn.receive();
  await first;
  const kept = conn.takeNotices();
  assert.equal(kept.length, KEPT_NOTICES);
  assert.equal(kept[0]?.message, '2', 'the oldest dropped');
  assert.deepEqual(kept[KEPT_NOTICES - 1]?.diagnostics, { severity: 'WARNING' });
  assert.equal(conn.setting('SCHEMA'), 'ANN');
  conn.setNoticeHandler((n) => heard.push(n.message));
  conn.setNoticeHandler(undefined);
  assert.deepEqual(heard, []);
  conn.destroy();
});

/** Verifies: [PROTOCOL Error 'E'] an Error of class 08 but 08003, or of class 28 as the connection is made, ends the connection; others do not. */
test('which failures end the connection', () => {
  const failure = (sqlcode: number, sqlstate: string): TurborelError => new TurborelError(sqlcode, sqlstate, 'x');
  assert.equal(endsConnection(failure(-919, '08006')), true);
  assert.equal(endsConnection(failure(-919, '08004')), true);
  assert.equal(endsConnection(failure(-919, '08003')), false);
  assert.equal(endsConnection(failure(-919, '28000')), true);
  assert.equal(endsConnection(failure(-104, '28000')), false, "a statement's 28000 leaves it");
  assert.equal(endsConnection(failure(-103, '42000')), false);
});

/** Verifies: [CLIENT Timeouts] each step of the login waits at most the connect timeout, 30 seconds unless told; a wait that runs out loses the connection. */
test('the connect timeout', async () => {
  assert.deepEqual(DEFAULT_TIMEOUTS, { connect: 30_000, read: undefined });
  const s = await server(async (peer) => {
    await hello(peer);
  });
  await assert.rejects(
    connectTo(s.target, 'ann', new Trust(), { timeouts: { connect: 50, read: undefined } }),
    (e: unknown) => isConnectionFailure(e) && (e as Error).message.includes('did not answer in time'),
  );
});

/** Verifies: [CLIENT Timeouts] each read after the login waits at most the read timeout, none unless told, and the connection's may be changed. */
test('the read timeout', async () => {
  const s = await server(async (peer) => {
    await hello(peer);
    peer.ready();
  });
  const conn = await connectTo(s.target, 'ann', new Trust());
  assert.equal(conn.readTimeout, undefined);
  conn.setReadTimeout(50);
  assert.equal(conn.readTimeout, 50);
  await assert.rejects(conn.receive(), isConnectionFailure);
  assert.equal(conn.isLost, true);
  await assert.rejects(conn.receive(), isConnectionFailure, 'a lost connection takes no more');
});

/** Verifies: [CLIENT Timeouts] replies up to 16 MiB, or as many bytes as the program says; a longer one loses the connection. */
test('the longest reply taken', async () => {
  const s = await server(async (peer) => {
    await hello(peer);
    peer.ready();
    peer.reply('C', (w) => w.bytes(new Uint8Array(100)));
  });
  const conn = await connectTo(s.target, 'ann', new Trust());
  conn.setMaxBody(50);
  await assert.rejects(conn.receive(), isConnectionFailure);
});

/** Verifies: [PROTOCOL Frames] a connection closed within a reply, or by the server, loses the connection. */
test('a connection closed', async () => {
  const s = await server(async (peer) => {
    await hello(peer);
    peer.ready();
    peer.send(Uint8Array.of(0x47, 9, 0, 0, 0, 1));
    peer.end();
  });
  const conn = await connectTo(s.target, 'ann', new Trust());
  await assert.rejects(conn.receive(), isConnectionFailure);
  await assert.rejects(conn.send({ kind: 'ping' }), isConnectionFailure);
});

/** Verifies: [CLIENT Connecting] a connection over a Unix socket, or on Windows a named pipe. */
test('a local connection', async () => {
  const s = await server(async (peer) => {
    await hello(peer);
    peer.ready();
  }, 'local');
  const conn = await connectTo(s.target, 'ann', new Password('over a local socket'));
  assert.equal(conn.authorization, 'ANN');
  assert.equal(conn.target?.kind, 'local');
  conn.destroy();
});

/** Verifies: [PROTOCOL Ready 'R'] the cancel key is the client's secret: no display form of the connection shows it. */
test('the cancel key is kept secret', async () => {
  const s = await server(async (peer) => {
    await hello(peer);
    peer.ready();
  });
  const conn = await connectTo(s.target, 'ann', new Trust());
  const shown = `${String(conn)} ${inspect(conn, { showHidden: true, depth: 5 })}`;
  assert.equal(shown.includes('7, 7, 7'), false);
  const key = conn.cancelKey();
  key?.fill(0);
  assert.deepEqual(conn.cancelKey(), new Uint8Array(16).fill(7), 'a copy, which changes nothing of it');
  conn.destroy();
});

/** Verifies: [CLIENT Timeouts] a named pipe, on Windows, is bounded only as it is opened: its reads wait as long as they must. */
test('a named pipe is bounded only as it is opened', { skip: process.platform !== 'win32' }, async () => {
  const s = await server(async (peer) => {
    await hello(peer);
    peer.ready();
    await new Promise((resolve) => setTimeout(resolve, 200));
    peer.reply('G');
  }, 'local');
  const conn = await connectTo(s.target, 'ann', new Trust());
  conn.setReadTimeout(50);
  assert.deepEqual(await conn.receive(), { kind: 'pong' });
  conn.destroy();
});

/**
 * The octets of `n`, a `u32` little-endian.
 *
 * @param n - the number
 * @returns its four octets
 */
const u32le = (n: number): number[] => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, n >>> 24];

/** Writes a Complete of no data, the reply a statement after a failed one takes as its own. */
const noData = (w: Writer): void => {
  w.i32(100).string('02000').flag(false);
};

/**
 * Writes a Complete whose one condition is malformed, saying more replies follow if `more`.
 *
 * @param more - whether its tail carries tag 5
 * @param active - whether a transaction is active after it
 * @returns its writer
 */
const badCondition =
  (more: boolean, active = false) =>
  (w: Writer): void => {
    w.i32(0).string('00000').flag(active);
    if (more) w.u8(5);
    w.u8(17).u32(1).bytes(Uint8Array.of(0xff));
  };

/** A statement's replies, each its kind and body. */
type Replies = [string, (w: Writer) => void][];

/**
 * Writes Rows of one row of one value, `value` its octets.
 *
 * @param value - the value's octets, its tag first
 * @returns its writer
 */
const rowOf =
  (...value: number[]) =>
  (w: Writer): void => {
    w.u32(1).u32(1).raw(Uint8Array.from(value));
  };

/**
 * A query's replies: a Description of `columns`, then Rows of each of `rows`, then a Complete.
 *
 * @param rows - each row's one value
 * @param columns - writes the Description, of no columns by default
 * @returns the replies
 */
function queried(rows: number[][], columns: (w: Writer) => void = (w) => w.u32(0)): Replies {
  return [['D', columns], ...rows.map((v): [string, (w: Writer) => void] => ['B', rowOf(...v)]), ['K', noData]];
}

/** @returns each reply holding a value the driver cannot take: what it is, its statement's replies, and the SQLSTATE it fails with */
function badValues(): [string, Replies, string][] {
  let deep: number[] = [0];
  for (let i = 0; i < 129; i += 1) deep = [10, 1, 0, 0, 0, ...u32le(deep.length), 0, 0, 0, 0, ...deep];
  const units = (w: Writer): void => {
    w.u32(1).flag(true).string('C').u8(1).u32(1).u8(9).flag(false);
  };
  return [
    [
      'a truth byte of 2',
      queried([
        [14, 2],
        [14, 1],
      ]),
      'TB916',
    ],
    ['damaged JSON', queried([[25, 2, 0, 0, 0, 1, 12]]), 'TB916'],
    ['JSON too deep', queried([[25, ...u32le(deep.length + 1), 1, ...deep]]), '0A000'],
    ['a units byte of 9', queried([[14, 1]], units), 'TB916'],
    ['value tag 18', queried([[18]]), 'TB916'],
    ['value tag 19', queried([[19]]), 'TB916'],
    ['a malformed condition', [['K', badCondition(false)]], 'TB916'],
    [
      'a condition, more to come',
      [
        ['K', badCondition(true)],
        ['K', noData],
      ],
      'TB916',
    ],
  ];
}

/** Verifies: [PROTOCOL Values and fields] [CLIENT Running statements] a reply whose frame is whole but holds a value the driver cannot take, a truth byte not 0 or 1, damaged JSON, JSON nested past 128, a units byte not 0 or 1, value tags 18 and 19 or a malformed condition, fails its request alone with the value's error (TB916, or 0A000 past a limit), the rest of its replies read past, so the next request takes its own reply and the connection goes on. */
test('a reply value that cannot be taken fails its request alone', async () => {
  for (const [why, replies, sqlstate] of badValues()) {
    const s = await server(async (peer) => {
      await hello(peer);
      peer.ready();
      for (const [kind, body] of replies) peer.reply(kind, body);
      peer.reply('K', (w) => w.i32(100).string('02000').flag(false).u8(4).u64(9n));
    });
    const conn = await connectTo(s.target, 'ann', new Trust());
    // A Description that reads comes first; the reply holding the bad value fails.
    const failing = async (): Promise<void> => {
      for (;;) assert.equal((await conn.receive()).kind, 'description', why);
    };
    await assert.rejects(failing(), (e) => e instanceof TurborelError && e.sqlstate === sqlstate, why);
    assert.equal(conn.isLost, false, why);
    const own = await conn.receive();
    assert.ok(own.kind === 'complete' && own.completion.position === 9n, `${why}: the next request's own reply`);
    conn.destroy();
  }
});

/** Verifies: [PROTOCOL Values and fields] a request answered by one reply, as a Describe of a cursor, reads nothing past one holding a value that cannot be taken; a Complete whose condition cannot be read still tells whether a transaction is active. */
test('a bad value of a lone reply reads nothing past it', async () => {
  const s = await server(async (peer) => {
    await hello(peer);
    peer.ready();
    peer.reply('D', (w) => w.u32(1).flag(false).u8(1).u32(1).u8(9).flag(false));
    peer.reply('K', noData);
    peer.reply('K', badCondition(false, true));
  });
  const conn = await connectTo(s.target, 'ann', new Trust());
  await assert.rejects(conn.receive('one'), isFailure(-916, 'TB916'));
  const own = await conn.receive();
  assert.ok(own.kind === 'complete' && own.completion.sqlcode === 100, 'its own reply');
  await assert.rejects(conn.receive(), isFailure(-916, 'TB916'));
  assert.equal(conn.inTransaction, true, "as the Complete's head said");
  conn.destroy();
});

/** Verifies: [PROTOCOL Values and fields] a malformed frame loses the connection (08006): a large object's kind not 0 or 1, a flag not 0 or 1, bytes after its last field, a condition's count past what follows; and the next request is told so. */
test('a malformed frame loses the connection', async () => {
  const bad: [string, string, (w: Writer) => void][] = [
    ["a large object's kind of 2", 'B', (w) => w.u32(1).u32(1).u8(20).u8(2).bytes(new Uint8Array(0))],
    ['a flag of 2', 'K', (w) => w.i32(0).string('00000').u8(2)],
    ['a byte past its end', 'K', (w) => w.i32(0).string('00000').flag(false).u8(0)],
    ['the conditions cut short', 'K', (w) => w.i32(0).string('00000').flag(false).u8(17).u32(1).u32(4).u8(0)],
  ];
  for (const [why, kind, body] of bad) {
    const s = await server(async (peer) => {
      await hello(peer);
      peer.ready();
      peer.reply(kind, body);
      peer.reply('K', noData);
    });
    const conn = await connectTo(s.target, 'ann', new Trust());
    await assert.rejects(conn.receive(), isConnectionFailure, why);
    assert.equal(conn.isLost, true, why);
    await assert.rejects(conn.receive(), isConnectionFailure, `${why}: told so after`);
  }
});
