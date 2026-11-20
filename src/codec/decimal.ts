/**
 * The driver's exact number of a scale (RULES.md D6): units, a `bigint`
 * within the protocol's `i128`, divided by ten to the scale, a `u32`, as
 * the protocol's value tag 2 carries it (`[PROTOCOL Values]`).
 *
 * @packageDocumentation
 */

import { SQLSTATE_NUMERIC_OUT_OF_RANGE, apiMisuse, dataException } from '../error.js';

/** The bits of the protocol's units. */
const UNIT_BITS = 128;

/** The largest scale: a `u32`'s. */
const MAX_SCALE = 0xffff_ffff;

/**
 * The largest scale written with its digits after a point; past it, the
 * power of ten is written out, as turborel's `Decimal` writes it.
 */
const MAX_PLAIN_SCALE = 18;

/** The radix of a scale. */
const TEN = 10n;

/** Text an exact number is read from: an optional sign, digits, an optional point and digits. */
const NUMERAL = /^(?<sign>[+-]?)(?<whole>\d*)(?:\.(?<fraction>\d*))?$/u;

/**
 * Checks that `units` fits the protocol's `i128`.
 *
 * @param units - the units
 * @throws {@link TurborelError} 22003 if it does not
 */
export function checkUnits(units: bigint): void {
  if (BigInt.asIntN(UNIT_BITS, units) !== units) {
    throw dataException(SQLSTATE_NUMERIC_OUT_OF_RANGE, `${String(units)} is past the 128 bits an exact number carries`);
  }
}

/**
 * An exact number: `units` divided by ten to `scale`.
 *
 * @remarks
 * It carries a value exactly, as it came or is to go, and computes
 * nothing; `toString` gives its digits, and `toNumber` the nearest
 * `number` when a program asks for one.
 */
export class Decimal {
  /** Its units, within the protocol's `i128`. */
  readonly units: bigint;
  /** The power of ten the units are divided by, a `u32`. */
  readonly scale: number;

  /**
   * The exact number `units` / 10^`scale`.
   *
   * @param units - its units, within an `i128`
   * @param scale - its scale, a `u32`
   * @throws {@link TurborelError} 22003 if the units are past an `i128`; TB910 if the scale is no `u32`
   */
  constructor(units: bigint, scale: number) {
    checkUnits(units);
    if (!Number.isInteger(scale) || scale < 0 || scale > MAX_SCALE) {
      throw apiMisuse(`a scale is a u32, not ${String(scale)}`);
    }
    this.units = units;
    this.scale = scale;
  }

  /**
   * The exact number `text` writes: digits with an optional sign and point.
   *
   * @param text - as `-12.50`
   * @returns it, of as many places as the text has
   * @throws {@link TurborelError} TB910 if the text is no such numeral; 22003 if past an `i128`
   */
  static parse(text: string): Decimal {
    const parts = NUMERAL.exec(text)?.groups;
    const whole = parts?.['whole'] ?? '';
    const fraction = parts?.['fraction'] ?? '';
    if (parts === undefined || whole.length + fraction.length === 0) {
      throw apiMisuse(`${JSON.stringify(text)} is no exact numeral`);
    }
    const magnitude = BigInt(whole + fraction);
    return new Decimal(parts['sign'] === '-' ? -magnitude : magnitude, fraction.length);
  }

  /**
   * Whether it is the same number as `other`, whatever their scales.
   *
   * @param other - the other number
   * @returns true if they are equal
   */
  equals(other: Decimal): boolean {
    const scale = Math.max(this.scale, other.scale);
    return this.units * TEN ** BigInt(scale - this.scale) === other.units * TEN ** BigInt(scale - other.scale);
  }

  /** @returns its digits exactly, as `-12.50`; past 18 places, as its units and `E-` its scale */
  toString(): string {
    const sign = this.units < 0n ? '-' : '';
    const digits = (this.units < 0n ? -this.units : this.units).toString();
    if (this.scale === 0) return sign + digits;
    if (this.scale > MAX_PLAIN_SCALE) return `${sign}${digits}E-${String(this.scale)}`;
    const padded = digits.padStart(this.scale + 1, '0');
    const point = padded.length - this.scale;
    return `${sign}${padded.slice(0, point)}.${padded.slice(point)}`;
  }

  /** @returns the `number` nearest it, which may lose digits */
  toNumber(): number {
    return Number(this.toString());
  }

  /** @returns its text, so `JSON.stringify` keeps every digit */
  toJSON(): string {
    return this.toString();
  }
}
