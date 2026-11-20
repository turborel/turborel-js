/**
 * Tests of how each value is shown and written as a literal, as turborel
 * shows it, and of a JSON value's text (RULES.md R-TEST-2).
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DecFloat } from '../../src/codec/decfloat.js';
import { Decimal } from '../../src/codec/decimal.js';
import { Json, JsonObject } from '../../src/codec/json.js';
import { approximateText, jsonText, literalOf, textOf } from '../../src/codec/text.js';
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
  Xml,
} from '../../src/codec/values.js';
import { isFailure } from '../support/failures.js';

/** 2026-11-19 00:00:00 UTC, microseconds from 0001-01-01. */
const DAY = 63_930_643_200_000_000n;

/**
 * A datetime of these fields.
 *
 * @param moment - date, time or timestamp
 * @param utc - its instant
 * @param more - its zone flag, precision and displacement
 * @returns it
 */
function dt(
  moment: 'date' | 'time' | 'timestamp',
  utc: bigint,
  more: Partial<{ zoned: boolean; precision: number; zone: number }> = {},
): Datetime {
  return new Datetime({
    moment,
    utc,
    zoned: more.zoned ?? false,
    precision: more.precision ?? 0,
    zone: more.zone ?? 0,
  });
}

/** Verifies: [CLIENT Copying and exporting] a datetime is shown as its literal's string, in the displacement it is shown in, its fraction to its precision. */
test('datetimes as shown', () => {
  assert.equal(String(dt('date', DAY)), '2026-11-19');
  assert.equal(String(dt('date', 0n)), '0001-01-01', 'the epoch');
  assert.equal(String(dt('timestamp', DAY + 36_000_123_456n, { precision: 3 })), '2026-11-19 10:00:00.123');
  assert.equal(String(dt('timestamp', DAY + 36_000_000_000n, { zoned: true, zone: 120 })), '2026-11-19 12:00:00+02:00');
  assert.equal(String(dt('timestamp', DAY, { zoned: true, zone: -330 })), '2026-11-18 18:30:00-05:30');
  assert.equal(String(dt('time', 36_000_000_000n, { precision: 6 })), '10:00:00.000000');
  assert.equal(String(dt('time', 82_800_000_000n, { zone: 120 })), '01:00:00', 'a time within its day');
  assert.equal(String(dt('date', 315_537_811_200_000_000n)), '9999-12-31');
});

/** Verifies: [CLIENT Copying and exporting] an interval is shown as its literal's string: its sign, its leading field's digits, each other two after its separator. */
test('intervals as shown', () => {
  const daySecond = { start: 'DAY', end: 'SECOND', leading: 2, fraction: 6 } as const;
  assert.equal(String(new Interval(daySecond, 93_784_500_000n)), '1 02:03:04.500000');
  assert.equal(String(new Interval(daySecond, -93_784_500_000n)), '-1 02:03:04.500000');
  assert.equal(String(new Interval({ start: 'YEAR', end: 'MONTH', leading: 2, fraction: 0 }, 14n)), '1-02');
  assert.equal(String(new Interval({ start: 'MINUTE', end: 'MINUTE', leading: 2, fraction: 0 }, 5_400_000_000n)), '90');
  assert.equal(String(new Interval({ start: 'SECOND', end: 'SECOND', leading: 2, fraction: 2 }, 1_250_000n)), '1.25');
  const hourMinute = new Interval({ start: 'HOUR', end: 'MINUTE', leading: 2, fraction: 0 }, 5_400_000_000n);
  assert.equal(literalOf(hourMinute), "INTERVAL '1:30' HOUR(2) TO MINUTE");
  assert.equal(literalOf(new Interval(daySecond, -1n)), "INTERVAL -'0 00:00:00.000001' DAY(2) TO SECOND(6)");
  assert.equal(
    literalOf(new Interval({ start: 'SECOND', end: 'SECOND', leading: 2, fraction: 2 }, 0n)),
    "INTERVAL '0.00' SECOND(2, 2)",
  );
  assert.equal(
    literalOf(new Interval({ start: 'DAY', end: 'DAY', leading: 3, fraction: 0 }, 0n)),
    "INTERVAL '0' DAY(3)",
  );
});

