/**
 * The driver's decimal floating-point number (RULES.md D6): a coefficient
 * of at most 34 digits times a power of ten, in turborel's one form, as
 * the protocol's value tag 15 carries it (`[PROTOCOL Values]`).
 *
 * @packageDocumentation
 */

import { SQLSTATE_NUMERIC_OUT_OF_RANGE, apiMisuse, dataException } from '../error.js';

/** The most digits a coefficient has: decimal128's, turborel's MAX_DECFLOAT_PRECISION. */
export const DECFLOAT_DIGITS = 34;

/** The least and the greatest adjusted exponent, that of the leading digit: decimal128's. */
const MIN_ADJUSTED = -6143;
const MAX_ADJUSTED = 6144;

/** The adjusted exponent from which a number is written without an E, as turborel writes it. */
const PLAIN_LEAST = -6;

/** The radix. */
const TEN = 10n;

/** Half the radix, the digit a dropped digit rounds at. */
const TWO = 2n;

/** Text a number is read from: a sign, digits with an optional point, an optional exponent. */
const NUMERAL = /^(?<sign>[+-]?)(?<whole>\d*)(?:\.(?<fraction>\d*))?(?:[eE](?<exponent>[+-]?\d+))?$/u;

/**
 * The digits of a magnitude, at least one.
 *
 * @param magnitude - a non-negative integer
 * @returns how many decimal digits it has
 */
function digitsOf(magnitude: bigint): number {
  return magnitude.toString().length;
}

/**
 * `magnitude` rounded half to even to `DECFLOAT_DIGITS` digits, and the
 * exponent raised by the digits dropped.
 *
 * @param magnitude - a non-negative integer
 * @param exponent - its power of ten
 * @returns the rounded magnitude and exponent
 */
function rounded(magnitude: bigint, exponent: number): [bigint, number] {
  let [m, e] = [magnitude, exponent];
  while (digitsOf(m) > DECFLOAT_DIGITS) {
    const dropped = digitsOf(m) - DECFLOAT_DIGITS;
    const divisor = TEN ** BigInt(dropped);
    const [q, r] = [m / divisor, m % divisor];
    const half = divisor / TWO;
    m = r > half || (r === half && q % TWO === 1n) ? q + 1n : q;
    e += dropped;
  }
  return [m, e];
}

/**
 * A decimal floating-point number.
 *
 * @remarks
 * Each value has one form: its coefficient with no trailing zeros, and
 * zero of exponent 0, so 1.50 is 1.5, and two values are equal exactly
 * when their fields are.
 */
export class DecFloat {
  /** Its digits, signed, with no trailing zeros, at most 34. */
  readonly coefficient: bigint;
  /** The power of ten they are multiplied by. */
  readonly exponent: number;

  /**
   * Its fields, as `of` or the codec found them in their one form.
   *
   * @param coefficient - its digits, signed
   * @param exponent - its power of ten
   */
  private constructor(coefficient: bigint, exponent: number) {
    this.coefficient = coefficient;
    this.exponent = exponent;
  }

  /**
   * `coefficient` × 10^`exponent`, rounded half to even to 34 digits.
   *
   * @param coefficient - its digits, signed, of any length
   * @param exponent - its power of ten, an integer
   * @returns the number, in its one form
   * @throws {@link TurborelError} 22003 if its adjusted exponent is out of range; TB910 if the exponent is no integer
   */
  static of(coefficient: bigint, exponent: number): DecFloat {
    if (!Number.isSafeInteger(exponent)) throw apiMisuse(`an exponent is an integer, not ${String(exponent)}`);
    const negative = coefficient < 0n;
    let [m, e] = rounded(negative ? -coefficient : coefficient, exponent);
    if (m === 0n) return new DecFloat(0n, 0);
    while (m % TEN === 0n) [m, e] = [m / TEN, e + 1];
    const adjusted = e + digitsOf(m) - 1;
    if (adjusted < MIN_ADJUSTED || adjusted > MAX_ADJUSTED) {
      throw dataException(
        SQLSTATE_NUMERIC_OUT_OF_RANGE,
        `a DECFLOAT of adjusted exponent ${String(adjusted)} is out of range`,
      );
    }
    return new DecFloat(negative ? -m : m, e);
  }

  /**
   * The number of these fields if they are in its one form, as the server
   * writes it, else nothing.
   *
   * @param coefficient - the digits read
   * @param exponent - the exponent read
   * @returns the number, or undefined if the fields are not its one form
   */
  static ofCanonical(coefficient: bigint, exponent: number): DecFloat | undefined {
    try {
      const d = DecFloat.of(coefficient, exponent);
      return d.coefficient === coefficient && d.exponent === exponent ? d : undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * The number `text` writes, as `-1.5`, `2E10` or `.25e-3`.
   *
   * @param text - the numeral
   * @returns it, rounded to 34 digits
   * @throws {@link TurborelError} TB910 if the text is no numeral; 22003 if out of range
   */
  static parse(text: string): DecFloat {
    const parts = NUMERAL.exec(text)?.groups;
    const whole = parts?.['whole'] ?? '';
    const fraction = parts?.['fraction'] ?? '';
    if (parts === undefined || whole.length + fraction.length === 0) {
      throw apiMisuse(`${JSON.stringify(text)} is no numeral`);
    }
    const magnitude = BigInt(whole + fraction);
    const exponent = Number(parts['exponent'] ?? '0') - fraction.length;
    return DecFloat.of(parts['sign'] === '-' ? -magnitude : magnitude, exponent);
  }

  /**
   * Whether it is the same number as `other`.
   *
   * @param other - the other number
   * @returns true if they are equal
   */
  equals(other: DecFloat): boolean {
    return this.coefficient === other.coefficient && this.exponent === other.exponent;
  }

  /** @returns its digits, without an E where turborel writes none, else as `1.5E-9` */
  toString(): string {
    const sign = this.coefficient < 0n ? '-' : '';
    const digits = (this.coefficient < 0n ? -this.coefficient : this.coefficient).toString();
    const adjusted = this.exponent + digits.length - 1;
    if (this.coefficient === 0n || (adjusted >= PLAIN_LEAST && adjusted < DECFLOAT_DIGITS)) {
      return sign + plain(digits, this.exponent);
    }
    const rest = digits.slice(1);
    return `${sign}${digits.slice(0, 1)}${rest === '' ? '' : '.'}${rest}E${String(adjusted)}`;
  }

  /** @returns the `number` nearest it, which may lose digits */
  toNumber(): number {
    return Number(`${String(this.coefficient)}e${String(this.exponent)}`);
  }

  /** @returns its text, so `JSON.stringify` keeps every digit */
  toJSON(): string {
    return this.toString();
  }
}

/**
 * `digits` × 10^`exponent` written out, with a point if the exponent is negative.
 *
 * @param digits - the magnitude's digits
 * @param exponent - its power of ten
 * @returns the numeral
 */
function plain(digits: string, exponent: number): string {
  if (exponent >= 0) return digits + '0'.repeat(exponent);
  const places = -exponent;
  const padded = digits.padStart(places + 1, '0');
  return `${padded.slice(0, padded.length - places)}.${padded.slice(padded.length - places)}`;
}
