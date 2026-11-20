/**
 * Tests of the JSON value's binary tree, Turborel's RULES.md D89: every
 * node written and read back, an object's directory sorted, and damaged
 * documents refused (RULES.md R-TEST-2).
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DecFloat } from '../../src/codec/decfloat.js';
import { Decimal } from '../../src/codec/decimal.js';
import { Json, type JsonInput, JsonObject } from '../../src/codec/json.js';
import { JsonDamage } from '../../src/codec/json-tree.js';
import { Datetime } from '../../src/codec/values.js';
import { isFailure } from '../support/failures.js';

/**
 * The bytes of a little-endian u32.
 *
 * @param n - the number
 * @returns its four bytes
 */
function u32(n: number): number[] {
  return [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, n >>> 24];
}

/**
 * Whether a thrown error is a damaged document's.
 *
 * @param error - what was thrown
 * @returns true if it is
 */
function isDamage(error: unknown): boolean {
  return error instanceof JsonDamage;
}

/**
 * The document `bytes` hold, checked whole.
 *
 * @param bytes - the stored form
 * @returns its JSON value
 */
function stored(bytes: number[]): Json {
  return Json.ofBytes(Uint8Array.from(bytes));
}

/** Verifies: [PROTOCOL Values] a JSON value is a version octet, 1, then its root node, an object its count, size, offsets and members (CONFORMANCE.md G3). */
test('a JSON document is its version, then its tree', () => {
  const doc = Json.of({ a: 1n });
  const member = [...u32(1), 0x61, 3, 1, 0, 0, 0, 0, 0, 0, 0];
  assert.deepEqual(doc.bytes, Uint8Array.from([1, 11, ...u32(1), ...u32(member.length), ...u32(0), ...member]));
  assert.deepEqual(doc.item(), new JsonObject([['a', 1n]]));
});

/** Verifies: [PROTOCOL Values] every node of the tree reads back as written, an exact number in the narrowest of its forms. */
test('every node reads back as written', () => {
  const datetime = new Datetime({ moment: 'timestamp', zoned: true, precision: 6, zone: -300, utc: -1n });
  const items: JsonInput[] = [
    null,
    true,
    false,
    0n,
    2n ** 63n - 1n,
    -(2n ** 63n),
    2n ** 63n,
    new Decimal(125n, 1),
    new Decimal(-(2n ** 63n), 255),
    new Decimal(1n, 256),
    new Decimal(2n ** 100n, 3),
    DecFloat.of(-15n, -1),
    1.5,
    -0,
    'é',
    '',
    datetime,
    [],
    [1n, 'x', [null]],
    new JsonObject([]),
    new JsonObject([
      ['b', 1n],
      ['a', [true]],
      ['b', 2n],
    ]),
  ];
  for (const item of items) {
    const doc = Json.of(item);
    assert.deepEqual(doc.item(), item);
    assert.deepEqual(Json.ofBytes(doc.bytes).bytes, doc.bytes);
  }
  assert.equal(Json.of(2n ** 63n - 1n).bytes[1], 3, 'an i64 of scale 0, an integer');
  assert.equal(Json.of(new Decimal(125n, 1)).bytes[1], 4, 'an i64 of a scale an octet holds, a decimal');
  assert.equal(Json.of(2n ** 63n).bytes[1], 5, 'past an i64, a wide decimal');
  assert.equal(Json.of(new Decimal(1n, 256)).bytes[1], 5, 'a scale past an octet, a wide decimal');
});

/** Verifies: [PROTOCOL Values] an object keeps its members in the order written, its directory sorted by key octets, those of one key in that order. */
test("an object's directory is sorted by key octets", () => {
  const doc = Json.of(
    new JsonObject([
      ['b', 1n],
      ['a', 2n],
      ['é', 3n],
      ['a', 4n],
    ]),
  );
  const offsets = [0, 1, 2, 3].map((i) => new DataView(doc.bytes.buffer).getUint32(10 + i * 4, true));
  const member = 4 + 1 + 9;
  assert.deepEqual(offsets, [member, 2 * member + 15, 0, 2 * member]);
  const item = doc.item();
  assert.ok(item instanceof JsonObject);
  assert.deepEqual(
    item.members.map(([k]) => k),
    ['b', 'a', 'é', 'a'],
  );
  assert.equal(item.get('a'), 2n, 'the first member of a key');
  assert.equal(item.get('z'), undefined);
});

/** Verifies: [PROTOCOL Values] a plain object or array is written as an object or array, its members in its properties' order. */
test('plain objects and arrays', () => {
  const doc = Json.of({ z: [1n, { y: null }], a: 'x' });
  assert.deepEqual(
    doc.item(),
    new JsonObject([
      ['z', [1n, new JsonObject([['y', null]])]],
      ['a', 'x'],
    ]),
  );
  assert.deepEqual(Json.of(Object.create(null) as JsonInput).item(), new JsonObject([]));
  for (const bad of [undefined, Symbol('x'), new Map(), new Date(0), () => 1, { a: undefined }]) {
    assert.throws(() => Json.of(bad as unknown as JsonInput), isFailure(-910, 'TB910'));
  }
});

