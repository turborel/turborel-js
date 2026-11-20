/**
 * Live tests of connecting, against the server TURBOREL_TEST_SERVER names
 * (RULES.md R-TEST-8): every transport and mechanism, what the server
 * grants and tells, refusals, the key cache, cancel and terminate.
 */

import assert from 'node:assert/strict';
import { connect as connectTls } from 'node:tls';
import { type TestContext, test } from 'node:test';

import { Certificate, Password, Trust } from '../../src/auth/mechanism.js';
import { KeyCache } from '../../src/auth/key-cache.js';
import { Scram } from '../../src/auth/scram.js';
import { decodeReply } from '../../src/codec/replies.js';
import { encodeRequest } from '../../src/codec/requests.js';
import { Canceller } from '../../src/session/cancel.js';
import * as cap from '../../src/session/capabilities.js';
import { connectTo } from '../../src/session/connect.js';
import { Connection } from '../../src/session/connection.js';
import { Offer } from '../../src/session/told.js';
import { channelOf } from '../../src/tls/channel.js';
import { config, presenting, roots, trusting } from '../../src/tls/config.js';
import { FrameStream } from '../../src/transport/frames.js';
import { type Target, local, open, overTls, tcp } from '../../src/transport/target.js';
import type { Live } from '../server/server.js';
import { PORT, USERS } from '../server/server.js';
import { isConnectionFailure, isFailure } from '../support/failures.js';
import { liveServer, run, server } from '../support/live.js';

liveServer();

/**
 * The live server, or the test skipped where none is named.
 *
 * @param t - the test
 * @returns the server, or undefined if skipped
 */
function live(t: TestContext): Live | undefined {
  if (server.live === undefined) t.skip(`set TURBOREL_TEST_SERVER to run the live tests`);
  return server.live;
}

const TCP = tcp('127.0.0.1', PORT);
const refused = isFailure(-919, '28000');

/**
 * The TLS target of the live server, trusting its test authority.
 *
 * @param s - the server
 * @param options - more of Node.js's TLS options
 * @returns the target
 */
function secure(s: Live, options: object = {}): Target {
  const trusted = trusting(s.pki.ca);
  return overTls('localhost', { ...trusted, options: { ...trusted.options, ...options } }, PORT);
}

/** Verifies: [PROTOCOL Opening a connection] over TCP, by trust: a Status of each session setting, then Ready, its capabilities in the table's order. */
test('a login by trust over TCP, and what the server tells', async (t) => {
  if (live(t) === undefined) return;
  const conn = await connectTo(TCP, 'ann', new Trust());
  assert.deepEqual([conn.authorization, conn.server], ['ANN', 'turborel 0.0.0 (alpha)']);
  assert.deepEqual(
    conn.granted,
    cap.ALL_CAPABILITIES.filter((c) => c !== cap.COMPRESSION),
  );
  for (const name of [
    cap.AUTHORIZATION,
    cap.SCHEMA,
    cap.READ_ONLY,
    cap.SERVER_VERSION,
    cap.SERVER_READ_ONLY,
    cap.CATALOG,
    cap.OWNER,
  ]) {
    assert.ok(conn.setting(name) !== undefined, name);
  }
  assert.deepEqual(
    [conn.setting(cap.AUTHORIZATION), conn.setting(cap.READ_ONLY), conn.setting(cap.OWNER)],
    ['ANN', 'NO', 'YES'],
  );
  assert.equal(conn.setting(cap.SERVER_READ_ONLY), 'NO');
  assert.ok(conn.setting('SESSION.TIME_ZONE') !== undefined && conn.setting('TRANSACTION.ISOLATION') !== undefined);
  await conn.terminate();
});

/** Verifies: [PROTOCOL Status 'T'] a statement that changes a setting is told, and Reset tells each setting again at its value at login. */
test('statuses after a statement and a reset', async (t) => {
  if (live(t) === undefined) return;
  const conn = await connectTo(TCP, 'ann', new Trust());
  const zone = conn.setting('SESSION.TIME_ZONE');
  await run(conn, "SET TIME ZONE INTERVAL '+05:00' HOUR TO MINUTE");
  assert.equal(conn.setting('SESSION.TIME_ZONE'), '+05:00');
  await conn.send({ kind: 'reset' });
  assert.equal((await conn.receive()).kind, 'complete');
  assert.equal(conn.setting('SESSION.TIME_ZONE'), zone);
  await conn.terminate();
});

/** Verifies: [CLIENT Connecting] over a Unix socket, or a named pipe, a password and SCRAM-SHA-256 are proved, the server's signature checked. */
test('a password and SCRAM over a local socket', async (t) => {
  const s = live(t);
  if (s === undefined) return;
  const byPassword = await connectTo(local(s.socket), 'bob', new Password(USERS.bob));
  assert.equal(byPassword.authorization, 'BOB');
  await byPassword.terminate();
  const byScram = await connectTo(local(s.socket), 'ann', new Scram(USERS.ann));
  assert.equal(byScram.authorization, 'ANN');
  await byScram.terminate();
  await assert.rejects(connectTo(local(s.socket), 'ann', new Scram('wrong')), refused);
  await assert.rejects(connectTo(local(s.socket), 'ann', new Password('wrong')), refused);
});

