/**
 * Live tests of the routine debugger, against the server
 * TURBOREL_TEST_SERVER names (RULES.md R-TEST-8): one connection debugs
 * the session of another, attached by its ID, and the refusals that keep
 * the session.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Password } from '../../src/auth/mechanism.js';
import type { Frame } from '../../src/codec/debug.js';
import { textOf } from '../../src/codec/text.js';
import * as cap from '../../src/session/capabilities.js';
import { connectTo } from '../../src/session/connect.js';
import { local } from '../../src/transport/target.js';
import { USERS } from '../server/server.js';
import { isFailure } from '../support/failures.js';
import { ann, live, liveServer } from '../support/live.js';

liveServer();

/** The procedure debugged: its UPDATE at line 4, its SET at line 5. */
const RAISE_PAY = `CREATE PROCEDURE RAISE_PAY(IN PCT INTEGER) MODIFIES SQL DATA
BEGIN
  DECLARE N INTEGER DEFAULT 0;
  UPDATE PAID SET SALARY = SALARY * (100 + PCT) / 100;
  SET N = (SELECT COUNT(*) FROM PAID);
END`;

/** How long a wait for the target may take, in milliseconds. */
const WITHIN = 10_000;

/**
 * A frame's place, parameters and variables, as text.
 *
 * @param frame - the frame
 * @returns its routine's name, line, and each named value
 */
function shown(frame: Frame | undefined): string[] {
  if (frame === undefined) return [];
  const named = [...frame.parameters, ...frame.variables].map((n) => `${n.name} ${n.dataType} ${textOf(n.value)}`);
  return [`${frame.origin?.shown.name ?? ''} line ${String(frame.line)}`, ...named];
}

/** Verifies: [PROTOCOL Debug 'V'] [CLIENT Debugging routines] a debugger's connection attaches to another's session by its ID, sets a breakpoint, waits for the pause and reads its frames, steps over, continues to the end of the CALL, and detaches; a wait that runs out keeps the connection. */
test('a session debugged from another connection', async (t) => {
  if (live(t) === undefined) return;
  const target = await ann();
  const debuggerConn = await ann();
  assert.ok(debuggerConn.granted.includes(cap.DEBUGGER));
  await target.query('CREATE TABLE PAID (ID INTEGER PRIMARY KEY, SALARY INTEGER)');
  await target.query('INSERT INTO PAID VALUES (1, 50000), (2, 60000)');
  await target.query(RAISE_PAY);
  await target.query('COMMIT');
  const debug = debuggerConn.debugger;
  await debug.attach(await target.debugger.id());
  const set = await debug.break({ name: 'RAISE_PAY' }, 4);
  assert.deepEqual([set.number, set.routine.schema, set.line, set.condition], [1, 'ANN', 4, undefined]);
  assert.deepEqual(await debug.breakpoints(), [set]);
  assert.equal(await debug.wait(50), undefined, 'nothing yet');
  const call = target.query('CALL RAISE_PAY(10)');
  const paused = await debug.wait(WITHIN);
  assert.ok(paused?.what === 'paused');
  assert.deepEqual([paused.paused.reason, paused.paused.breakpoint], ['breakpoint', set.number]);
  assert.deepEqual(shown(paused.paused.frames.at(-1)), ['RAISE_PAY line 4', 'PCT INTEGER 10', 'N INTEGER 0']);
  assert.deepEqual(await debug.stack(), paused.paused, 'its pause read again');
  await debug.resume('over');
  const stepped = await debug.wait(WITHIN);
  assert.ok(stepped?.what === 'paused' && stepped.paused.reason === 'step');
  assert.deepEqual(shown(stepped.paused.frames.at(-1)).slice(0, 1), ['RAISE_PAY line 5']);
  await debug.resume('continue');
  assert.equal((await call).kind, 'done', 'the CALL completes once let go');
  assert.equal(await debug.stack(), undefined, 'running');
  await debug.clear(set.number);
  assert.deepEqual(await debug.breakpoints(), []);
  await debug.detach();
  await target.query('ROLLBACK');
  await target.query('DROP PROCEDURE RAISE_PAY RESTRICT');
  await target.query('DROP TABLE PAID RESTRICT');
  await target.query('COMMIT');
  await target.terminate();
  await debuggerConn.terminate();
});

/** Verifies: [PROTOCOL Debug 'V'] a connection of an ID not served is refused with 08003, a breakpoint in a routine its user may not debug with 42000 (SQLCODE -104), an action the target's state does not allow with TBD01 (SQLCODE -910), and the session goes on after each. */
test('a debugger refused keeps its session', async (t) => {
  const server = live(t);
  if (server === undefined) return;
  const owner = await ann();
  await owner.query('CREATE TABLE PAID (ID INTEGER PRIMARY KEY, SALARY INTEGER)');
  await owner.query(RAISE_PAY);
  await owner.query('COMMIT');
  const bob = await connectTo(local(server.socket), 'bob', new Password(USERS.bob));
  const bobTarget = await connectTo(local(server.socket), 'bob', new Password(USERS.bob));
  const debug = bob.debugger;
  await assert.rejects(debug.resume(), isFailure(-910, 'TBD01'), 'attached to none');
  await assert.rejects(debug.attach(999_999n), isFailure(-919, '08003'), 'no such connection');
  await debug.attach(await bobTarget.debugger.id());
  await assert.rejects(debug.attach(await bobTarget.debugger.id()), isFailure(-910, 'TBD01'), 'a second attach');
  await assert.rejects(
    debug.break({ schema: 'ANN', name: 'RAISE_PAY' }, 4),
    isFailure(-104, '42000'),
    'not its to debug',
  );
  await assert.rejects(debug.resume('over'), isFailure(-910, 'TBD01'), 'not paused');
  assert.equal(bob.isLost, false);
  assert.deepEqual(await debug.breakpoints(), []);
  await debug.detach();
  await bob.terminate();
  await bobTarget.terminate();
  await owner.query('DROP PROCEDURE RAISE_PAY RESTRICT');
  await owner.query('DROP TABLE PAID RESTRICT');
  await owner.query('COMMIT');
  await owner.terminate();
});