/** Verifies: [PROTOCOL JSON values] arrays and objects nest at most 128 deep, as turborel's MAX_NESTING, written or read. */
test('JSON nests at most 128 deep', () => {
  const nested = (depth: number): JsonInput => (depth === 0 ? null : [nested(depth - 1)]);
  const deepest = Json.of(nested(128));
  assert.deepEqual(deepest.item(), nested(128));
  assert.throws(() => Json.of(nested(129)), isFailure(-900, '0A000'));
  const root = [...deepest.bytes.subarray(1)];
  const wrapped = [1, 10, ...u32(1), ...u32(root.length), ...u32(0), ...root];
  assert.throws(() => stored(wrapped), isFailure(-900, '0A000'));
});

/** Verifies: [PROTOCOL Values] a document damaged in any part is refused before anything is made of it. */
test('damaged documents are refused', () => {
  const damaged: [string, number[]][] = [
    ['empty', []],
    ['no root', [1]],
    ['version 2', [2, 0]],
    ['octets after the root', [1, 0, 0]],
    ['a tag of no kind', [1, 12]],
    ['cut short', [1, 3, 1, 0]],
    ['a string not UTF-8', [1, 8, ...u32(1), 0xff]],
    ['a string past its document', [1, 8, ...u32(9), 0x61]],
    ['a datetime of no moment', [1, 9, 3, ...new Array<number>(12).fill(0)]],
    ['a zoned flag of 2', [1, 9, 0, ...new Array<number>(10).fill(0), 2, 0]],
    ['a DECFLOAT out of range', [1, 6, 1, ...new Array<number>(15).fill(0), ...u32(0x7fff_ffff)]],
    ['an element out of place', [1, 10, ...u32(1), ...u32(1), ...u32(1), 0]],
    ["an array's size not its elements'", [1, 10, ...u32(1), ...u32(2), ...u32(0), 0, 0]],
    ['an element missing', [1, 10, ...u32(1), ...u32(0), ...u32(0)]],
    ["an object's size not its members'", [1, 11, ...u32(1), ...u32(7), ...u32(0), ...u32(1), 0x61, 0, 0]],
    [
      'a directory unsorted',
      [1, 11, ...u32(2), ...u32(12), ...u32(0), ...u32(6), ...u32(1), 0x62, 0, ...u32(1), 0x61, 0],
    ],
    ['a directory of no member', [1, 11, ...u32(1), ...u32(6), ...u32(1), ...u32(1), 0x61, 0]],
    [
      'a directory listing one twice',
      [1, 11, ...u32(2), ...u32(12), ...u32(0), ...u32(0), ...u32(1), 0x61, 0, ...u32(1), 0x61, 0],
    ],
    ['a member with no value', [1, 11, ...u32(1), ...u32(5), ...u32(0), ...u32(1), 0x61]],
  ];
  for (const [why, bytes] of damaged) {
    assert.throws(() => stored(bytes), isDamage, why);
  }
  const sorted = [1, 11, ...u32(2), ...u32(12), ...u32(6), ...u32(0), ...u32(1), 0x62, 0, ...u32(1), 0x61, 0];
  assert.deepEqual(
    stored(sorted).item(),
    new JsonObject([
      ['b', null],
      ['a', null],
    ]),
  );
});

/** Verifies: [PROTOCOL JSON values] the page's example: `{"a":[1,"x"]}` is its 51 octets, and the directory of `{"b":1,"a":2}` puts `a` first, its members in written order. */
test("the page's examples", () => {
  const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString('hex').toUpperCase();
  const example =
    '01' +
    '0B' +
    '01000000' +
    '25000000' +
    '00000000' +
    '0100000061' +
    '0A' +
    '02000000' +
    '0F000000' +
    '00000000' +
    '09000000' +
    '03' +
    '0100000000000000' +
    '08' +
    '0100000078';
  const written = Json.of({ a: [1n, 'x'] }).bytes;
  assert.equal(written.byteLength, 51);
  assert.equal(hex(written), example);
  const twoKeys = Json.of({ b: 1n, a: 2n }).bytes;
  assert.equal(hex(twoKeys.subarray(10, 18)), '0E000000' + '00000000', 'member a at 14, then b at 0');
  const item = Json.ofBytes(twoKeys).item();
  assert.ok(item instanceof JsonObject);
  assert.deepEqual(
    item.members.map(([k]) => k),
    ['b', 'a'],
  );
});

/** Verifies: [PROTOCOL JSON values] an exact number is written in the narrowest of its nodes, and a decimal keeps the scale it was written with: 1.50 is units 150, scale 2. */
test('a decimal keeps its scale', () => {
  const bytes = Json.of(new Decimal(150n, 2)).bytes;
  assert.deepEqual([...bytes], [1, 4, 150, 0, 0, 0, 0, 0, 0, 0, 2], 'node 4, units 150, scale 2');
  const back = Json.ofBytes(bytes).item();
  assert.ok(back instanceof Decimal);
  assert.equal(String(back), '1.50');
  assert.equal(Json.of(new Decimal(15n, 0)).bytes[1], 3, 'scale 0, an integer');
  assert.equal(Json.of(new Decimal(1n, 300)).bytes[1], 5, 'a scale past an octet, a wide decimal');
  assert.equal(Json.of(new Decimal(2n ** 70n, 2)).bytes[1], 5, 'units past an i64, a wide decimal');
});

/** Verifies: [PROTOCOL JSON values] a document is at most 256 MiB: one longer is refused as it is written. */
test('a document is at most 256 MiB', () => {
  const most = 268_435_456;
  // A string's node is its tag and length, after the version octet.
  const fits = 'x'.repeat(most - 6);
  assert.equal(Json.of(fits).bytes.byteLength, most);
  assert.throws(() => Json.of(`${fits}x`), isFailure(-900, '0A000'));
});
