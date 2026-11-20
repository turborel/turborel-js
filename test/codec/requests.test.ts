/**
 * Tests of every request a client sends, encoded byte for byte as
 * turborel-protocol writes it, a tail written only where it says
 * something (RULES.md R-TEST-2).
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { type Request, encodeRequest } from '../../src/codec/requests.js';
import { isFailure } from '../support/failures.js';

/**
 * The bytes of `request`, as numbers, to compare with a fixture.
 *
 * @param request - the request
 * @returns its frame's bytes
 */
function bytes(request: Request): number[] {
  return [...encodeRequest(request)];
}

/**
 * The bytes of a string field: its length, then its UTF-8.
 *
 * @param text - an ASCII string
 * @returns its bytes
 */
function str(text: string): number[] {
  return [text.length, 0, 0, 0, ...new TextEncoder().encode(text)];
}

const NO_ATTRIBUTES: readonly (readonly [string, string])[] = [];

/** Verifies: [PROTOCOL Hello 'H'] Hello is version, user, mechanism, initial bytes and capabilities, its attributes its tail, tag 1. */
test('Hello', () => {
  const hello: Request = {
    kind: 'hello',
    version: 1,
    user: 'ANN',
    mechanism: 'trust',
    initial: new Uint8Array(0),
    capabilities: ['ping'],
    attributes: NO_ATTRIBUTES,
  };
  const body = [1, 0, 0, 0, ...str('ANN'), ...str('trust'), 0, 0, 0, 0, 1, 0, 0, 0, ...str('ping')];
  assert.deepEqual(bytes(hello), [0x48, body.length, 0, 0, 0, ...body]);
  const attributed = bytes({ ...hello, attributes: [['application', 'x']] });
  assert.deepEqual(attributed.slice(5 + body.length), [1, 1, 0, 0, 0, ...str('application'), ...str('x')]);
});

/** Verifies: [PROTOCOL The tail] attributes are at most 32, each name 1 to 64 bytes and each value at most 1024, and more is never sent. */
test('attributes are bounded', () => {
  const query = (attributes: readonly (readonly [string, string])[]): Request => ({
    kind: 'query',
    sql: 'S',
    ends: false,
    attributes,
    multi: false,
  });
  const many = Array.from({ length: 32 }, (_, i): readonly [string, string] => [`A${String(i)}`, 'v']);
  assert.ok(bytes(query(many)).length > 0);
  assert.ok(bytes(query([['N'.repeat(64), 'v'.repeat(1024)]])).length > 0);
  for (const bad of [
    [...many, ['B', 'v']],
    [['N'.repeat(65), '']],
    [['', '']],
    [['N', 'v'.repeat(1025)]],
    [['é'.repeat(33), '']],
  ] as (readonly (readonly [string, string])[])[]) {
    assert.throws(() => bytes(query(bad)), isFailure(-910, 'TB910'));
  }
});

/** Verifies: [PROTOCOL Query 'Q'] Query is the SQL and ends; tag 2, multi, has no field. */
test('Query', () => {
  assert.deepEqual(bytes({ kind: 'query', sql: 'AB', ends: true, attributes: NO_ATTRIBUTES, multi: false }), [
    0x51,
    7,
    0,
    0,
    0,
    ...str('AB'),
    1,
  ]);
  assert.deepEqual(
    bytes({ kind: 'query', sql: '', ends: false, attributes: NO_ATTRIBUTES, multi: true }),
    [0x51, 6, 0, 0, 0, 0, 0, 0, 0, 0, 2],
  );
  const both = bytes({ kind: 'query', sql: '', ends: false, attributes: [['a', 'b']], multi: true });
  assert.deepEqual(both.slice(10), [1, 1, 0, 0, 0, ...str('a'), ...str('b'), 2], 'tags in increasing order');
});

/** Verifies: [PROTOCOL Prepare 'P'] Prepare is the statement's number and its SQL. */
test('Prepare', () => {
  assert.deepEqual(bytes({ kind: 'prepare', statement: 0xffff_ffff, sql: 'S' }), [
    0x50,
    9,
    0,
    0,
    0,
    0xff,
    0xff,
    0xff,
    0xff,
    ...str('S'),
  ]);
});

/** Verifies: [PROTOCOL Execute 'E'] Execute is statement, values, rows and ends; its tail attributes, then cursor, tag 3, if not 0. */
test('Execute', () => {
  const execute: Request = {
    kind: 'execute',
    statement: 1,
    cursor: 0,
    values: [null, -1n],
    rows: 10,
    ends: false,
    attributes: NO_ATTRIBUTES,
  };
  const values = [2, 0, 0, 0, 0, 2, ...new Array<number>(16).fill(0xff), 0, 0, 0, 0];
  const body = [1, 0, 0, 0, ...values, 10, 0, 0, 0, 0];
  assert.deepEqual(bytes(execute), [0x45, body.length, 0, 0, 0, ...body]);
  assert.deepEqual(bytes({ ...execute, cursor: 7 }).slice(5 + body.length), [3, 7, 0, 0, 0]);
  const tailed = bytes({ ...execute, cursor: 7, attributes: [['k', 'v']] }).slice(5 + body.length);
  assert.deepEqual(tailed, [1, 1, 0, 0, 0, ...str('k'), ...str('v'), 3, 7, 0, 0, 0]);
});

/** Verifies: [PROTOCOL Fetch 'F'] Fetch is statement and rows; its tail the cursor, tag 3. */
test('Fetch', () => {
  assert.deepEqual(
    bytes({ kind: 'fetch', statement: 2, cursor: 0, rows: 0 }),
    [0x46, 8, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0],
  );
  assert.deepEqual(
    bytes({ kind: 'fetch', statement: 1, cursor: 0xffff_ffff, rows: 2 }).slice(13),
    [3, 0xff, 0xff, 0xff, 0xff],
  );
});

