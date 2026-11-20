/**
 * Tests of every reply a client receives, decoded from the bytes the spec
 * and turborel-protocol give, its tail read in order, and malformed ones
 * refused (RULES.md R-TEST-2).
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { writeColumn, writeFailure } from '../../src/codec/composite.js';
import { type Reply, decodeReply } from '../../src/codec/replies.js';
import { writeType } from '../../src/codec/types.js';
import { Writer } from '../../src/codec/writer.js';
import { TurborelError } from '../../src/error.js';
import { isConnectionFailure } from '../support/failures.js';

/**
 * The bytes of a string field: its length, then its UTF-8.
 *
 * @param text - an ASCII string
 * @returns its bytes
 */
function str(text: string): number[] {
  return [text.length, 0, 0, 0, ...new TextEncoder().encode(text)];
}

/**
 * The reply of `kind` letter and body.
 *
 * @param letter - its kind's letter
 * @param body - its body
 * @returns the reply
 */
function reply(letter: string, body: number[] | Uint8Array): Reply {
  return decodeReply(letter.charCodeAt(0), body instanceof Uint8Array ? body : Uint8Array.from(body));
}

/** A Complete's first form: SQLCODE 0, SQLSTATE 00000, active 0. */
const COMPLETE = [0, 0, 0, 0, ...str('00000'), 0];

/** Verifies: [PROTOCOL Challenge 'C'] Challenge is bytes. */
test('Challenge', () => {
  assert.deepEqual(reply('C', [1, 0, 0, 0, 0xff]), { kind: 'challenge', challenge: Uint8Array.of(0xff) });
});

/** Verifies: [PROTOCOL Ready 'R'] Ready is the authorization, the key of 16 bytes, the capabilities and the server. */
test('Ready', () => {
  const key = new Array<number>(16).fill(0xab);
  const body = [...str('ANN'), ...key, 1, 0, 0, 0, ...str('ping'), ...str('turborel 0.0.0 (alpha)')];
  assert.deepEqual(reply('R', body), {
    kind: 'ready',
    authorization: 'ANN',
    key: Uint8Array.from(key),
    capabilities: ['ping'],
    server: 'turborel 0.0.0 (alpha)',
  });
  assert.throws(() => reply('R', [0, 0, 0, 0, 1]), isConnectionFailure, 'a key cut short');
});