/** Verifies: [PROTOCOL Mechanisms] scram-sha-256-plus bound by tls-exporter over TLS 1.3, and by tls-server-end-point over TLS 1.2. */
test('SCRAM-SHA-256-PLUS over TLS', async (t) => {
  const s = live(t);
  if (s === undefined) return;
  const exporter = new Scram(USERS.ann, { channelBinding: 'require' });
  const tls13 = await connectTo(secure(s), 'ann', exporter);
  assert.equal(tls13.authorization, 'ANN');
  await tls13.terminate();
  const tls12 = await connectTo(
    secure(s, { maxVersion: 'TLSv1.2' }),
    'ann',
    new Scram(USERS.ann, { channelBinding: 'require' }),
  );
  assert.equal(tls12.authorization, 'ANN');
  await tls12.terminate();
  const byPassword = await connectTo(secure(s), 'bob', new Password(USERS.bob));
  assert.equal(byPassword.authorization, 'BOB');
  await byPassword.terminate();
});

/** Verifies: [CLIENT Connecting] a TLS stream the program opened, its channel bound before SCRAM-SHA-256-PLUS. */
test("a TLS stream of the program's", async (t) => {
  const s = live(t);
  if (s === undefined) return;
  const socket = connectTls({
    host: '127.0.0.1',
    port: PORT,
    servername: 'localhost',
    ca: trusting(s.pki.ca).options.ca,
  });
  await new Promise<void>((resolve, reject) => {
    socket.once('secureConnect', () => {
      resolve();
    });
    socket.once('error', reject);
  });
  const scram = new Scram(USERS.ann, { channelBinding: 'require' });
  scram.bind(channelOf(socket));
  const conn = await Connection.open(new FrameStream(socket), 'ann', scram);
  assert.equal(conn.authorization, 'ANN');
  assert.equal(Canceller.of(conn), undefined, 'its server cannot be reached again');
  await conn.terminate();
});

/** Verifies: [CLIENT Connecting] the mechanism certificate: TLS presenting a certificate chain and key, the user its common name names. */
test('a login by certificate', async (t) => {
  const s = live(t);
  if (s === undefined) return;
  const presented = presenting(s.pki.ca, { chain: s.pki.clientCert, key: s.pki.clientKey });
  const conn = await connectTo(overTls('localhost', presented, PORT), 'ann', new Certificate());
  assert.equal(conn.authorization, 'ANN');
  await conn.terminate();
  await assert.rejects(connectTo(overTls('localhost', presented, PORT), 'bob', new Certificate()), refused);
});

/** Verifies: [CLIENT Connecting] TLS trusts the authorities of a file, the platform's as SSL_CERT_FILE names them, or both; a server of no authority trusted fails. */
test("TLS trusts a file's authorities and the platform's", async (t) => {
  const s = live(t);
  if (s === undefined) return;
  const before = process.env['SSL_CERT_FILE'];
  try {
    process.env['SSL_CERT_FILE'] = s.pki.ca;
    const platform = overTls('localhost', config(roots(undefined, true)), PORT);
    await (await connectTo(platform, 'ann', new Scram(USERS.ann))).terminate();
    await (await connectTo(overTls('localhost', config(roots(s.pki.ca, true)), PORT), 'ann', new Trust())).terminate();
  } finally {
    if (before === undefined) delete process.env['SSL_CERT_FILE'];
    else process.env['SSL_CERT_FILE'] = before;
  }
  const untrusted = overTls('localhost', config(roots(s.pki.clientCert, false)), PORT);
  await assert.rejects(connectTo(untrusted, 'ann', new Trust()), isConnectionFailure);
  await assert.rejects(
    connectTo(overTls('127.0.0.2.invalid', trusting(s.pki.ca), PORT), 'ann', new Trust()),
    isConnectionFailure,
  );
});

/**
 * The first reply to a Hello sent over a raw connection.
 *
 * @param hello - the Hello's fields beyond its kind
 * @returns the reply
 */
async function firstReply(hello: {
  version: number;
  user: string;
  mechanism: string;
}): ReturnType<Connection['receive']> {
  const { socket } = await open(TCP, 5000);
  const stream = new FrameStream(socket);
  const request = { kind: 'hello' as const, initial: new Uint8Array(0), capabilities: [], attributes: [], ...hello };
  await stream.write(encodeRequest(request), 5000);
  const frame = await stream.next(16_777_216, 5000);
  stream.destroy();
  return decodeReply(frame.kind, frame.body);
}

