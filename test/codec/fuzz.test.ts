/**
 * Property tests of the decoder, by cases of a fixed seed (RULES.md
 * R-TEST-5): whatever bytes a server sends, the codec gives a reply or a
 * connection failure, never another error, a hang or a crash.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deflateSync } from 'node:zlib';

import { writeColumn, writeFailure } from '../../src/codec/composite.js';
import { decompress } from '../../src/codec/compress.js';
import { DecFloat } from '../../src/codec/decfloat.js';
import { Decimal } from '../../src/codec/decimal.js';
import { Json } from '../../src/codec/json.js';
import { JsonDamage } from '../../src/codec/json-tree.js';
import { decodeReply } from '../../src/codec/replies.js';
import { writeValue } from '../../src/codec/value-codec.js';
import { Datetime, Interval, LobLocator, Multiset, Uuid, type Value } from '../../src/codec/values.js';
import { Writer } from '../../src/codec/writer.js';
import { TurborelError } from '../../src/error.js';
import { Cases } from '../support/random.js';

/** The kinds of every reply, and of none. */
const KINDS = [...new TextEncoder().encode('CRPDBSKELNTGQz'), 0];

/** How many cases each property takes. */
const CASES = 3000;

/**
 * Checks that `decode` gives something or fails the connection, nothing else.
 *
 * @param decode - the decoding to try
 */
function decodesOrFails(decode: () => unknown): void {
  try {
    decode();
  } catch (e) {
    assert.ok(e instanceof TurborelError, String(e));
    assert.deepEqual([e.sqlcode, e.sqlstate], [-919, '08006'], e.message);
  }
}

/** Valid replies' kinds and bodies, of every value and field, for mutating. */
function validReplies(): [number, Uint8Array][] {
  const values: Value[] = [
    null,
    'é',
    -1n,
    new Decimal(-125n, 2),
    -0,
    true,
    Uint8Array.of(1, 2),
    new Datetime({ moment: 'timestamp', zoned: true, precision: 6, zone: -779, utc: 1n }),
    new Interval({ start: 'DAY', end: 'SECOND', leading: 9, fraction: 6 }, -1n),
    DecFloat.of(15n, -1),
    [[1n], null],
    new Multiset(['x']),
    new LobLocator('binary', 7, { octets: 9n, characters: 9n }),
    Json.of({ a: [1n, 'b', null], c: 1.5 }),
    new Uuid(new Uint8Array(16).fill(7)),
  ];
  const rows = new Writer().u32(1);
  rows.list(values, writeValue);
  const description = new Writer().u32(1);
  writeColumn(description, {
    name: 'X',
    type: { kind: 'array', maxCardinality: 3, element: { kind: 'boolean' } },
    notNull: true,
  });
  const error = new Writer();
  writeFailure(error, new TurborelError(-803, '23505', 'm', { rule: 'r', position: 3n, diagnostics: { detail: 'd' } }));
  const condition = new Writer();
  writeFailure(condition, new TurborelError(0, '01003', 'w'));
  const complete = new Writer().i32(0).string('00000').flag(false).u8(4).u64(9n).u8(6).u64(1n);
  complete.u8(17).u32(1).bytes(condition.finish()).u8(18).u64(1n).u64(2n).u64(3n);
  return [
    ['B'.charCodeAt(0), rows.finish()],
    ['D'.charCodeAt(0), description.finish()],
    ['E'.charCodeAt(0), error.finish()],
    ['K'.charCodeAt(0), complete.finish()],
  ];
}

/** Verifies: [PROTOCOL Errors and notices] random bodies of every reply's kind decode or fail the connection, never anything else. */
test('random replies decode or fail the connection', () => {
  const cases = new Cases(0x7e57_0001);
  for (let i = 0; i < CASES; i += 1) {
    const kind = KINDS[cases.below(KINDS.length)] ?? 0;
    const body = cases.bytes(cases.below(48));
    decodesOrFails(() => decodeReply(kind, body));
  }
});

/** Verifies: [PROTOCOL Errors and notices] valid replies changed in one place decode or fail the connection, never anything else. */
test('mutated replies decode or fail the connection', () => {
  const cases = new Cases(0x7e57_0002);
  const valid = validReplies();
  for (const [kind, body] of valid) assert.doesNotThrow(() => decodeReply(kind, body));
  for (let i = 0; i < CASES; i += 1) {
    const [kind, body] = valid[cases.below(valid.length)] ?? [0, new Uint8Array(0)];
    let mutated = body;
    for (let n = cases.below(3) + 1; n > 0; n -= 1) mutated = cases.mutate(mutated);
    decodesOrFails(() => decodeReply(kind, mutated));
  }
});

/** Verifies: [PROTOCOL Compressed frames] compressed frames changed in one place inflate within their bounds or fail the connection. */
test('mutated compressed frames inflate or fail the connection', () => {
  const cases = new Cases(0x7e57_0003);
  const body = new Writer()
    .u8(0x42)
    .u32(4000)
    .raw(deflateSync(new Uint8Array(4000).fill(0x61)))
    .finish();
  for (let i = 0; i < CASES; i += 1) {
    const mutated = cases.mutate(body);
    decodesOrFails(() => {
      const held = decompress(mutated, 4096);
      assert.ok(held.body.byteLength <= 4096);
    });
  }
});

/** Verifies: [PROTOCOL Values] JSON documents changed in one place are read whole or refused as damaged, never anything else. */
test('mutated JSON documents are read or refused', () => {
  const cases = new Cases(0x7e57_0004);
  const doc = Json.of({ b: [1n, new Decimal(5n, 1), 'x', { c: null }], a: true, d: 2n ** 100n, e: -0.5 }).bytes;
  for (let i = 0; i < CASES; i += 1) {
    const mutated = cases.mutate(doc);
    try {
      Json.ofBytes(mutated).item();
    } catch (e) {
      assert.ok(e instanceof JsonDamage, String(e));
    }
  }
});