/** Verifies: [PROTOCOL Prepared 'P'] Prepared is the statement, its parameters, each varying flag and type, and its columns. */
test('Prepared', () => {
  const w = new Writer().u32(9).u32(2).flag(true);
  writeType(w, { kind: 'varying', length: 0xffff_ffff, units: 'characters' });
  w.flag(false);
  writeType(w, { kind: 'exact', precision: 5, scale: 2 });
  w.u32(1);
  writeColumn(w, { name: 'K', type: { kind: 'boolean' }, notNull: true });
  assert.deepEqual(reply('P', w.finish()), {
    kind: 'prepared',
    statement: 9,
    parameters: [
      { varying: true, type: { kind: 'varying', length: 0xffff_ffff, units: 'characters' } },
      { varying: false, type: { kind: 'exact', precision: 5, scale: 2 } },
    ],
    columns: [{ name: 'K', type: { kind: 'boolean' }, notNull: true }],
  });
  assert.deepEqual(reply('P', [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), {
    kind: 'prepared',
    statement: 0,
    parameters: [],
    columns: [],
  });
});

/** Verifies: [PROTOCOL Composite fields] a column is its named flag, its name if named, its type and its not null flag; a flag of 2 fails. */
test('Description, and columns', () => {
  const description = (flag: number, tag: number): number[] => [1, 0, 0, 0, flag, tag, 1, 0, 0, 0, 0, 0];
  assert.deepEqual(reply('D', description(0, 1)), {
    kind: 'description',
    columns: [{ type: { kind: 'character', length: 1, units: 'characters' }, notNull: false }],
  });
  assert.throws(() => reply('D', description(2, 1)), isConnectionFailure, 'a flag of 2');
  assert.throws(() => reply('D', description(0, 99)), isConnectionFailure, 'no such type');
  assert.deepEqual(reply('D', [0, 0, 0, 0]), { kind: 'description', columns: [] });
});

/** Verifies: [PROTOCOL Rows 'B'] Rows is a list of rows, each a list of values. */
test('Rows', () => {
  assert.deepEqual(reply('B', [1, 0, 0, 0, 2, 0, 0, 0, 0, 14, 1]), { kind: 'rows', rows: [[null, true]] });
  assert.deepEqual(reply('B', [0, 0, 0, 0]), { kind: 'rows', rows: [] });
  assert.throws(() => reply('B', [1, 0, 0, 0, 1, 0, 0, 0, 99]), isConnectionFailure, 'no such value');
  assert.throws(() => reply('B', [1, 0, 0, 0, 9, 0, 0, 0]), /reply received is malformed/u);
});

/** Verifies: [PROTOCOL Suspended 'S'] Suspended and Pong are a kind alone, and a byte after either fails. */
test('Suspended and Pong', () => {
  assert.deepEqual(reply('S', []), { kind: 'suspended' });
  assert.deepEqual(reply('G', []), { kind: 'pong' });
  assert.throws(() => reply('G', [1]), isConnectionFailure, 'a byte after Pong');
});

/** Verifies: [PROTOCOL Complete 'K'] Complete is SQLCODE, SQLSTATE and active; with an empty tail, its first form. */
test('Complete, first form', () => {
  assert.deepEqual(reply('K', COMPLETE), {
    kind: 'complete',
    completion: { sqlcode: 0, sqlstate: '00000', active: false, more: false, generated: [], conditions: [] },
  });
  const noData = reply('K', [100, 0, 0, 0, ...str('02000'), 1]);
  assert.ok(noData.kind === 'complete' && noData.completion.sqlcode === 100 && noData.completion.active);
  const least = reply('K', [0, 0, 0, 0x80, ...str('01007'), 0]);
  assert.ok(least.kind === 'complete' && least.completion.sqlcode === -(2 ** 31));
});

/** Verifies: [PROTOCOL The tail] Complete's tags 4, 5, 6, 16, 17 and 18, in increasing order, each read as it is written. */
test("Complete's tail", () => {
  const condition = new Writer();
  writeFailure(condition, new TurborelError(0, '01003', 'null eliminated', { diagnostics: { severity: 'WARNING' } }));
  const w = new Writer().raw(Uint8Array.from(COMPLETE));
  w.u8(4)
    .u64(2n ** 64n - 1n)
    .u8(5)
    .u8(6)
    .u64(0n)
    .u8(16)
    .strings(['1', '']);
  w.u8(17).u32(1).bytes(condition.finish());
  w.u8(18).u64(120n).u64(3n).u64(0n);
  const decoded = reply('K', w.finish());
  assert.equal(decoded.kind, 'complete');
  const { position, more, rows, generated, conditions, time } = decoded.completion;
  assert.deepEqual(
    [position, more, rows, generated, time],
    [2n ** 64n - 1n, true, 0n, ['1', ''], { total: 120n, queued: 3n, locks: 0n }],
  );
  assert.equal(conditions.length, 1);
  assert.deepEqual(
    [conditions[0]?.sqlstate, conditions[0]?.message, conditions[0]?.diagnostics],
    ['01003', 'null eliminated', { severity: 'WARNING' }],
  );
  assert.deepEqual([...new Writer().u8(4).u64(9n).finish()], [4, 9, 0, 0, 0, 0, 0, 0, 0]);
});

/** Verifies: [PROTOCOL The tail] a tag out of order, twice, or one the message does not take fails the connection. */
test('a tail out of place fails', () => {
  const bad: [string, number[]][] = [
    ['out of order', [...COMPLETE, 5, 4, 1, 0, 0, 0, 0, 0, 0, 0]],
    ['a tag twice', [...COMPLETE, 5, 5]],
    ["a failure's tag", [...COMPLETE, 7]],
    ['a tag no reply has', [...COMPLETE, 19]],
    ['a generated value cut short', [...COMPLETE, 16, 1, 0, 0, 0, 1, 0, 0, 0]],
    ['a condition cut short', [...COMPLETE, 17, 1, 0, 0, 0, 1, 0, 0, 0, 0]],
  ];
  for (const [why, body] of bad) {
    assert.throws(() => reply('K', body), isConnectionFailure, why);
  }
});

/** Verifies: [PROTOCOL Error 'E'] Error is a failure: SQLCODE, SQLSTATE, message, cited rule, position, active, and its diagnostics, tags 7 to 15. */
test('Error, and failures', () => {
  const failure = new TurborelError(-103, '2A000', 'column K is ambiguous', {
    rule: 'X3.135-1986 §5.7 SR3b',
    position: 7n,
    active: false,
  });
  const w = new Writer();
  writeFailure(w, failure);
  const decoded = reply('E', w.finish());
  assert.ok(decoded.kind === 'error');
  assert.deepEqual(decoded.failure, failure);
  assert.deepEqual(
    [decoded.failure.sqlcode, decoded.failure.rule, decoded.failure.position],
    [-103, 'X3.135-1986 §5.7 SR3b', 7n],
  );
  const plain = [0x61, 0xfc, 0xff, 0xff, ...str('TB911'), 0, 0, 0, 0, 0, 0, 1];
  const read = reply('E', plain);
  assert.ok(
    read.kind === 'error' && read.failure.sqlcode === -927 && read.failure.active && read.failure.rule === undefined,
  );
});

/** Verifies: [PROTOCOL Errors and notices] a failure's diagnostics are tags 7 to 15, each said read as written, an empty one kept. */
test('diagnostics', () => {
  const diagnostics = {
    severity: 'ERROR',
    detail: 'd',
    hint: '',
    context: 'trigger S.T',
    schema: 'S',
    table: 'T',
    column: 'C',
    dataType: 'INTEGER',
    constraint: 'K',
  };
  const w = new Writer();
  writeFailure(w, new TurborelError(-803, '23505', 'm', { active: true, diagnostics }));
  const decoded = reply('E', w.finish());
  assert.ok(decoded.kind === 'error');
  assert.deepEqual(decoded.failure.diagnostics, diagnostics);
});

/** Verifies: [PROTOCOL Lob 'L'] the reply: 0 the data a read gave, 1 the locator a create made, any other fails. */
test('Lob replies', () => {
  assert.deepEqual(reply('L', [0, 2, 0, 0, 0, 1, 2]), { kind: 'lobData', data: Uint8Array.of(1, 2) });
  assert.deepEqual(reply('L', [1, 7, 0, 0, 0]), { kind: 'lobLocator', locator: 7 });
  assert.throws(() => reply('L', [2]), isConnectionFailure);
});

/** Verifies: [PROTOCOL Notice 'N'] Notice is SQLSTATE and message, its tail the diagnostics. */
test('Notice', () => {
  assert.deepEqual(reply('N', [...str('01T01'), ...str('')]), { kind: 'notice', sqlstate: '01T01', message: '' });
  assert.deepEqual(reply('N', [...str('01004'), ...str('cut'), 7, ...str('WARNING')]), {
    kind: 'notice',
    sqlstate: '01004',
    message: 'cut',
    diagnostics: { severity: 'WARNING' },
  });
});

/** Verifies: [PROTOCOL Status 'T'] Status is a name and its value, empty for a null. */
test('Status', () => {
  assert.deepEqual(reply('T', [...str('SESSION.TIME_ZONE'), ...str('+00:00')]), {
    kind: 'status',
    name: 'SESSION.TIME_ZONE',
    value: '+00:00',
  });
});

/** Verifies: [PROTOCOL Frames] a kind the reader does not know fails the connection: a request's kind, or none. */
test('a kind of no reply fails', () => {
  for (const kind of ['Q', 'X', 'z', 'H']) {
    assert.throws(() => reply(kind, []), isConnectionFailure, kind);
  }
  assert.throws(() => decodeReply(0, new Uint8Array(0)), isConnectionFailure);
});
