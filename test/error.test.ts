/**
 * Tests of the driver's error type, as the package exports it
 * (RULES.md R-TEST-2).
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { connectionFailure } from '../src/error.js';
import { TurborelError } from '../src/index.js';

/** Verifies: [DESIGN] D7 a failure carries its SQLCODE, SQLSTATE, message, rule and whether a transaction is active. */
test('a failure carries what the server said of it', () => {
  const failure = new TurborelError(-103, '2A000', 'table ANN.NOPE is not defined', {
    rule: 'X3.135-1986 §5.4 SR5',
    active: true,
  });
  assert.ok(failure instanceof Error);
  assert.equal(failure.name, 'TurborelError');
  assert.equal(failure.sqlcode, -103);
  assert.equal(failure.sqlstate, '2A000');
  assert.equal(failure.message, 'table ANN.NOPE is not defined');
  assert.equal(failure.rule, 'X3.135-1986 §5.4 SR5');
  assert.equal(failure.active, true);
  assert.equal(failure.cause, undefined);
});

/** Verifies: [DESIGN] D7 a failure that cites no rule says no transaction is active unless told, and keeps its cause. */
test('a failure keeps its cause, and is of no transaction unless told', () => {
  const cause = new Error('socket closed');
  const failure = new TurborelError(-919, '08006', 'the server closed the connection', { cause });
  assert.equal(failure.rule, undefined);
  assert.equal(failure.active, false);
  assert.equal(failure.cause, cause);
});

/** Verifies: [PROTOCOL Frames] a connection failure is SQLCODE -919, SQLSTATE 08006. */
test('a connection failure is SQLCODE -919, SQLSTATE 08006', () => {
  const failure = connectionFailure('a body cut short');
  assert.equal(failure.sqlcode, -919);
  assert.equal(failure.sqlstate, '08006');
  assert.equal(failure.message, 'a body cut short');
});
