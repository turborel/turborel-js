/**
 * Tests of the driver's exact and decimal floating-point numbers, which
 * carry the protocol's value tags 2 and 15 with no loss (RULES.md D6).
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DecFloat } from '../../src/codec/decfloat.js';
import { Decimal } from '../../src/codec/decimal.js';
import { isFailure } from '../support/failures.js';

const I128_MAX = 2n ** 127n - 1n;
const I128_MIN = -(2n ** 127n);

/** Verifies: [PROTOCOL Values] an exact number is units i128 and scale u32, the whole range of each taken, nothing past it. */
test('an exact number holds an i128 of units and a u32 scale', () => {
  assert.equal(new Decimal(I128_MAX, 0).units, I128_MAX);
  assert.equal(new Decimal(I128_MIN, 0xffff_ffff).scale, 0xffff_ffff);
  assert.throws(() => new Decimal(I128_MAX + 1n, 0), isFailure(-301, '22003'));
  assert.throws(() => new Decimal(I128_MIN - 1n, 0), isFailure(-301, '22003'));
  for (const scale of [-1, 1.5, 2 ** 32, Number.NaN]) {
    assert.throws(() => new Decimal(1n, scale), isFailure(-910, 'TB910'));
  }
});

/** Verifies: [DESIGN] D6 an exact number reads and writes its text exactly, every digit kept. */
test('an exact number is its text', () => {
  const cases: [string, bigint, number, string][] = [
    ['-12.50', -1250n, 2, '-12.50'],
    ['.5', 5n, 1, '0.5'],
    ['5.', 5n, 0, '5'],
    ['+3', 3n, 0, '3'],
    ['-0.05', -5n, 2, '-0.05'],
    ['170141183460469231731687303715884105727', I128_MAX, 0, '170141183460469231731687303715884105727'],
  ];
  for (const [text, units, scale, written] of cases) {
    const d = Decimal.parse(text);
    assert.deepEqual([d.units, d.scale, d.toString()], [units, scale, written], text);
  }
  assert.equal(new Decimal(-123n, 19).toString(), '-123E-19', 'past 18 places, its power of ten');
  for (const text of ['', '.', 'abc', '1e5', '--1', '1.2.3']) {
    assert.throws(() => Decimal.parse(text), isFailure(-910, 'TB910'), text);
  }
});

/** Verifies: [DESIGN] D6 exact numbers compare by value, whatever their scales, and turn into a number only when asked. */
test('exact numbers compare by value', () => {
  assert.equal(Decimal.parse('1.50').equals(Decimal.parse('1.5')), true);
  assert.equal(Decimal.parse('1.5').equals(Decimal.parse('1.51')), false);
  assert.equal(Decimal.parse('-2.25').toNumber(), -2.25);
  assert.equal(new Decimal(123n, 20).toNumber(), 1.23e-18);
  assert.equal(JSON.stringify({ d: Decimal.parse('0.10') }), '{"d":"0.10"}');
});

/** Verifies: [PROTOCOL Values] a decimal floating-point number is in its one form: no trailing zeros, zero of exponent 0. */
test('a DECFLOAT has one form', () => {
  const d = DecFloat.of(150n, -2);
  assert.deepEqual([d.coefficient, d.exponent], [15n, -1]);
  assert.deepEqual([DecFloat.of(0n, 7).coefficient, DecFloat.of(0n, 7).exponent], [0n, 0]);
  assert.equal(DecFloat.of(-15n, -1).equals(DecFloat.parse('-1.50')), true);
  assert.equal(DecFloat.of(1n, 0).equals(DecFloat.of(2n, 0)), false);
  assert.equal(DecFloat.ofCanonical(15n, -1)?.coefficient, 15n);
  assert.equal(DecFloat.ofCanonical(150n, -2), undefined, 'a trailing zero');
  assert.equal(DecFloat.ofCanonical(0n, 1), undefined, 'zero of exponent 1');
  assert.equal(DecFloat.ofCanonical(10n ** 34n + 1n, 0), undefined, '35 digits');
  assert.equal(DecFloat.ofCanonical(1n, 6145), undefined, 'out of range');
});

/** Verifies: [DESIGN] D6 a DECFLOAT is rounded half to even to 34 digits, a carry raising its exponent. */
test('a DECFLOAT rounds half to even', () => {
  const evenStays = DecFloat.of(12345678901234567890123456789012345n, 0);
  assert.deepEqual([evenStays.coefficient, evenStays.exponent], [1234567890123456789012345678901234n, 1]);
  const oddRises = DecFloat.of(12345678901234567890123456789012355n, 0);
  assert.equal(oddRises.coefficient, 1234567890123456789012345678901236n);
  const above = DecFloat.of(123456789012345678901234567890123451n, 0);
  assert.equal(above.coefficient, 1234567890123456789012345678901235n);
  const carried = DecFloat.of(10n ** 35n - 1n, 0);
  assert.deepEqual([carried.coefficient, carried.exponent], [1n, 35]);
  assert.equal(DecFloat.of(-(10n ** 35n - 1n), 0).coefficient, -1n);
});

/** Verifies: [DESIGN] D6 a DECFLOAT's adjusted exponent is from -6143 to 6144, decimal128's, and past it is 22003. */
test('a DECFLOAT is bounded by its adjusted exponent', () => {
  assert.equal(DecFloat.of(1n, 6144).exponent, 6144);
  assert.equal(DecFloat.of(1n, -6143).exponent, -6143);
  assert.equal(DecFloat.of(10n ** 33n + 1n, 6111).exponent, 6111);
  assert.throws(() => DecFloat.of(1n, 6145), isFailure(-301, '22003'));
  assert.throws(() => DecFloat.of(1n, -6144), isFailure(-301, '22003'));
  assert.throws(() => DecFloat.of(1n, 0.5), isFailure(-910, 'TB910'));
});

/** Verifies: [DESIGN] D6 a DECFLOAT reads its text and writes it as turborel does, plainly within its digits, else with E. */
test('a DECFLOAT is its text', () => {
  assert.deepEqual(
    [DecFloat.parse('1.5E3').coefficient, DecFloat.parse('1.5E3').exponent, DecFloat.parse('.25e-3').exponent],
    [15n, 2, -5],
  );
  const cases: [bigint, number, string][] = [
    [15n, -1, '1.5'],
    [0n, 0, '0'],
    [-123n, 0, '-123'],
    [1n, 40, '1E40'],
    [15n, -10, '1.5E-9'],
    [15n, -7, '0.0000015'],
    [1n, 33, `1${'0'.repeat(33)}`],
    [-12n, 33, '-1.2E34'],
  ];
  for (const [coefficient, exponent, text] of cases) {
    assert.equal(DecFloat.of(coefficient, exponent).toString(), text);
  }
  assert.equal(DecFloat.parse('-2.5').toNumber(), -2.5);
  assert.equal(JSON.stringify(DecFloat.parse('1E40')), '"1E40"');
  for (const text of ['', 'E5', '1e', 'x']) {
    assert.throws(() => DecFloat.parse(text), isFailure(-910, 'TB910'), text);
  }
});
