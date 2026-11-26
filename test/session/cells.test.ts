/**
 * Tests of rows gathered by column for a CopyColumns
 * (`[PROTOCOL CopyColumns 'O']`).
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { encodeRequest } from '../../src/codec/requests.js';
import { ALL_CAPABILITIES, COLUMNS } from '../../src/session/capabilities.js';
import { Cells } from '../../src/session/cells.js';
import { Offer } from '../../src/session/told.js';
import { isFailure } from '../support/failures.js';

/** Verifies: [PROTOCOL Capabilities] `columns` is a capability, the last of version 1's twenty-two, asked for by default. */
test('columns is asked for', () => {
  assert.deepEqual([ALL_CAPABILITIES.at(-1), ALL_CAPABILITIES.length], [COLUMNS, 22]);
  assert.ok(Offer.default().capabilities.includes(COLUMNS));
});

/** Verifies: [PROTOCOL CopyColumns 'O'] rows by column: a byte of null bits for each eight rows, row 0 the low bit, no bit past the last row; an end for each row, a null cell's the one before it, the last the text's length; the cells' UTF-8 one after another; as the sample copy-columns holds it. */
test('rows gathered by column', () => {
  const cells = new Cells();
  cells.add(['1', 'b']);
  cells.add([null, '']);
  assert.deepEqual([cells.rows, cells.octets], [2, 18]);
  const sample = Buffer.from(
    '4F3400000002000000020000000100000002020000000100000001000000010000003101000000000200000001000000010000000100000062',
    'hex',
  );
  assert.deepEqual(encodeRequest(cells.take()), Uint8Array.from(sample));
  assert.equal(cells.rows, 0, 'taken');
  for (let i = 0; i < 9; i += 1) cells.add([i % 2 === 0 ? null : 'é']);
  const nine = cells.take();
  assert.ok(nine.kind === 'copyColumns');
  assert.deepEqual([...(nine.columns[0]?.nulls ?? [])], [0b0101_0101, 0b1]);
  assert.deepEqual(nine.columns[0]?.ends, [0, 2, 2, 4, 4, 6, 6, 8, 8]);
  cells.add(['a', 'b']);
  assert.throws(
    () => {
      cells.add(['a']);
    },
    isFailure(-910, 'TB910'),
  );
  assert.throws(
    () => {
      new Cells().add([]);
    },
    isFailure(-910, 'TB910'),
  );
});
