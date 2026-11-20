/**
 * Tests of delimited text as an import's source, the cases of
 * turborel-client's `import/delimited/tests.rs` (RULES.md R-TEST-2).
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DEFAULT_MAX_RECORD, Delimited, Dialect } from '../../src/import/delimited.js';
import { type Position, SourceError } from '../../src/import/source.js';
import { isFailure } from '../support/failures.js';

/** A field as read: its text, or null. */
type Got = string | null;

/**
 * Each record of `text`, its fields and position.
 *
 * @param text - the input, whole
 * @param dialect - how it is written
 * @param chunk - the octets of each chunk the input comes in
 * @returns the records
 */
async function read(text: string | Uint8Array, dialect: Dialect, chunk = 3): Promise<[Got[], Position][]> {
  const bytes = typeof text === 'string' ? Buffer.from(text) : text;
  const chunks = Array.from({ length: Math.ceil(bytes.byteLength / chunk) }, (_, i) =>
    bytes.subarray(i * chunk, (i + 1) * chunk),
  );
  const source = new Delimited(chunks, dialect);
  const all: [Got[], Position][] = [];
  for (let r = await source.record(); r !== undefined; r = await source.record()) {
    all.push([r.values.map((v) => (typeof v === 'string' ? v : null)), r.position]);
  }
  return all;
}

/**
 * The fields of each record of `text`.
 *
 * @param text - the input
 * @param dialect - how it is written
 * @returns the fields
 */
async function fields(text: string, dialect: Dialect): Promise<Got[][]> {
  return (await read(text, dialect)).map(([f]) => f);
}

/**
 * The failure reading `text` gives.
 *
 * @param text - the input
 * @param dialect - how it is written
 * @returns it
 */
async function error(text: string | Uint8Array, dialect: Dialect): Promise<SourceError> {
  try {
    await read(text, dialect);
  } catch (e) {
    if (e instanceof SourceError) return e;
    throw e;
  }
  throw new Error('no failure');
}

/** Verifies: [CLIENT Importing] CSV's records end at CR LF or LF, the last's optional; fields split at commas, spaces kept; a quoted field holds commas, line breaks and doubled quotes; an empty field null, empty quotes the empty string. */
test('CSV records and fields', async () => {
  const csv = Dialect.csv();
  assert.deepEqual(await fields('a,b\r\nc,d\n', csv), [
    ['a', 'b'],
    ['c', 'd'],
  ]);
  assert.deepEqual(await fields('a,b\nc,d', csv), [
    ['a', 'b'],
    ['c', 'd'],
  ]);
  assert.deepEqual(await fields(' a , b ', csv), [[' a ', ' b ']]);
  assert.deepEqual(await fields('"a,b","say ""hi"""', csv), [['a,b', 'say "hi"']]);
  assert.deepEqual(await fields('"one\r\ntwo\nthree",x\n', csv), [['one\r\ntwo\nthree', 'x']]);
  assert.deepEqual(await fields(',"",', csv), [[null, '', null]]);
  assert.deepEqual(await fields('a\n\nb\n', csv), [['a'], [null], ['b']]);
  assert.deepEqual(await fields('""""', csv), [['"']]);
  assert.deepEqual(await fields('', csv), []);
  assert.deepEqual(await fields('é,\u{1F600}', csv), [['é', '\u{1F600}']]);
});

/** Verifies: [CLIENT Importing] the text for null is null only not in quotes; a byte order mark beginning the input is passed over, and nowhere else. */
test('CSV null text and byte order mark', async () => {
  assert.deepEqual(await fields('NULL,"NULL",,null', Dialect.csv().withNull('NULL')), [[null, 'NULL', '', 'null']]);
  assert.deepEqual(await fields('\u{FEFF}a,b\n\u{FEFF}c', Dialect.csv()), [['a', 'b'], ['\u{FEFF}c']]);
});

