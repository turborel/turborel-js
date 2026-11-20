/**
 * Tests of the protocol's values: each written and read back, its bytes
 * where the spec prints them, and malformed ones refused
 * (RULES.md R-TEST-2).
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DecFloat } from '../../src/codec/decfloat.js';
import { Decimal } from '../../src/codec/decimal.js';
import { Json } from '../../src/codec/json.js';
import { Reader } from '../../src/codec/reader.js';
import { readValue, writeValue } from '../../src/codec/value-codec.js';
import {
  Datetime,
  Interval,
  Lob,
  LobLocator,
  Multiset,
  PluginValue,
  Reference,
  SqlRow,
  Structured,
  Uuid,
  type Value,
  Xml,
} from '../../src/codec/values.js';
import { Writer } from '../../src/codec/writer.js';
import { isConnectionFailure, isFailure } from '../support/failures.js';

/**
 * The bytes of `v`.
 *
 * @param v - the value
 * @returns its bytes
 */
function bytesOf(v: Value): Uint8Array {
  const w = new Writer();
  writeValue(w, v);
  return w.finish();
}

/**
 * The value `bytes` hold, all of them read.
 *
 * @param bytes - a value's bytes
 * @returns the value
 */
function valueOf(bytes: Uint8Array | number[]): Value {
  const r = new Reader(bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes), 'reply');
  const v = readValue(r);
  r.finish();
  return v;
}

/**
 * Checks that `v` reads back as written, and that its bytes are written again the same.
 *
 * @param v - the value
 */
function roundTrip(v: Value): void {
  const bytes = bytesOf(v);
  const again = valueOf(bytes);
  assert.deepEqual(again, v);
  assert.deepEqual(bytesOf(again), bytes);
}

const I128_MAX = 2n ** 127n - 1n;
const I128_MIN = -(2n ** 127n);

/** Verifies: [PROTOCOL A worked example] the exact number 1, units 1 and scale 0, is tag 2 then 16 bytes of units then 4 of scale. */
test("the worked example's exact number", () => {
  const one = [2, 1, ...new Array<number>(15).fill(0), 0, 0, 0, 0];
  assert.deepEqual(bytesOf(1n), Uint8Array.from(one));
  assert.equal(valueOf(one), 1n);
});

/** Verifies: [PROTOCOL Values] an exact number's units i128 and scale u32 reach a bigint or a Decimal with no loss, the whole range of each. */
test('exact numbers keep every digit', () => {
  for (const v of [0n, -1n, I128_MAX, I128_MIN, new Decimal(I128_MAX, 0xffff_ffff), new Decimal(-12_345n, 2)]) {
    roundTrip(v);
  }
  assert.deepEqual(valueOf(bytesOf(new Decimal(5n, 0))), 5n, 'scale 0 is a bigint');
  assert.throws(() => bytesOf(I128_MAX + 1n), isFailure(-301, '22003'));
});

/** Verifies: [PROTOCOL Values] null, a character string, a truth value, a binary string and an approximate number, each its tag and body. */
test('the plain values', () => {
  assert.deepEqual(bytesOf(null), Uint8Array.of(0));
  assert.deepEqual(bytesOf('é'), Uint8Array.of(1, 2, 0, 0, 0, 0xc3, 0xa9));
  assert.deepEqual(bytesOf(true), Uint8Array.of(14, 1));
  assert.deepEqual(bytesOf(Uint8Array.of(0xab, 0)), Uint8Array.of(6, 2, 0, 0, 0, 0xab, 0));
  for (const v of [null, '', 'abcd', false, true, new Uint8Array(0), Uint8Array.of(0xab, 0, 0xc0)]) roundTrip(v);
  assert.throws(() => valueOf([14, 2]), isFailure(-916, 'TB916'), 'a truth value of 2');
});

