/**
 * Tests of the fields messages are made of, written and read back, and
 * refused where malformed (RULES.md R-TEST-2).
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { MAX_NESTING, Reader } from '../../src/codec/reader.js';
import { Writer } from '../../src/codec/writer.js';
import { isConnectionFailure, isFailure } from '../support/failures.js';

/**
 * The bytes `write` writes.
 *
 * @param write - writes fields
 * @returns their bytes
 */
function written(write: (w: Writer) => void): Uint8Array {
  const w = new Writer();
  write(w);
  return w.finish();
}

/**
 * A reader of `bytes`.
 *
 * @param bytes - the body
 * @returns the reader
 */
function reader(...bytes: number[]): Reader {
  return new Reader(Uint8Array.from(bytes), 'reply');
}

/** Verifies: [PROTOCOL Values and fields] u8, u32 and u64 are 1, 4 or 8 bytes, least significant first. */
test('integers are little-endian', () => {
  const bytes = written((w) => w.u8(0xab).u32(0x0403_0201).u64(0x0807_0605_0403_0201n));
  assert.deepEqual(bytes, Uint8Array.of(0xab, 1, 2, 3, 4, 1, 2, 3, 4, 5, 6, 7, 8));
  const r = new Reader(bytes, 'reply');
  assert.deepEqual([r.u8(), r.u32(), r.u64()], [0xab, 0x0403_0201, 0x0807_0605_0403_0201n]);
  r.finish();
});

/** Verifies: [PROTOCOL Values and fields] `i32 as u32` and `i64 as u64` are the signed number's bits. */
test('signed numbers travel as their bits', () => {
  const bytes = written((w) =>
    w
      .i32(-1)
      .i64(-2n)
      .i32(-0x8000_0000)
      .i64(-(2n ** 63n)),
  );
  assert.deepEqual(
    bytes.subarray(0, 12),
    Uint8Array.of(0xff, 0xff, 0xff, 0xff, 0xfe, ...new Array<number>(7).fill(0xff)),
  );
  const r = new Reader(bytes, 'reply');
  assert.deepEqual([r.i32(), r.i64(), r.i32(), r.i64()], [-1, -2n, -0x8000_0000, -(2n ** 63n)]);
});

/** Verifies: [PROTOCOL Values and fields] an i128 is 16 bytes, two's complement, least significant first, its whole range kept. */
test('an i128 keeps its whole range', () => {
  const edges = [0n, 1n, -1n, 2n ** 127n - 1n, -(2n ** 127n), 2n ** 64n, -(2n ** 64n) - 1n];
  for (const n of edges) {
    assert.equal(
      new Reader(
        written((w) => w.i128(n)),
        'reply',
      ).i128(),
      n,
    );
  }
  assert.deepEqual(
    written((w) => w.i128(1n)),
    Uint8Array.of(1, ...new Array<number>(15).fill(0)),
  );
  assert.deepEqual(
    written((w) => w.i128(-1n)),
    new Uint8Array(16).fill(0xff),
  );
  assert.throws(() => written((w) => w.i128(2n ** 127n)), isFailure(-301, '22003'));
  assert.throws(() => written((w) => w.i128(-(2n ** 127n) - 1n)), isFailure(-301, '22003'));
});

/** Verifies: [PROTOCOL Values and fields] a flag is 0 or 1, and any other byte fails the connection. */
test('a flag is 0 or 1', () => {
  assert.deepEqual(
    written((w) => w.flag(true).flag(false)),
    Uint8Array.of(1, 0),
  );
  assert.equal(reader(1).flag(), true);
  assert.equal(reader(0).flag(), false);
  assert.throws(() => reader(2).flag(), isConnectionFailure);
});

/** Verifies: [PROTOCOL Values and fields] a string is its length in bytes, then its UTF-8; bytes their length, then them. */
test('strings and bytes carry their length', () => {
  const bytes = written((w) => w.string('é').bytes(Uint8Array.of(9, 8)).string(''));
  assert.deepEqual(bytes, Uint8Array.of(2, 0, 0, 0, 0xc3, 0xa9, 2, 0, 0, 0, 9, 8, 0, 0, 0, 0));
  const r = new Reader(bytes, 'reply');
  assert.deepEqual([r.string(), r.bytesField(), r.string()], ['é', Uint8Array.of(9, 8), '']);
  assert.equal(
    new Reader(
      written((w) => w.string('﻿a')),
      'reply',
    ).string(),
    '﻿a',
    'a BOM is a character',
  );
});