/** Verifies: [PROTOCOL Close 'C'] Close is the statement; with no cursor, its first form, else tag 3 and the cursor. */
test('Close', () => {
  assert.deepEqual(bytes({ kind: 'close', statement: 2, cursor: 0 }), [0x43, 4, 0, 0, 0, 2, 0, 0, 0]);
  assert.deepEqual(bytes({ kind: 'close', statement: 2, cursor: 5 }), [0x43, 9, 0, 0, 0, 2, 0, 0, 0, 3, 5, 0, 0, 0]);
});

/** Verifies: [PROTOCOL Deallocate 'D'] Deallocate is the statement alone. */
test('Deallocate', () => {
  assert.deepEqual(bytes({ kind: 'deallocate', statement: 4 }), [0x44, 4, 0, 0, 0, 4, 0, 0, 0]);
});

/** Verifies: [PROTOCOL Lob 'L'] the request: an op, then read's locator, from, count and characters flag; create's kind; append's locator and bytes; free's and hold's locator. */
test('Lob requests', () => {
  assert.deepEqual(
    bytes({ kind: 'lob', lob: { op: 'read', locator: 7, from: 0n, count: 262_144n, characters: true } }),
    [0x4c, 22, 0, 0, 0, 0, 7, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 4, 0, 0, 0, 0, 0, 1],
  );
  assert.deepEqual(bytes({ kind: 'lob', lob: { op: 'create', lobKind: 'binary' } }), [0x4c, 2, 0, 0, 0, 1, 1]);
  assert.deepEqual(bytes({ kind: 'lob', lob: { op: 'create', lobKind: 'character' } }), [0x4c, 2, 0, 0, 0, 1, 0]);
  assert.deepEqual(
    bytes({ kind: 'lob', lob: { op: 'append', locator: 3, bytes: Uint8Array.of(9) } }),
    [0x4c, 10, 0, 0, 0, 2, 3, 0, 0, 0, 1, 0, 0, 0, 9],
  );
  assert.deepEqual(bytes({ kind: 'lob', lob: { op: 'free', locator: 3 } }), [0x4c, 5, 0, 0, 0, 3, 3, 0, 0, 0]);
  assert.deepEqual(bytes({ kind: 'lob', lob: { op: 'hold', locator: 3 } }), [0x4c, 5, 0, 0, 0, 4, 3, 0, 0, 0]);
});

/** Verifies: [PROTOCOL Cancel 'Z'] Cancel is the key, 16 bytes, with no length before them. */
test('Cancel', () => {
  assert.deepEqual(bytes({ kind: 'cancel', key: new Uint8Array(16).fill(7) }), [
    0x5a,
    16,
    0,
    0,
    0,
    ...new Array<number>(16).fill(7),
  ]);
  assert.throws(() => bytes({ kind: 'cancel', key: new Uint8Array(15) }), isFailure(-910, 'TB910'));
});

/** Verifies: [PROTOCOL Terminate 'X'] Terminate, Ping and Reset are a header alone. */
test('Terminate, Ping and Reset', () => {
  assert.deepEqual(bytes({ kind: 'terminate' }), [0x58, 0, 0, 0, 0]);
  assert.deepEqual(bytes({ kind: 'ping' }), [0x47, 0, 0, 0, 0]);
  assert.deepEqual(bytes({ kind: 'reset' }), [0x57, 0, 0, 0, 0]);
});

/** Verifies: [PROTOCOL Describe 'Y'] Describe is what, 0 a statement of cursor 0 or 1 a cursor, the statement and the cursor. */
test('Describe', () => {
  assert.deepEqual(
    bytes({ kind: 'describe', what: 'statement', statement: 2, cursor: 9 }),
    [0x59, 9, 0, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0],
  );
  assert.deepEqual(
    bytes({ kind: 'describe', what: 'cursor', statement: 4, cursor: 1 }),
    [0x59, 9, 0, 0, 0, 1, 4, 0, 0, 0, 1, 0, 0, 0],
  );
});

/** Verifies: [PROTOCOL ChangeUser 'U'] ChangeUser is the user, the mechanism and its first bytes. */
test('ChangeUser and Answer', () => {
  assert.deepEqual(bytes({ kind: 'changeUser', user: 'Y', mechanism: 'p', initial: Uint8Array.of(1, 2) }), [
    0x55,
    16,
    0,
    0,
    0,
    ...str('Y'),
    ...str('p'),
    2,
    0,
    0,
    0,
    1,
    2,
  ]);
  assert.deepEqual(bytes({ kind: 'answer', answer: new Uint8Array(0) }), [0x41, 4, 0, 0, 0, 0, 0, 0, 0]);
});

/** Verifies: [PROTOCOL CopyIn 'I'] CopyIn is the table, its columns and ends; CopyData a list of rows; CopyEnd the abandon flag. */
test('CopyIn, CopyData and CopyEnd', () => {
  assert.deepEqual(bytes({ kind: 'copyIn', table: 'T', columns: ['A'], ends: true }), [
    0x49,
    15,
    0,
    0,
    0,
    ...str('T'),
    1,
    0,
    0,
    0,
    ...str('A'),
    1,
  ]);
  assert.deepEqual(bytes({ kind: 'copyData', rows: [[null, 'x'], []] }), [
    0x4a,
    19,
    0,
    0,
    0,
    2,
    0,
    0,
    0,
    2,
    0,
    0,
    0,
    0,
    1,
    ...str('x'),
    0,
    0,
    0,
    0,
  ]);
  assert.deepEqual(bytes({ kind: 'copyEnd', abandon: true }), [0x4e, 1, 0, 0, 0, 1]);
});
