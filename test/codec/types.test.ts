/**
 * Tests of the protocol's data types, each written and read back, its
 * bytes where the spec prints them, and malformed ones refused
 * (RULES.md R-TEST-2).
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Reader } from '../../src/codec/reader.js';
import { type DataType, readType, writeType } from '../../src/codec/types.js';
import { Writer } from '../../src/codec/writer.js';
import { isConnectionFailure } from '../support/failures.js';

/**
 * The bytes of `t`.
 *
 * @param t - the type
 * @returns its bytes
 */
function bytesOf(t: DataType): Uint8Array {
  const w = new Writer();
  writeType(w, t);
  return w.finish();
}

/**
 * The type `bytes` hold, all of them read.
 *
 * @param bytes - a type's bytes
 * @returns the type
 */
function typeOf(bytes: Uint8Array): DataType {
  const r = new Reader(bytes, 'reply');
  const t = readType(r);
  r.finish();
  return t;
}

/** One type of each kind, at the edges of its parameters. */
const EVERY_TYPE: DataType[] = [
  { kind: 'character', length: 1, units: 'characters' },
  { kind: 'exact', precision: 38, scale: 0xffff_ffff },
  { kind: 'approximate', precision: 53 },
  { kind: 'plugin', name: 'POINT', parameters: [] },
  { kind: 'plugin', name: 'BOX', parameters: [0, 0xffff_fffe] },
  { kind: 'varying', length: 0xffff_ffff, units: 'octets' },
  { kind: 'binary', length: 16 },
  { kind: 'varbinary', length: 0 },
  { kind: 'date', precision: 0 },
  { kind: 'time', precision: 2, zoned: false },
  { kind: 'time', precision: 0, zoned: true },
  { kind: 'timestamp', precision: 6, zoned: false },
  { kind: 'timestamp', precision: 3, zoned: true },
  { kind: 'interval', qualifier: { start: 'YEAR', end: 'MONTH', leading: 2, fraction: 0 } },
  { kind: 'interval', qualifier: { start: 'DAY', end: 'SECOND', leading: 9, fraction: 6 } },
  { kind: 'boolean' },
  { kind: 'decfloat', precision: 34 },
  {
    kind: 'array',
    maxCardinality: 65_535,
    element: { kind: 'array', maxCardinality: 1, element: { kind: 'boolean' } },
  },
  {
    kind: 'row',
    fields: [
      { name: 'X', type: { kind: 'character', length: 1, units: 'characters' } },
      { name: '', type: { kind: 'boolean' } },
    ],
  },
  { kind: 'clob', length: 2n ** 64n - 1n, units: 'octets' },
  { kind: 'blob', length: 1_048_576n, units: 'characters' },
  { kind: 'multiset', element: { kind: 'multiset', element: { kind: 'character', length: 2, units: 'characters' } } },
  { kind: 'structured', name: { schema: 'S', name: 'T', supertypes: [{ schema: 'S', name: 'BASE' }] } },
  { kind: 'reference', referenced: { schema: 'S', name: 'T', supertypes: [] } },
  { kind: 'reference', referenced: { schema: 'S', name: 'T', supertypes: [] }, scope: { schema: 'S', name: 'TT' } },
  { kind: 'json' },
  { kind: 'xml', primary: 'sequence', secondary: 'untyped' },
  { kind: 'xml', primary: 'document', secondary: 'any' },
  { kind: 'xml', primary: 'content', secondary: 'xmlschema', schema: { schema: 'A', name: 'S' } },
  {
    kind: 'xml',
    primary: 'document',
    secondary: 'xmlschema',
    schema: { schema: 'A', name: 'S', namespace: 'urn:s', element: 'e' },
  },
  { kind: 'uuid' },
];

/** Verifies: [PROTOCOL Data types] every kind of type reads back as written, at the edges of its parameters. */
test('every data type reads back as written', () => {
  for (const t of EVERY_TYPE) {
    assert.deepEqual(typeOf(bytesOf(t)), t, t.kind);
  }
});