/** Verifies: [PROTOCOL Values] an approximate number keeps its double's bits: -0.0, NaN, the largest and the least. */
test('approximate numbers keep their bits', () => {
  assert.deepEqual(bytesOf(-0), Uint8Array.of(3, 0, 0, 0, 0, 0, 0, 0, 0x80));
  assert.ok(Object.is(valueOf(bytesOf(-0)), -0));
  assert.ok(Number.isNaN(valueOf(bytesOf(Number.NaN))));
  for (const x of [Number.MAX_VALUE, -Number.MIN_VALUE, Number.POSITIVE_INFINITY, -0.5, 1.5]) roundTrip(x);
});

/** Verifies: [PROTOCOL Values] a datetime is zoned, precision, its displacement's i16 bits in the low half of a u32, and microseconds in UTC. */
test('datetimes', () => {
  const late = new Datetime({ moment: 'time', zoned: true, precision: 1, zone: -779, utc: 86_399_500_000n });
  assert.deepEqual(bytesOf(late), Uint8Array.of(9, 1, 1, 0xf5, 0xfc, 0, 0, 0xe0, 0xbe, 0xcf, 0x1d, 0x14, 0, 0, 0));
  roundTrip(late);
  roundTrip(new Datetime({ moment: 'date', zoned: false, precision: 0, zone: 0, utc: -62_135_596_800_000_000n }));
  roundTrip(new Datetime({ moment: 'timestamp', zoned: true, precision: 6, zone: 840, utc: 2n ** 63n - 1n }));
  roundTrip(new Datetime({ moment: 'timestamp', zoned: false, precision: 255, zone: -32_768, utc: -(2n ** 63n) }));
  assert.throws(
    () => valueOf([11, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
    isConnectionFailure,
    'a displacement past 16 bits',
  );
  assert.throws(
    () => new Datetime({ moment: 'date', zoned: false, precision: 0, zone: 32_768, utc: 0n }),
    isFailure(-910, 'TB910'),
  );
  assert.throws(
    () => new Datetime({ moment: 'date', zoned: false, precision: 256, zone: 0, utc: 0n }),
    isFailure(-910, 'TB910'),
  );
  assert.throws(
    () => new Datetime({ moment: 'date', zoned: false, precision: 0, zone: 0, utc: 2n ** 63n }),
    isFailure(-910, 'TB910'),
  );
});

/** Verifies: [PROTOCOL Values] an interval is its qualifier, as the INTERVAL type writes it, then units i128. */
test('intervals', () => {
  const months = new Interval({ start: 'YEAR', end: 'MONTH', leading: 2, fraction: 0 }, -14n);
  const bytes = bytesOf(months);
  assert.deepEqual(bytes.subarray(0, 17), Uint8Array.of(13, 0, 0, 0, 0, 1, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0));
  roundTrip(months);
  roundTrip(new Interval({ start: 'DAY', end: 'SECOND', leading: 9, fraction: 6 }, I128_MIN));
  assert.throws(
    () => new Interval({ start: 'DAY', end: 'DAY', leading: 2, fraction: 0 }, I128_MAX + 1n),
    isFailure(-301, '22003'),
  );
});

/** Verifies: [PROTOCOL Values] a DECFLOAT is coefficient i128 then exponent i32 as u32, in its one form, and any other form fails the connection. */
test('decimal floating point', () => {
  const d = DecFloat.of(-15n, -1);
  assert.deepEqual(bytesOf(d), Uint8Array.of(15, 0xf1, ...new Array<number>(15).fill(0xff), 0xff, 0xff, 0xff, 0xff));
  roundTrip(d);
  roundTrip(DecFloat.of(1n, 6144));
  roundTrip(DecFloat.of(0n, 0));
  const trailing = [15, 150, ...new Array<number>(15).fill(0), 0xfe, 0xff, 0xff, 0xff];
  assert.throws(() => valueOf(trailing), isConnectionFailure, 'not its one form');
});

/** Verifies: [PROTOCOL Values] arrays, rows, multisets and structured values are lists of values, nested. */
test('constructed values', () => {
  roundTrip([true, null, [1n, ['x']]]);
  roundTrip([]);
  roundTrip(new SqlRow(['x', new Decimal(15n, 1)]));
  roundTrip(new Multiset([1n, null, new Multiset([])]));
  roundTrip(new Structured({ schema: 'S', name: 'POINT' }, [1.5, new Structured({ schema: 'S', name: 'T' }, [])]));
  assert.deepEqual(bytesOf([null, 1n]).subarray(0, 7), Uint8Array.of(16, 2, 0, 0, 0, 0, 2));
  assert.deepEqual(bytesOf(new SqlRow([])), Uint8Array.of(17, 0, 0, 0, 0));
  assert.deepEqual(bytesOf(new Multiset([])), Uint8Array.of(22, 0, 0, 0, 0));
});

/** Verifies: [DESIGN] D1 values nest at most 16 deep, as turborel-protocol reads them, and a multiset holds at most 65,535 elements. */
test('constructed values are bounded', () => {
  const nested = (depth: number): Value => (depth === 0 ? null : [nested(depth - 1)]);
  roundTrip(nested(16));
  assert.throws(() => valueOf(bytesOf(nested(17))), isConnectionFailure);
  const most = new Multiset(new Array<Value>(65_535).fill(null));
  assert.equal((valueOf(bytesOf(most)) as Multiset).elements.length, 65_535);
  assert.throws(() => valueOf(bytesOf(new Multiset(new Array<Value>(65_536).fill(null)))), isConnectionFailure);
});

/** Verifies: [PROTOCOL Values] a large object comes whole, of its kind and octets, or by its locator, octets and characters. */
test('large objects', () => {
  assert.deepEqual(bytesOf(new Lob('aé')), Uint8Array.of(20, 0, 3, 0, 0, 0, 0x61, 0xc3, 0xa9));
  assert.deepEqual(bytesOf(new Lob(Uint8Array.of(0, 0xff))), Uint8Array.of(20, 1, 2, 0, 0, 0, 0, 0xff));
  const located = new LobLocator('character', 7, { octets: 300n, characters: 200n });
  assert.deepEqual(bytesOf(located).subarray(0, 6), Uint8Array.of(21, 0, 7, 0, 0, 0));
  for (const v of [
    new Lob('aé'),
    new Lob(new Uint8Array(0)),
    located,
    new LobLocator('binary', 0xffff_ffff, { octets: 2n ** 64n - 1n, characters: 0n }),
  ]) {
    roundTrip(v);
  }
  assert.throws(() => valueOf([20, 2, 0, 0, 0, 0]), isConnectionFailure, 'no such kind');
  assert.throws(() => valueOf([20, 0, 1, 0, 0, 0, 0xff]), isConnectionFailure, 'a character one not UTF-8');
  assert.deepEqual(valueOf([20, 1, 1, 0, 0, 0, 0xff]), new Lob(Uint8Array.of(0xff)), 'a binary one of any octets');
  assert.throws(() => new LobLocator('binary', -1, { octets: 0n, characters: 0n }), isFailure(-910, 'TB910'));
  assert.throws(() => new LobLocator('binary', 1, { octets: -1n, characters: 0n }), isFailure(-910, 'TB910'));
});

/** Verifies: [PROTOCOL Values] a reference is bytes, an XML value its serialization as CONTENT, a string. */
test('references and XML', () => {
  assert.deepEqual(bytesOf(new Reference(Uint8Array.of(9))), Uint8Array.of(24, 1, 0, 0, 0, 9));
  assert.deepEqual(bytesOf(new Xml('<b/>')), Uint8Array.of(26, 4, 0, 0, 0, 0x3c, 0x62, 0x2f, 0x3e));
  roundTrip(new Reference(new Uint8Array(0)));
  roundTrip(new Xml('<a>&lt;</a>'));
  assert.equal(String(new Xml('<b/>')), '<b/>');
});

/** Verifies: [PROTOCOL Values] a UUID is tag 27, a count of 16, then its 16 octets, and any other count fails (CONFORMANCE.md G1). */
test('UUIDs', () => {
  const id = Uuid.parse('919108f7-52d1-4320-9bac-f847db4148a8');
  assert.equal(id.toString(), '919108f7-52d1-4320-9bac-f847db4148a8');
  assert.equal(Uuid.parse('919108F7-52D1-4320-9BAC-F847DB4148A8').toString(), id.toString());
  assert.equal(JSON.stringify({ id }), '{"id":"919108f7-52d1-4320-9bac-f847db4148a8"}');
  assert.deepEqual(bytesOf(id), Uint8Array.of(27, 16, 0, 0, 0, ...id.octets));
  roundTrip(id);
  assert.throws(() => valueOf([27, 15, 0, 0, 0, ...new Array<number>(15).fill(7)]), isConnectionFailure);
  assert.throws(() => new Uuid(new Uint8Array(15)), isFailure(-910, 'TB910'));
  assert.throws(() => Uuid.parse('919108f752d143209bacf847db4148a8'), isFailure(-910, 'TB910'));
});

/** Verifies: [PROTOCOL Values] a plug-in's value is its type's name, its text and its bytes, kept and sent back unchanged. */
test('plug-in values travel unchanged', () => {
  const point = new PluginValue('POINT', '(1, 2)', Uint8Array.of(1, 2));
  assert.deepEqual(bytesOf(point).subarray(0, 10), Uint8Array.of(4, 5, 0, 0, 0, 0x50, 0x4f, 0x49, 0x4e, 0x54));
  roundTrip(point);
  assert.equal(String(point), '(1, 2)');
});

/** Verifies: [PROTOCOL Values] a JSON value is tag 25 and its stored form as bytes; damaged octets fail as a value that cannot be taken (TB916), not the connection (CONFORMANCE.md G3). */
test('JSON values travel as their tree', () => {
  const doc = Json.of({ a: 1n });
  assert.deepEqual(bytesOf(doc).subarray(0, 6), Uint8Array.of(25, doc.bytes.byteLength, 0, 0, 0, 1));
  roundTrip(doc);
  assert.throws(() => valueOf([25, 2, 0, 0, 0, 2, 0]), isFailure(-916, 'TB916'), 'version 2');
  assert.throws(() => valueOf([25, 1, 0, 0, 0, 1]), isFailure(-916, 'TB916'), 'no root');
});

/** Verifies: [PROTOCOL Values] a tag of no value fails the connection; tags 18 and 19, a large object's stored form, fail as a value that cannot be taken (RULES.md D8); a JavaScript value the protocol carries none of is never written. */
test('values of no tag are refused', () => {
  for (const t of [28, 99]) {
    assert.throws(() => valueOf([t]), isConnectionFailure, String(t));
  }
  for (const t of [18, 19]) {
    assert.throws(() => valueOf([t]), isFailure(-916, 'TB916'), String(t));
  }
  for (const v of [undefined, new Date(0), new Map(), Symbol('x'), () => 1]) {
    assert.throws(() => bytesOf(v as unknown as Value), isFailure(-910, 'TB910'));
  }
});

/** Verifies: [PROTOCOL Values] value tags 5, 7, 10 and 12 are read as tags 1, 6, 9 and 11, as turborel-protocol's reader takes them. */
test('the tags of the types beside', () => {
  const as = (tag: number, written: Value): Value => {
    const bytes = bytesOf(written);
    bytes[0] = tag;
    return valueOf(bytes);
  };
  assert.equal(as(5, 'text'), 'text');
  assert.deepEqual(as(7, Uint8Array.of(1, 2)), Uint8Array.of(1, 2));
  const time = new Datetime({ moment: 'time', zoned: true, precision: 0, zone: 60, utc: 3_600_000_000n });
  assert.deepEqual(as(10, time), time);
  const stamp = new Datetime({ moment: 'timestamp', zoned: true, precision: 3, zone: 0, utc: 1n });
  assert.deepEqual(as(12, stamp), stamp);
});