/** Verifies: [CLIENT Copying and exporting] an approximate number is shown as Rust's `{:E}` writes it, its shortest digits. */
test('approximate numbers as shown', () => {
  const cases: [number, string][] = [
    [1.5, '1.5E0'],
    [100, '1E2'],
    [1e-7, '1E-7'],
    [-2.5e21, '-2.5E21'],
    [0, '0E0'],
    [-0, '-0E0'],
    [Number.NaN, 'NaN'],
    [Number.POSITIVE_INFINITY, 'inf'],
    [Number.NEGATIVE_INFINITY, '-inf'],
  ];
  for (const [x, shown] of cases) assert.equal(approximateText(x), shown, String(x));
});

/** Verifies: [CLIENT Copying and exporting] every value shown as turborel's `Display` shows it, a composite value as its literal. */
test('every value as shown and as a literal', () => {
  const uuid = Uuid.parse('919108f7-52d1-4320-9bac-f847db4148a8');
  const shown: [unknown, string, string][] = [
    [null, 'NULL', 'NULL'],
    ["it's", "it's", "'it''s'"],
    [7n, '7', '7'],
    [new Decimal(-150n, 2), '-1.50', '-1.50'],
    [2.5, '2.5E0', '2.5E0'],
    [true, 'TRUE', 'TRUE'],
    [false, 'FALSE', 'FALSE'],
    [Uint8Array.of(10, 255), '0AFF', "X'0AFF'"],
    [dt('date', DAY), '2026-11-19', "DATE '2026-11-19'"],
    [DecFloat.of(15n, -1), '1.5', "CAST('1.5' AS DECFLOAT)"],
    [[1n, 'a'], "ARRAY[1, 'a']", "ARRAY[1, 'a']"],
    [new SqlRow([1n, null]), 'ROW(1, NULL)', 'ROW(1, NULL)'],
    [new Multiset([2n]), 'MULTISET[2]', 'MULTISET[2]'],
    [new Structured({ schema: 'ANN', name: 'POINT' }, [1n, 2n]), 'ANN.POINT(1, 2)', 'ANN.POINT(1, 2)'],
    [new Reference(Uint8Array.of(1)), 'REF(01)', 'REF(01)'],
    [new Lob("o'k"), "o'k", "'o''k'"],
    [new Lob(Uint8Array.of(1)), '01', "X'01'"],
    [
      new LobLocator('character', 1, { octets: 4n, characters: 2n }),
      '<CHARACTER LARGE OBJECT of 2 characters>',
      '<CHARACTER LARGE OBJECT of 2 characters>',
    ],
    [
      new LobLocator('binary', 1, { octets: 4n, characters: 0n }),
      '<BINARY LARGE OBJECT of 4 octets>',
      '<BINARY LARGE OBJECT of 4 octets>',
    ],
    [Json.of({ a: "it's" }), '{"a":"it\'s"}', `JSON('{"a":"it''s"}')`],
    [uuid, String(uuid), `UUID '${String(uuid)}'`],
    [new Xml("<a b='1'/>"), "<a b='1'/>", "XMLPARSE(CONTENT '<a b=''1''/>' PRESERVE WHITESPACE)"],
    [new PluginValue('ST_GEOMETRY', 'POINT (1 2)', Uint8Array.of(0)), 'POINT (1 2)', 'POINT (1 2)'],
  ];
  for (const [v, text, literal] of shown) {
    assert.equal(textOf(v as never), text, text);
    assert.equal(literalOf(v as never), literal, literal);
  }
  assert.equal(String(dt('time', 0n)), '00:00:00');
});

/** Verifies: [CLIENT Copying and exporting] a JSON value's text: no white space, members in their order, strings escaped as RFC 8259 asks, numbers as CAST writes them; a datetime has none. */
test('JSON text', () => {
  const object = new JsonObject([
    ['b', [null, true, false]],
    ['a', 'q"\\\b\f\n\r\t\u0001é/'],
  ]);
  assert.equal(jsonText(object), '{"b":[null,true,false],"a":"q\\"\\\\\\b\\f\\n\\r\\t\\u0001é/"}');
  assert.equal(jsonText([7n, new Decimal(150n, 2), DecFloat.of(15n, 3), 100, 1.5]), '[7,1.50,15000,1.0E2,1.5E0]');
  assert.throws(() => jsonText(dt('date', DAY)), isFailure(-301, '22032'));
  assert.throws(() => jsonText(Number.NaN), isFailure(-301, '22032'));
  const dated = Json.of([dt('date', DAY)]);
  assert.equal(textOf(dated), '<no JSON text parses to a datetime>');
});
