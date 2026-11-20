/**
 * Tests of the SQL names an import writes: a table name made of
 * delimited identifiers, and the column a heading names (RULES.md R-TEST-2).
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { columnName, delimited, tableName } from '../../src/import/names.js';

/** Verifies: [CLIENT Importing] a table name of one to three identifiers, regular ones in upper case, is written as delimited identifiers; anything else is refused. */
test('table names', () => {
  assert.equal(tableName('staff'), '"STAFF"');
  assert.equal(tableName(' ann . "My Table" '), '"ANN"."My Table"');
  assert.equal(tableName('cat.ann.t_1 -- a comment'), '"CAT"."ANN"."T_1"');
  assert.equal(tableName('/* a /* nested */ comment */ t'), '"T"');
  assert.equal(tableName('"say ""hi"""'), '"say ""hi"""');
  assert.equal(tableName('été'), '"ÉTÉ"');
  for (const bad of [
    '',
    'a.b.c.d',
    'select',
    'a.',
    '.a',
    'a b',
    '"open',
    '""',
    "x'0A'",
    '1a',
    'a'.repeat(129),
    '"a\nb"',
  ]) {
    assert.throws(() => tableName(bad), /is not a <table name>/u, JSON.stringify(bad));
  }
  assert.equal(tableName('a_'.repeat(128)), `"${'A_'.repeat(128)}"`, 'underscores not counted');
});

/** Verifies: [CLIENT Importing] a heading names the identifier it is, a regular one in upper case, a key word too; anything else as written. */
test('column names', () => {
  assert.equal(columnName('id'), 'ID');
  assert.equal(columnName('order'), 'ORDER', 'a key word, as it would be one');
  assert.equal(columnName('"Full Name"'), 'Full Name');
  assert.equal(columnName('FULL NAME'), 'FULL NAME', 'two tokens, as written');
  assert.equal(columnName('a.b'), 'a.b');
  assert.equal(delimited('a"b'), '"a""b"');
});
