/**
 * Tests of the declared types of `[PROTOCOL Declared types]`: tail 19 of
 * Prepared and Description, read and written, and a column's type as SQL
 * writes it, declared or as its tag says.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Column } from '../../src/codec/composite.js';
import {
  columnType,
  columnTypeName,
  readColumns,
  typeName,
  typeWritten,
  writeColumns,
} from '../../src/codec/declared.js';
import { decodeReply } from '../../src/codec/replies.js';
import { Reader } from '../../src/codec/reader.js';
import type { DataType } from '../../src/codec/types.js';
import { Writer } from '../../src/codec/writer.js';
import { ALL_CAPABILITIES, DECLARED_TYPES } from '../../src/session/capabilities.js';
import { Offer } from '../../src/session/told.js';
import { isConnectionFailure } from '../support/failures.js';

/** An INTEGER column, as its tag writes it, and as it was declared. */
const INTEGER: DataType = { kind: 'exact', precision: 10, scale: 0 };

/**
 * The columns `columns` written, then read back.
 *
 * @param columns - the columns
 * @returns their bytes and what they read as
 */
function roundTrip(columns: readonly Column[]): { bytes: Uint8Array; read: Column[] } {
  const w = new Writer();
  writeColumns(w, columns);
  const bytes = w.finish();
  const r = new Reader(bytes, 'reply');
  const read = readColumns(r);
  r.finish();
  return { bytes, read };
}

/** Verifies: [PROTOCOL Capabilities] `declared-types` is a capability, the nineteenth of version 1's, asked for by default as turborel-client's `connect` asks. */
test('declared-types is asked for', () => {
  assert.equal(DECLARED_TYPES, 'declared-types');
  assert.equal(ALL_CAPABILITIES.at(-2), DECLARED_TYPES);
  assert.ok(Offer.default().capabilities.includes(DECLARED_TYPES));
});

/** Verifies: [PROTOCOL Declared types] [PROTOCOL The tail] tail 19 is a count, then each column's type name and its type as SQL writes it; without it, the columns alone, byte for byte as before. */
test('tail 19 declares each column', () => {
  const integer: Column = { name: 'I', type: INTEGER, notNull: true };
  const truth: Column = { type: { kind: 'boolean' }, notNull: false };
  const plain = [integer, truth];
  const before = roundTrip(plain);
  assert.deepEqual(before.read, plain, 'none declared');
  const declared = [{ ...integer, declared: { name: 'INTEGER', written: 'INTEGER' } }, truth];
  const told = roundTrip(declared);
  assert.deepEqual(told.bytes.subarray(0, before.bytes.byteLength), before.bytes, 'the columns as before');
  const tail = [...told.bytes.subarray(before.bytes.byteLength)];
  assert.deepEqual(tail.slice(0, 5), [19, 2, 0, 0, 0], 'tag 19, then one for each column');
  assert.deepEqual(told.read, [declared[0], { ...truth, declared: { name: 'BOOLEAN', written: 'BOOLEAN' } }]);
});

/** Verifies: [PROTOCOL Declared types] Prepared and Description carry tail 19; one not one for each column, or any other tag, fails the connection. */
test('Prepared and Description take tail 19', () => {
  const w = new Writer();
  writeColumns(w, [{ name: 'K', type: INTEGER, notNull: false, declared: { name: 'INTEGER', written: 'INTEGER' } }]);
  const columns = w.finish();
  const description = decodeReply('D'.charCodeAt(0), columns);
  assert.ok(description.kind === 'description');
  assert.deepEqual(description.columns[0]?.declared, { name: 'INTEGER', written: 'INTEGER' });
  const prepared = decodeReply('P'.charCodeAt(0), Uint8Array.of(1, 0, 0, 0, 0, 0, 0, 0, ...columns));
  assert.ok(prepared.kind === 'prepared');
  assert.equal(prepared.columns[0] === undefined ? undefined : columnType(prepared.columns[0]), 'INTEGER');
  const two = new Writer().u32(1).flag(false).u8(14).flag(false).u8(19).u32(2).finish();
  assert.throws(() => decodeReply('D'.charCodeAt(0), two), isConnectionFailure, 'two for one column');
  const other = new Writer().u32(0).u8(18).finish();
  assert.throws(() => decodeReply('D'.charCodeAt(0), other), isConnectionFailure, 'tag 18');
});

/** Verifies: [CLIENT Prepared statements] a column's type is written as it was declared where told, else as its tag says, so INTEGER is NUMERIC(10,0) and a REAL FLOAT(24). */
test('a type written, declared or as its tag says', () => {
  const told: Column = { name: 'I', type: INTEGER, notNull: false, declared: { name: 'INTEGER', written: 'INTEGER' } };
  assert.deepEqual([columnType(told), columnTypeName(told)], ['INTEGER', 'INTEGER']);
  const untold: Column = { name: 'I', type: INTEGER, notNull: false };
  assert.deepEqual([columnType(untold), columnTypeName(untold)], ['NUMERIC(10,0)', 'NUMERIC']);
  const written: [DataType, string, string][] = [
    [{ kind: 'approximate', precision: 24 }, 'FLOAT(24)', 'FLOAT'],
    [{ kind: 'varying', length: 20, units: 'octets' }, 'CHARACTER VARYING(20 OCTETS)', 'CHARACTER VARYING'],
    [{ kind: 'clob', length: 9n, units: 'octets' }, 'CHARACTER LARGE OBJECT(9 OCTETS)', 'CHARACTER LARGE OBJECT'],
    [
      { kind: 'interval', qualifier: { start: 'SECOND', end: 'SECOND', leading: 2, fraction: 3 } },
      'INTERVAL SECOND(2, 3)',
      'INTERVAL',
    ],
    [
      { kind: 'interval', qualifier: { start: 'DAY', end: 'DAY', leading: 3, fraction: 0 } },
      'INTERVAL DAY(3)',
      'INTERVAL',
    ],
    [{ kind: 'multiset', element: INTEGER }, 'NUMERIC(10,0) MULTISET', 'MULTISET'],
    [{ kind: 'plugin', name: 'ST_GEOMETRY', parameters: [] }, 'ST_GEOMETRY', 'ST_GEOMETRY'],
    [{ kind: 'structured', name: { schema: 'S', name: 'T', supertypes: [] } }, 'S.T', 'USER-DEFINED'],
    [{ kind: 'reference', referenced: { schema: 'S', name: 'T', supertypes: [] } }, 'REF(S.T)', 'REF'],
    [
      {
        kind: 'xml',
        primary: 'content',
        secondary: 'xmlschema',
        schema: { schema: 'S', name: 'PO', namespace: '', element: 'a"b' },
      },
      'XML(CONTENT(XMLSCHEMA ID S.PO NO NAMESPACE ELEMENT "a""b"))',
      'XML',
    ],
    [
      {
        kind: 'xml',
        primary: 'document',
        secondary: 'xmlschema',
        schema: { schema: 'S', name: 'PO', namespace: "it's" },
      },
      "XML(DOCUMENT(XMLSCHEMA ID S.PO NAMESPACE 'it''s'))",
      'XML',
    ],
  ];
  for (const [t, sql, name] of written) assert.deepEqual([typeWritten(t), typeName(t)], [sql, name]);
});