/** Verifies: [PROTOCOL Data types] a type is its tag, then what its kind writes after it, little-endian. */
test('a type is its tag, then its parameters', () => {
  const cases: [DataType, number[]][] = [
    [{ kind: 'character', length: 4, units: 'characters' }, [1, 4, 0, 0, 0, 0]],
    [{ kind: 'varying', length: 4, units: 'octets' }, [5, 4, 0, 0, 0, 1]],
    [{ kind: 'exact', precision: 9, scale: 2 }, [2, 9, 0, 0, 0, 2, 0, 0, 0]],
    [{ kind: 'timestamp', precision: 6, zoned: true }, [12, 6, 0, 0, 0]],
    [{ kind: 'time', precision: 1, zoned: true }, [10, 1, 0, 0, 0]],
    [{ kind: 'boolean' }, [14]],
    [{ kind: 'json' }, [25]],
    [
      { kind: 'interval', qualifier: { start: 'HOUR', end: 'SECOND', leading: 2, fraction: 3 } },
      [13, 3, 0, 0, 0, 5, 0, 0, 0, 2, 0, 0, 0, 3, 0, 0, 0],
    ],
    [{ kind: 'array', maxCardinality: 1, element: { kind: 'boolean' } }, [16, 1, 0, 0, 0, 14]],
    [{ kind: 'multiset', element: { kind: 'boolean' } }, [22, 14]],
    [{ kind: 'clob', length: 10n, units: 'octets' }, [18, 10, 0, 0, 0, 0, 0, 0, 0, 1]],
    [{ kind: 'xml', primary: 'content', secondary: 'any' }, [26, 1, 1]],
  ];
  for (const [t, bytes] of cases) {
    assert.deepEqual(bytesOf(t), Uint8Array.from(bytes), t.kind);
  }
});

/** Verifies: [PROTOCOL Data types] UUID is type tag 27 with no parameters, as turborel-protocol writes it (CONFORMANCE.md G1). */
test('a UUID type is its tag alone', () => {
  assert.deepEqual(bytesOf({ kind: 'uuid' }), Uint8Array.of(27));
  assert.deepEqual(typeOf(Uint8Array.of(27)), { kind: 'uuid' });
});

/** Verifies: [PROTOCOL Data types] an interval's fields are numbered 0 YEAR to 5 SECOND, and any other fails the connection. */
test('an interval field is numbered 0 to 5', () => {
  const fields = ['YEAR', 'MONTH', 'DAY', 'HOUR', 'MINUTE', 'SECOND'] as const;
  fields.forEach((field, n) => {
    const t: DataType = { kind: 'interval', qualifier: { start: field, end: field, leading: 2, fraction: 0 } };
    assert.equal(bytesOf(t)[1], n);
  });
  assert.throws(() => typeOf(Uint8Array.of(13, 6, 0, 0, 0, 5, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0)), isConnectionFailure);
  assert.throws(() => typeOf(Uint8Array.of(13, 0, 0, 0, 0, 6, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0)), isConnectionFailure);
});

/** Verifies: [PROTOCOL Data types] a type of no tag, or malformed parameters, fails the connection. */
test('a malformed type fails the connection', () => {
  const malformed: [string, number[]][] = [
    ['no such tag', [99]],
    ['tag 20, a value tag alone', [20]],
    ['units of 2', [1, 1, 0, 0, 0, 2]],
    ['cardinality 0', [16, 0, 0, 0, 0, 14]],
    ['cardinality past 65,535', [16, 0, 0, 1, 0, 14]],
    ['a row of no fields', [17, 0, 0, 0, 0]],
    ['three parameters', [4, 1, 0, 0, 0, 0x50, 3, 0, 0, 0, 1, 0, 0, 0, 2, 0, 0, 0, 3, 0, 0, 0]],
    ["a parameter of u32's largest", [4, 1, 0, 0, 0, 0x50, 1, 0, 0, 0, 0xff, 0xff, 0xff, 0xff]],
    ['a scope flag of 2', [24, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2]],
    ['a secondary modifier of 3', [26, 0, 3]],
    ['a primary modifier of 3', [26, 3, 0]],
    ['SEQUENCE typed', [26, 2, 1]],
    ['SEQUENCE of an XML Schema', [26, 2, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]],
    ['no primary modifier of an XML Schema', [26, 7, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]],
    ['a namespace marked 2', [26, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 2]],
    ['cut short', [2, 9, 0, 0, 0]],
  ];
  for (const [why, bytes] of malformed) {
    assert.throws(() => typeOf(Uint8Array.from(bytes)), isConnectionFailure, why);
  }
});

/** Verifies: [DESIGN] D1 types nest at most 16 deep, as turborel-protocol reads them, and deeper fails the connection. */
test('types nest at most 16 deep', () => {
  const nested = (depth: number): DataType =>
    depth === 0 ? { kind: 'boolean' } : { kind: 'multiset', element: nested(depth - 1) };
  assert.deepEqual(typeOf(bytesOf(nested(16))), nested(16));
  assert.throws(() => typeOf(bytesOf(nested(17))), isConnectionFailure);
});
