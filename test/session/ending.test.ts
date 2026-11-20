/**
 * Tests of how a session ends and how its statement is cancelled, against
 * a scripted server on loopback (RULES.md R-TEST-1).
 */

import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createConnection } from 'node:net';
import { after, test } from 'node:test';

import { Trust } from '../../src/auth/mechanism.js';
import { writeFailure } from '../../src/codec/composite.js';
import { REQUEST } from '../../src/codec/kinds.js';
import { CANCEL_WITHIN, Canceller } from '../../src/session/cancel.js';
import { connectTo } from '../../src/session/connect.js';
import { Connection, TERMINATE_WITHIN } from '../../src/session/connection.js';
import type { OpenOptions } from '../../src/session/link.js';
import { FrameStream } from '../../src/transport/frames.js';
import { TurborelError } from '../../src/error.js';
import { tcp } from '../../src/transport/target.js';
import { type Peer, type Scripted, scripted } from '../support/fake-server.js';
import { isConnectionFailure, isFailure } from '../support/failures.js';

const servers: Scripted[] = [];

after(async () => {
  await Promise.all(servers.map((s) => s.close()));
});

/**
 * A server whose connections log in by trust, then run `then`.
 *
 * @param then - what follows the login
 * @returns the server
 */
async function server(then: (peer: Peer) => Promise<void>): Promise<Scripted> {
  const s = await scripted(async (peer) => {
    const first = await peer.frame();
    if (first.kind === REQUEST.CANCEL) {
      await then(Object.assign(peer, { cancel: first.body }));
      return;
    }
    peer.ready();
    await then(peer);
  });
  servers.push(s);
  return s;
}

/** Verifies: [CLIENT Connecting] Terminate waits for the server to close, at most the read timeout, else 60 seconds. */
test('terminate', async () => {
  assert.equal(TERMINATE_WITHIN, 60_000);
  const s = await server(async (peer) => {
    assert.equal((await peer.frame()).kind, REQUEST.TERMINATE);
    peer.end();
  });
  const conn = await connectTo(s.target, 'ann', new Trust());
  await conn.terminate();
  assert.equal(conn.isLost, true);
});

/** Verifies: [PROTOCOL Terminate 'X'] a commit that fails as the session ends is sent as an Error before the close, and given. */
test('terminate with a failing commit', async () => {
  const s = await server(async (peer) => {
    await peer.frame();
    peer.reply('N', (w) => w.string('01000').string('told first'));
    peer.end();
  });
  await (await connectTo(s.target, 'ann', new Trust())).terminate();
  const failing = await server(async (peer) => {
    await peer.frame();
    peer.reply('E', (w) => {
      writeFailure(w, new TurborelError(-913, '40002', 'a deferred constraint is not satisfied'));
    });
    peer.end();
  });
  await assert.rejects((await connectTo(failing.target, 'ann', new Trust())).terminate(), isFailure(-913, '40002'));
  const answering = await server(async (peer) => {
    await peer.frame();
    peer.reply('S');
    peer.end();
  });
  await assert.rejects((await connectTo(answering.target, 'ann', new Trust())).terminate(), isConnectionFailure);
});

/** Verifies: [CLIENT Connecting] a Notice and a Status before the Error that ends Terminate are read past, and the Error given. */
test('terminate reads past a notice to its error', async () => {
  const s = await server(async (peer) => {
    await peer.frame();
    peer.reply('N', (w) => w.string('01000').string('a warning'));
    peer.reply('T', (w) => w.string('SCHEMA').string('S'));
    peer.reply('E', (w) => {
      writeFailure(w, new TurborelError(-913, '40002', 'the commit failed'));
    });
    peer.end();
  });
  await assert.rejects((await connectTo(s.target, 'ann', new Trust())).terminate(), isFailure(-913, '40002'));
});

/**
 * Opens a connection over a socket of the program's own to `s`, given to `Connection.open`.
 *
 * @param s - the server
 * @param options - how it is opened
 * @returns the connection
 */
async function ownStream(s: Scripted, options: OpenOptions): Promise<Connection> {
  const target = s.target as { port: number };
  const socket = createConnection({ host: '127.0.0.1', port: target.port });
  await once(socket, 'connect');
  return Connection.open(new FrameStream(socket), 'ann', new Trust(), options);
}

/** Verifies: [CLIENT Timeouts] a stream of the program's own given to `open` within timeouts is bounded as they say, its read timeout settable as a connection's; Terminate on it waits at most that read timeout; opened unbounded, as its maker set it, Terminate waits as long as it must. */
test("a program's own stream is bounded as it is opened", async () => {
  const silent = await server(async (peer) => {
    await peer.frame();
    await peer.frame();
  });
  const bounded = await ownStream(silent, { timeouts: { connect: 1000, read: 50 } });
  assert.equal(bounded.readTimeout, 50);
  await assert.rejects(bounded.receive(), isConnectionFailure, 'a read past 50 ms');
  const set = await ownStream(silent, { timeouts: { connect: 1000, read: undefined } });
  set.setReadTimeout(50);
  const started = Date.now();
  await assert.rejects(set.terminate(), isConnectionFailure, 'Terminate past 50 ms');
  assert.ok(Date.now() - started < TERMINATE_WITHIN / 2);
  const late = await server(async (peer) => {
    await peer.frame();
    await new Promise((resolve) => setTimeout(resolve, 150));
    peer.end();
  });
  const unbounded = await ownStream(late, { timeouts: { connect: 1000, read: 50 }, boundedReads: false });
  await unbounded.terminate();
  assert.equal(unbounded.isLost, true);
});

/** Verifies: [CLIENT Connecting] a server that does not close after Terminate loses the connection once the read timeout runs out. */
test('terminate with no close', async () => {
  const s = await server(async (peer) => {
    await peer.frame();
  });
  const conn = await connectTo(s.target, 'ann', new Trust(), { timeouts: { connect: 1000, read: 50 } });
  await assert.rejects(conn.terminate(), isConnectionFailure);
});

/** Verifies: [PROTOCOL Cancel 'Z'] Cancel is the key Ready gave, the first and only message of a connection of its own, closed with no reply. */
test('cancel', async () => {
  const keys: Uint8Array[] = [];
  const s = await server(async (peer) => {
    const sent = (peer as Peer & { cancel?: Uint8Array }).cancel;
    if (sent === undefined) {
      await peer.frame();
      return;
    }
    keys.push(sent);
    peer.end();
  });
  const conn = await connectTo(s.target, 'ann', new Trust());
  const canceller = Canceller.of(conn);
  assert.ok(canceller !== undefined);
  await canceller.cancel();
  assert.deepEqual(keys, [new Uint8Array(16).fill(7)]);
  assert.equal(String(canceller), 'Canceller(..)');
  assert.equal(CANCEL_WITHIN, 10_000);
  conn.destroy();
});

/** Verifies: [CLIENT Running statements] a cancel gives up after its limit if the server does not close, or cannot be reached. */
test('a cancel gives up', async () => {
  const s = await server(async (peer) => {
    await peer.frame();
  });
  await assert.rejects(new Canceller(s.target, new Uint8Array(16)).cancel(50), isConnectionFailure);
  await assert.rejects(new Canceller(tcp('127.0.0.1', 9), new Uint8Array(16)).cancel(50), isConnectionFailure);
});