/** Verifies: [PROTOCOL Opening a connection] a version other than 1 is refused (08004); a user name not an identifier, or a mechanism not served, before any exchange (28000). */
test('logins refused before any exchange', async (t) => {
  if (live(t) === undefined) return;
  const failureOf = async (hello: { version: number; user: string; mechanism: string }): Promise<string> => {
    const reply = await firstReply(hello);
    if (reply.kind !== 'error') throw new Error(`not refused: ${reply.kind}`);
    return reply.failure.sqlstate;
  };
  assert.equal(await failureOf({ version: 2, user: 'ann', mechanism: 'trust' }), '08004');
  assert.equal(await failureOf({ version: 1, user: 'not an identifier!', mechanism: 'trust' }), '28000');
  assert.equal(await failureOf({ version: 1, user: 'ann', mechanism: 'no-such' }), '28000');
  await assert.rejects(
    connectTo(TCP, 'ann', new Scram(USERS.ann, { inTheClear: true })),
    refused,
    'SCRAM_WITHOUT_TLS is OFF',
  );
});

/** Verifies: [PROTOCOL The Native Protocol] a client that asks for none sees the first form; Hello's attributes are read whether granted or not. */
test('the first form, and connection attributes', async (t) => {
  if (live(t) === undefined) return;
  const conn = await connectTo(TCP, 'ann', new Trust(), {
    offer: Offer.none().attribute('application', 'turborel-js live'),
  });
  assert.deepEqual(conn.granted, []);
  assert.equal(conn.settings().size, 0, 'no Status without status');
  const { rows, completion } = await run(
    conn,
    "SELECT ATTRIBUTE_VALUE FROM INFORMATION_SCHEMA.CONNECTION_ATTRIBUTES WHERE ATTRIBUTE_NAME = 'application'",
  );
  assert.deepEqual(rows, [['turborel-js live']]);
  assert.equal(completion.rows, undefined, 'no tag 6 of a capability not asked for');
  await conn.terminate();
});

/** Verifies: [PROTOCOL Compressed frames] compression asked for and granted: a long request and a long reply travel compressed. */
test('compression granted', async (t) => {
  if (live(t) === undefined) return;
  const conn = await connectTo(TCP, 'ann', new Trust(), { offer: Offer.default().compressed() });
  assert.ok(conn.has(cap.COMPRESSION));
  const long = 'x'.repeat(5000);
  const { rows } = await run(conn, `VALUES '${long}'`);
  assert.deepEqual(rows, [[long]]);
  await conn.terminate();
});

/** Verifies: [CLIENT The SCRAM key cache] a second login of the same password, salt and iterations takes the cached keys; a failed one drops them. */
test('the key cache across logins', async (t) => {
  const s = live(t);
  if (s === undefined) return;
  const cache = new KeyCache();
  await (await connectTo(local(s.socket), 'ann', new Scram(USERS.ann, { cache }))).terminate();
  await (await connectTo(local(s.socket), 'ann', new Scram(USERS.ann, { cache }))).terminate();
  assert.deepEqual(cache.lookups(), { hits: 1, misses: 1 });
  assert.equal(cache.size, 1);
  await assert.rejects(connectTo(local(s.socket), 'ann', new Scram('wrong', { cache })), refused);
  assert.equal(cache.size, 1, "a wrong password's keys are never kept");
});

/** Verifies: [PROTOCOL Cancel 'Z'] a statement cancelled over a connection of its own fails with SQLCODE -920, SQLSTATE TB920, and the session goes on. */
test('cancel', async (t) => {
  if (live(t) === undefined) return;
  const conn = await connectTo(TCP, 'ann', new Trust());
  await run(conn, 'CREATE TABLE CANCELLED (I INTEGER)');
  await run(conn, `INSERT INTO CANCELLED VALUES ${Array.from({ length: 300 }, (_, i) => `(${String(i)})`).join(', ')}`);
  const canceller = Canceller.of(conn);
  assert.ok(canceller !== undefined);
  const running = run(conn, 'SELECT COUNT(*) FROM CANCELLED A, CANCELLED B, CANCELLED C');
  const state = { done: false };
  running.then(
    () => (state.done = true),
    () => (state.done = true),
  );
  // Cancelled once it runs: a cancel before it does is of nothing.
  while (!state.done) await canceller.cancel();
  await assert.rejects(running, isFailure(-920, 'TB920'));
  assert.deepEqual((await run(conn, 'SELECT COUNT(*) FROM CANCELLED')).rows, [[300n]]);
  await conn.terminate();
});

/** Verifies: [PROTOCOL Terminate 'X'] Terminate ends the session as SESSION.COMMIT_AT_END says, and the server closes. */
test('terminate', async (t) => {
  if (live(t) === undefined) return;
  const conn = await connectTo(TCP, 'ann', new Trust());
  await run(conn, 'CREATE TABLE ENDED (I INTEGER)');
  await run(conn, 'INSERT INTO ENDED VALUES (1)', false);
  assert.equal(conn.inTransaction, true);
  await conn.terminate();
  assert.equal(conn.isLost, true);
  const after = await connectTo(TCP, 'ann', new Trust());
  const { rows } = await run(after, 'SELECT COUNT(*) FROM ENDED');
  assert.equal(rows.length, 1);
  await after.terminate();
});
