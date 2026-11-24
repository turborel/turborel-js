/**
 * Tests of the routine debugger against a scripted server on loopback
 * (RULES.md R-TEST-1): Debug sent and answered, an Event kept wherever a
 * reply is read and never ending a request, and a wait bounded by its
 * timeout.
 */

import assert from 'node:assert/strict';
import { after, test } from 'node:test';

import { Trust } from '../../src/auth/mechanism.js';
import { type DebugEvent, type Paused, writeDebugged, writeEvent } from '../../src/codec/debug.js';
import { REQUEST } from '../../src/codec/kinds.js';
import { Reader } from '../../src/codec/reader.js';
import { DEBUGGER } from '../../src/session/capabilities.js';
import { connectTo } from '../../src/session/connect.js';
import type { Connection } from '../../src/session/connection.js';
import { type Peer, type Scripted, scripted } from '../support/fake-server.js';
import { isConnectionFailure, isFailure } from '../support/failures.js';

const servers: Scripted[] = [];
after(async () => {
  await Promise.all(servers.map((s) => s.close()));
});

/** A pause at breakpoint 1, of one frame of ANN.P at line 4. */
const PAUSED: Paused = {
  reason: 'breakpoint',
  breakpoint: 1,
  frames: [
    {
      origin: { kind: 'procedure', name: { schema: 'ANN', name: 'P_1' }, shown: { schema: 'ANN', name: 'P' } },
      visible: true,
      at: 40n,
      line: 4,
      column: 3,
      parameters: [{ name: 'PCT', dataType: 'INTEGER', value: 10n }],
      variables: [{ name: 'N', dataType: 'INTEGER', value: null }],
      cursors: [{ name: 'C', open: false, query: 'SELECT 1' }],
    },
    { visible: false, parameters: [], variables: [], cursors: [] },
  ],
};

/**
 * A connection, granted `granted`, to a server that answers as `then` does.
 *
 * @param then - what the server does after the login
 * @param granted - what it grants
 * @returns the connection
 */
async function connection(then: (peer: Peer) => Promise<void>, granted = [DEBUGGER]): Promise<Connection> {
  const s = await scripted(async (peer) => {
    await peer.frame();
    peer.ready(granted);
    await then(peer);
  });
  servers.push(s);
  return connectTo(s.target, 'ann', new Trust());
}

/**
 * Sends an Event.
 *
 * @param peer - the server's side
 * @param event - the event
 */
function event(peer: Peer, event: DebugEvent): void {
  peer.reply('W', (w) => {
    writeEvent(w, event);
  });
}

/** Verifies: [PROTOCOL Debug 'V'] [CLIENT Debugging routines] Debug asks, Debugged or a Complete answers: a connection's ID, a breakpoint, every breakpoint, the pause again; a refusal is the server's Error, the session kept. */
test('Debug answered', async () => {
  const asked: number[] = [];
  const conn = await connection(async (peer) => {
    for (;;) {
      const frame = await peer.frame();
      if (frame.kind !== REQUEST.DEBUG) return;
      const what = new Reader(frame.body, 'request').u8();
      asked.push(what);
      const answer = (d: Parameters<typeof writeDebugged>[1]): void => {
        peer.reply('V', (w) => {
          writeDebugged(w, d);
        });
      };
      if (what === 0) answer({ what: 'connection', id: 7n });
      else if (what === 3)
        answer({
          what: 'breakpoint',
          breakpoint: { number: 1, routine: { schema: 'ANN', name: 'P_1' }, line: 4, condition: 'PCT > 5' },
        });
      else if (what === 5) answer({ what: 'breakpoints', breakpoints: [] });
      else if (what === 8) answer({ what: 'stack', paused: PAUSED });
      else if (what === 6)
        peer.reply('E', (w) =>
          w.i32(-910).string('TBD01').string('it is not paused').flag(false).flag(false).flag(false),
        );
      else peer.complete();
    }
  });
  const debug = conn.debugger;
  assert.equal(conn.debugger, debug, 'one for each connection');
  assert.equal(await debug.id(), 7n);
  await debug.attach(7n);
  const set = await debug.break({ name: 'P' }, 4, { condition: 'PCT > 5' });
  assert.deepEqual([set.routine.name, set.condition], ['P_1', 'PCT > 5']);
  assert.deepEqual(await debug.breakpoints(), []);
  await debug.clear(1);
  assert.deepEqual(await debug.stack(), PAUSED);
  await assert.rejects(debug.resume('into'), isFailure(-910, 'TBD01'));
  assert.equal(conn.isLost, false);
  await debug.interrupt();
  await debug.detach();
  assert.deepEqual(asked, [0, 1, 3, 5, 4, 8, 6, 7, 2]);
  conn.destroy();
});

/** Verifies: [PROTOCOL Debug 'V'] Debug needs `debugger` granted: asked of a server that did not grant it, it is refused before it is sent, the connection kept. */
test('Debug needs debugger granted', async () => {
  const conn = await connection(async (peer) => {
    await peer.frame();
  }, []);
  await assert.rejects(conn.debugger.id(), isConnectionFailure);
  assert.equal(conn.isLost, false);
  conn.destroy();
});

/** Verifies: [PROTOCOL Event 'W'] [CLIENT Debugging routines] an Event read among a request's replies is kept for the next wait and ends no request; a wait gives each event in turn, a Notice taken on the way, and none once its timeout runs out, the connection kept; detaching drops those not read. */
test('events kept and waited for', async () => {
  let go: () => void = () => undefined;
  const later = new Promise<void>((resolve) => {
    go = resolve;
  });
  const conn = await connection(async (peer) => {
    await peer.frame();
    event(peer, { what: 'timedOut' });
    peer.complete();
    await later;
    peer.reply('N', (w) => w.string('01000').string('told'));
    event(peer, { what: 'paused', paused: PAUSED });
    await peer.frame();
    event(peer, { what: 'cancelled' });
    peer.complete();
    await peer.frame();
    peer.complete();
    await peer.frame();
  });
  await conn.debugger.attach(1n);
  const debug = conn.debugger;
  assert.deepEqual(await debug.wait(1000), { what: 'timedOut' }, 'kept from among the replies');
  assert.equal(await debug.wait(30), undefined, 'none in time');
  assert.equal(conn.isLost, false);
  go();
  assert.equal(await debug.wait(5000), undefined, 'a notice taken');
  assert.deepEqual(
    conn.takeNotices().map((n) => n.sqlstate),
    ['01000'],
  );
  assert.deepEqual(await debug.wait(5000), { what: 'paused', paused: PAUSED });
  await debug.resume();
  await debug.detach();
  assert.equal(await debug.wait(30), undefined, 'the event not read dropped');
  conn.destroy();
});

/** Verifies: [PROTOCOL Event 'W'] a wait answered by a reply to no request loses the connection; one answered by an Error gives it. */
test('a wait answered out of turn', async () => {
  const lost = await connection(async (peer) => {
    peer.complete();
    await peer.frame();
  });
  await assert.rejects(lost.debugger.wait(5000), isConnectionFailure);
  assert.equal(lost.isLost, true);
  const failed = await connection(async (peer) => {
    peer.reply('E', (w) => w.i32(-910).string('TBD01').string('no').flag(false).flag(false).flag(false));
    await peer.frame();
  });
  await assert.rejects(failed.debugger.wait(5000), isFailure(-910, 'TBD01'));
  failed.destroy();
});