/** Verifies: [CLIENT Importing] a header names the fields, read once; records are numbered from the first after it, each saying the line it began on; a header missing is refused. */
test('CSV header and positions', async () => {
  const text = 'ID,"FULL NAME"\n1,"Ada\nLovelace"\n2,Grace\n';
  const source = new Delimited([Buffer.from(text)], Dialect.csv().withHeader());
  const headings = await source.headings();
  assert.deepEqual(
    headings?.map((h) => h.name),
    ['ID', 'FULL NAME'],
  );
  assert.equal(await source.headings(), undefined, 'read once');
  const positions: Position[] = [];
  for (let r = await source.record(); r !== undefined; r = await source.record()) positions.push(r.position);
  assert.deepEqual(positions, [
    { record: 1, line: 2 },
    { record: 2, line: 4 },
  ]);
  assert.equal(await source.record(), undefined, 'none again after the end');
  assert.deepEqual(await fields(text, Dialect.csv().withHeader()), [
    ['1', 'Ada\nLovelace'],
    ['2', 'Grace'],
  ]);
  const missing = await new Delimited([], Dialect.csv().withHeader()).headings().catch((e: unknown) => e);
  assert.ok(missing instanceof SourceError);
  assert.deepEqual(missing.at, { record: 0, line: 1 });
  assert.equal(missing.message, 'record 0, line 1: there is no header');
  assert.equal(await new Delimited([Buffer.from('a')], Dialect.csv()).headings(), undefined, 'no header unless told');
});

/** Verifies: [CLIENT Importing] a quote in a field not quoted, more after a closing quote, a quote left open and a field not UTF-8 are refused, saying the record, its line and the field; nothing more after. */
test('CSV errors say where', async () => {
  const csv = Dialect.csv();
  const quote = await error('a\nb,c"d\n', csv);
  assert.deepEqual(quote.at, { record: 2, line: 2 });
  assert.equal(quote.why, '[RFC 4180 §2 rule 5] field 2: a quote in a field not enclosed in quotes');
  const after = await error('"a"b,c', csv);
  assert.equal(after.why, "[RFC 4180 §2 rule 5] field 1: a quoted field's closing quote is followed by more");
  const open = await error('a\nb\n"c\nd\ne\n', csv);
  assert.deepEqual(open.at, { record: 3, line: 3 }, 'where the record began');
  assert.equal(open.why, '[RFC 4180 §2 rule 5] a quoted field is not closed');
  assert.equal((await error('"c', csv)).why, '[RFC 4180 §2 rule 5] a quoted field is not closed');
  const bytes = await error(Uint8Array.of(0x6f, 0x6b, 0x2c, 0xff, 0xfe), csv);
  assert.equal(bytes.message, 'record 1, line 1: field 2 is not UTF-8');
  assert.equal((await error(Uint8Array.of(0x6f, 0x6b, 0x09, 0xff), Dialect.tsv())).why, 'field 2 is not UTF-8');
  assert.ok(isFailure(-301, '22000')(bytes));
  const source = new Delimited([Buffer.from('"a"b\nc\n')], csv);
  await assert.rejects(source.record());
  assert.equal(await source.record(), undefined, 'nothing more after an error');
});

/** Verifies: [CLIENT Importing] a record longer than the bound is refused once the bound is read, an unclosed quote among them; a record of the bound is read. */
test('a record is bounded', async () => {
  const bound = Dialect.csv().withMaxRecord(8);
  assert.deepEqual(await fields('1234567\n', bound), [['1234567']], 'eight octets, the line break counted');
  assert.equal((await error('12345678\n', bound)).why, 'the record is longer than 8 bytes');
  assert.equal((await error(`"${'x'.repeat(20)}`, bound)).why, 'the record is longer than 8 bytes');
  assert.equal(DEFAULT_MAX_RECORD, 16_777_216);
  const failing = new Delimited(
    (async function* (): AsyncGenerator<Uint8Array> {
      yield Buffer.from('a,');
      await Promise.resolve();
      throw new Error('the disk is gone');
    })(),
    Dialect.csv(),
  );
  const gone = await failing.record().catch((e: unknown) => e);
  assert.ok(gone instanceof SourceError);
  assert.equal(gone.why, 'the disk is gone');
});

/** Verifies: [CLIENT Importing] tab-separated text has no quoting; a delimiter is one ASCII character, not a quote or a line break. */
test('tab-separated text and delimiters', async () => {
  assert.deepEqual(await fields('a\t"b"\t\nc', Dialect.tsv()), [['a', '"b"', null], ['c']]);
  assert.deepEqual(await fields('a;b', Dialect.csv().withDelimiter(';')), [['a', 'b']]);
  for (const bad of ['"', '\n', '\r', 'é', ';;', '']) {
    assert.throws(() => Dialect.csv().withDelimiter(bad), isFailure(-910, 'TB910'), JSON.stringify(bad));
  }
});