/** Verifies: [PROTOCOL Values and fields] a string not UTF-8 fails the connection; one with a lone surrogate is never written. */
test('a string is UTF-8 both ways', () => {
  assert.throws(() => reader(1, 0, 0, 0, 0xff).string(), isConnectionFailure);
  assert.throws(() => reader(3, 0, 0, 0, 0xed, 0xa0, 0x80).string(), isConnectionFailure, 'a surrogate in UTF-8');
  assert.throws(() => written((w) => w.string('\uD800')), isFailure(-301, '22021'));
});

/** Verifies: [PROTOCOL Values and fields] a list is its count then each item; strings a list of strings; a key 16 bytes alone. */
test('lists, strings and keys', () => {
  const key = Uint8Array.from({ length: 16 }, (_, i) => i);
  const bytes = written((w) => w.strings(['a', 'bc']).key(key));
  assert.deepEqual(bytes.subarray(0, 4), Uint8Array.of(2, 0, 0, 0));
  const r = new Reader(bytes, 'reply');
  assert.deepEqual(r.strings(), ['a', 'bc']);
  assert.deepEqual(r.key(), key);
  r.finish();
  assert.throws(() => written((w) => w.key(new Uint8Array(15))), isFailure(-910, 'TB910'));
  assert.throws(() => reader(1, 2).key(), isConnectionFailure, 'a key cut short');
});

/** Verifies: [PROTOCOL Values and fields] a count larger than what follows fails as the body runs out, reserving nothing for it. */
test('a false count fails without reserving memory', () => {
  const r = reader(0xff, 0xff, 0xff, 0xff, 1, 0, 0, 0, 0x41);
  assert.throws(() => r.strings(), isConnectionFailure);
  assert.throws(() => reader(0xff, 0xff, 0xff, 0xff).bytesField(), isConnectionFailure);
});

/** Verifies: [PROTOCOL Frames] a body cut short, or bytes left after its last field, fail the connection. */
test('a body must be read exactly', () => {
  assert.throws(() => reader(1, 2, 3).u32(), isConnectionFailure);
  assert.throws(() => {
    reader(1).finish();
  }, isConnectionFailure);
  const r = reader(1, 2);
  assert.deepEqual(r.rest(), Uint8Array.of(1, 2));
  assert.equal(r.atEnd(), true);
  assert.throws(() => reader().u8(), /a reply received is malformed at byte 0: it ends too soon/);
});

/** Verifies: [DESIGN] D1 arrays and rows nest at most as deep as turborel's MAX_TYPE_NESTING, 16, and deeper fails. */
test('nesting is bounded', () => {
  const r = reader();
  const descend = (depth: number): number => (depth === 0 ? 0 : 1 + r.nested(() => descend(depth - 1)));
  assert.equal(descend(MAX_NESTING), MAX_NESTING);
  assert.throws(() => descend(MAX_NESTING + 1), isConnectionFailure);
  assert.equal(descend(1), 1, 'the depth is restored after a failure');
});

/** Verifies: [PROTOCOL Values and fields] a field out of its range is never written. */
test('a field out of range is refused', () => {
  const api = isFailure(-910, 'TB910');
  assert.throws(() => written((w) => w.u8(256)), api);
  assert.throws(() => written((w) => w.u32(-1)), api);
  assert.throws(() => written((w) => w.u32(2 ** 32)), api);
  assert.throws(() => written((w) => w.i32(2 ** 31)), api);
  assert.throws(() => written((w) => w.u64(-1n)), api);
  assert.throws(() => written((w) => w.i64(2n ** 63n)), api);
  const w = new Writer();
  w.u32(0);
  assert.throws(() => {
    w.patchU32(0, -1);
  }, api);
  w.patchU32(0, 7);
  assert.deepEqual(w.finish(), Uint8Array.of(7, 0, 0, 0));
});

/** Verifies: [PROTOCOL Values and fields] a writer grows past its first buffer and keeps what it wrote. */
test('a long body is written whole', () => {
  const long = new Uint8Array(100_000).map((_, i) => i % 251);
  const w = new Writer().u8(1).bytes(long);
  assert.equal(w.length, 100_005);
  const r = new Reader(w.finish(), 'reply');
  assert.equal(r.u8(), 1);
  assert.deepEqual(r.bytesField(), long);
});
