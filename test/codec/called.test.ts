/**
 * Tests of the parameter modes of `[PROTOCOL Parameter modes]`: tail 20 of
 * Prepared, read and written, and the `?`s a statement tells with it or
 * without it.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { type Called, dynamicParameters, writeCalled } from '../../src/codec/called.js';
import { type Parameter, writeParameter } from '../../src/codec/composite.js';
import { writeColumns } from '../../src/codec/declared.js';
import { decodeReply } from '../../src/codec/replies.js';
import { Writer } from '../../src/codec/writer.js';
import { ALL_CAPABILITIES, PARAMETER_MODES } from '../../src/session/capabilities.js';
import { Offer } from '../../src/session/told.js';
import { isConnectionFailure } from '../support/failures.js';

/** An INTEGER parameter, as its tag writes it. */
const INTEGER: Parameter = { varying: false, type: { kind: 'exact', precision: 10, scale: 0 } };

/** A CALL's `?`s: an IN of parameter 1, two of one IN argument as the second's, an INOUT and an OUT. */
const CALLED: Called = {
  procedure: { schema: 'S', name: 'P' },
  parameters: [
    { mode: 'in', ordinal: 1, ...INTEGER },
    { mode: 'in', ordinal: 2, ...INTEGER },
    { mode: 'in', ordinal: 2, ...INTEGER },
    { mode: 'inout', ordinal: 3, ...INTEGER },
    { mode: 'out', ordinal: 4, ...INTEGER },
  ],
};

/**
 * A Prepared's body: statement 3, its inputs, no columns, then what `tail` writes.
 *
 * @param inputs - its input parameters
 * @param tail - writes its tail
 * @returns the body
 */
function prepared(inputs: readonly Parameter[], tail: (w: Writer) => void): Uint8Array {
  const w = new Writer().u32(3);
  w.list(inputs, writeParameter);
  writeColumns(w, [
    { name: 'B', type: INTEGER.type, notNull: false, declared: { name: 'INTEGER', written: 'INTEGER' } },
  ]);
  tail(w);
  return w.finish();
}

/** Verifies: [PROTOCOL Capabilities] `parameter-modes` is a capability, the twentieth of version 1's, asked for by default. */
test('parameter-modes is asked for', () => {
  assert.equal(PARAMETER_MODES, 'parameter-modes');
  assert.equal(ALL_CAPABILITIES.at(-2), PARAMETER_MODES);
  assert.equal(ALL_CAPABILITIES.length, 21);
  assert.ok(Offer.default().capabilities.includes(PARAMETER_MODES));
});

/** Verifies: [PROTOCOL Parameter modes] [PROTOCOL The tail] tail 20 is the procedure's schema and name, then each `?` in written order, its mode, 1 IN, 2 INOUT or 4 OUT, its ordinal position from 1 and its parameter, after tail 19. */
test('tail 20 tells each ? of a CALL', () => {
  const reply = decodeReply(
    'P'.charCodeAt(0),
    prepared([INTEGER, INTEGER, INTEGER, INTEGER], (w) => {
      writeCalled(w, CALLED);
    }),
  );
  assert.ok(reply.kind === 'prepared');
  assert.deepEqual(reply.called, CALLED);
  assert.deepEqual(reply.columns[0]?.declared, { name: 'INTEGER', written: 'INTEGER' }, 'tail 19 before it');
  const w = new Writer();
  writeCalled(w, CALLED);
  assert.deepEqual([...w.finish().subarray(0, 16)], [20, 1, 0, 0, 0, 0x53, 1, 0, 0, 0, 0x50, 5, 0, 0, 0, 1]);
  const none = new Writer();
  writeCalled(none, undefined);
  assert.equal(none.finish().byteLength, 0, 'nothing of another statement');
});

/** Verifies: [PROTOCOL Parameter modes] a Prepared of another statement has no tail 20, and each of its parameters is IN, of no position. */
test('a statement not a CALL has its inputs, each IN', () => {
  const reply = decodeReply(
    'P'.charCodeAt(0),
    prepared([INTEGER], () => undefined),
  );
  assert.ok(reply.kind === 'prepared' && reply.called === undefined);
  assert.deepEqual(dynamicParameters(reply.parameters, reply.called), [{ mode: 'in', ...INTEGER }]);
  assert.deepEqual(dynamicParameters([], CALLED), CALLED.parameters);
});

/** Verifies: [PROTOCOL Parameter modes] a mode of another code, or a position of 0, fails the connection (08006). */
test('a bad mode or position fails the connection', () => {
  const bad = (mode: number, ordinal: number) => (w: Writer) => {
    w.u8(20).string('S').string('P').u32(1).u8(mode).u32(ordinal);
    writeParameter(w, INTEGER);
  };
  for (const mode of [0, 3, 8]) {
    assert.throws(() => decodeReply('P'.charCodeAt(0), prepared([], bad(mode, 1))), isConnectionFailure, String(mode));
  }
  assert.throws(() => decodeReply('P'.charCodeAt(0), prepared([], bad(1, 0))), isConnectionFailure, 'position 0');
});
