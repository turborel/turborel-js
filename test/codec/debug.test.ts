/**
 * Tests of the routine debugger's messages (`[PROTOCOL Debug 'V']`): codes
 * of no request, reply, event or reason fail the connection, and an Event
 * ends no request.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { REPLY } from '../../src/codec/kinds.js';
import { decodeReply, endsRequest } from '../../src/codec/replies.js';
import { ALL_CAPABILITIES, DEBUGGER } from '../../src/session/capabilities.js';
import { Offer } from '../../src/session/told.js';
import { isConnectionFailure } from '../support/failures.js';

/** Verifies: [PROTOCOL Capabilities] `debugger` is a capability, the last of version 1's twenty-one, asked for by default as turborel-client asks for every one but compression. */
test('debugger is asked for', () => {
  assert.equal(DEBUGGER, 'debugger');
  assert.deepEqual([ALL_CAPABILITIES.at(-1), ALL_CAPABILITIES.length], [DEBUGGER, 21]);
  assert.ok(Offer.default().capabilities.includes(DEBUGGER));
});

/** Verifies: [PROTOCOL Debugged 'V'] [PROTOCOL Event 'W'] a Debugged, an Event or a pause of a code of none, or a frame's routine of no kind, fails the connection; an Event ends no request, a Debugged does. */
test('debugger codes of none fail the connection', () => {
  const bad: [number, number[]][] = [
    [REPLY.DEBUGGED, [4]],
    [REPLY.EVENT, [4]],
    [REPLY.EVENT, [0, 2]],
    [REPLY.EVENT, [0, 1, 1, 0, 0, 0, 1, 3]],
  ];
  for (const [kind, body] of bad) {
    assert.throws(() => decodeReply(kind, Uint8Array.from(body)), isConnectionFailure, String(body));
  }
  assert.deepEqual(decodeReply(REPLY.EVENT, Uint8Array.of(3)), { kind: 'event', event: { what: 'ended' } });
  assert.equal(endsRequest(REPLY.EVENT, Uint8Array.of(3)), false);
  assert.equal(endsRequest(REPLY.DEBUGGED, Uint8Array.of(0, 2, 0, 0, 0, 0, 0, 0, 0)), true);
});
