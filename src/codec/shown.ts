/**
 * How a datetime, an interval and a binary string are shown, as turborel
 * shows them (`src/value/datetime.rs`, `src/value/interval.rs` and
 * `src/value/binary.rs`, their `Display`): a literal's string, the fields
 * as SQL writes them. The value classes' `toString` and an export's text
 * are made of these.
 *
 * @packageDocumentation
 */

import type { IntervalField, Qualifier } from './types.js';

/** Microseconds in a second, a minute, an hour and a day. */
const SECOND = 1_000_000n;
const MINUTE = 60_000_000n;
const HOUR = 3_600_000_000n;
const DAY = 86_400_000_000n;
/** Seconds in an hour and in a minute. */
const HOUR_SECONDS = 3600n;
const MINUTE_SECONDS = 60n;
/** Months in a year. */
const YEAR_MONTHS = 12n;
/**
 * The constants of `civil_from_days`: days from 0000-03-01 to 1970-01-01;
 * an era's 400 years, in days and years; four years less a day, a century
 * less a day and an era less a day, in days; a year's days, the years of
 * a leap cycle and of a century; five months from March of 153 days; and
 * March, from which a year is counted, and February.
 */
const CIVIL_SHIFT = 719_468;
const ERA_DAYS = 146_097;
const ERA_YEARS = 400;
const LEAP_CYCLE_LESS_1 = 1460;
const CENTURY_LESS_1 = 36_524;
const ERA_LESS_1 = 146_096;
const YEAR_DAYS = 365;
const LEAP_YEARS = 4;
const CENTURY_YEARS = 100;
const MONTH_SPAN = 5;
const MONTHS_DAYS = 153;
const MARCH = 3;
const MARCH_SHIFT_BACK = 10;
const FEBRUARY = 2;
const MONTH_ROUNDING = 2;
/** Days from 0001-01-01, the instant's epoch, to 1970-01-01. */
const UNIX_EPOCH_DAYS = 719_162;
/** The digits of a microsecond's fraction. */
const FRACTION_DIGITS = 6;
/** The digits of a year as shown. */
const YEAR_DIGITS = 4;
/** The digits of every other field as shown. */
const FIELD_DIGITS = 2;
/** Minutes in an hour, of a displacement. */
const HOUR_MINUTES = 60;
/** The radix of hexadecimal digits. */
const HEX = 16;

/**
 * `n` divided by `d`, rounded down.
 *
 * @param n - the dividend
 * @param d - the divisor, positive
 * @returns the quotient
 */
function floorDiv(n: bigint, d: bigint): bigint {
  const q = n / d;
  return n % d < 0n ? q - 1n : q;
}

/**
 * `n` modulo `d`, from 0 to `d` less 1.
 *
 * @param n - the dividend
 * @param d - the divisor, positive
 * @returns the remainder
 */
function floorRem(n: bigint, d: bigint): bigint {
  const r = n % d;
  return r < 0n ? r + d : r;
}

/**
 * `n` written with at least `width` digits.
 *
 * @param n - a whole number, not negative
 * @param width - the least digits
 * @returns its digits
 */
function digits(n: bigint | number, width: number): string {
  return String(n).padStart(width, '0');
}

/**
 * The civil date `days` days from 1970-01-01, as the proleptic Gregorian
 * calendar reckons it (Howard Hinnant's `civil_from_days`).
 *
 * @param days - days from 1970-01-01
 * @returns its year, month and day
 */
function civil(days: number): [number, number, number] {
  const z = days + CIVIL_SHIFT;
  const era = Math.floor(z / ERA_DAYS);
  const doe = z - era * ERA_DAYS;
  const yoe = Math.floor(
    (doe - Math.floor(doe / LEAP_CYCLE_LESS_1) + Math.floor(doe / CENTURY_LESS_1) - Math.floor(doe / ERA_LESS_1)) /
      YEAR_DAYS,
  );
  const doy = doe - (YEAR_DAYS * yoe + Math.floor(yoe / LEAP_YEARS) - Math.floor(yoe / CENTURY_YEARS));
  const mp = Math.floor((MONTH_SPAN * doy + MONTH_ROUNDING) / MONTHS_DAYS);
  const day = doy - Math.floor((MONTHS_DAYS * mp + MONTH_ROUNDING) / MONTH_SPAN) + 1;
  const month = mp < MARCH_SHIFT_BACK ? mp + MARCH : mp - MARCH_SHIFT_BACK + 1;
  return [yoe + era * ERA_YEARS + (month <= FEBRUARY ? 1 : 0), month, day];
}

/**
 * The fraction of a second, to `precision` digits.
 *
 * @param micros - microseconds within a second
 * @param precision - the digits shown
 * @returns `.` and the digits, or nothing for none
 */
function fraction(micros: bigint, precision: number): string {
  if (precision === 0) return '';
  return `.${digits(micros, FRACTION_DIGITS).slice(0, precision)}`;
}

/**
 * A displacement as shown: its sign, hours and minutes.
 *
 * @param zone - minutes east of UTC
 * @returns as `+02:00`
 */
export function displacementText(zone: number): string {
  const size = Math.abs(zone);
  const hours = Math.floor(size / HOUR_MINUTES);
  return `${zone < 0 ? '-' : '+'}${digits(hours, FIELD_DIGITS)}:${digits(size % HOUR_MINUTES, FIELD_DIGITS)}`;
}

/** A datetime's fields, as `datetimeText` takes them. */
export interface DatetimeFields {
  /** Whether it is a date, a time or a timestamp. */
  readonly moment: 'date' | 'time' | 'timestamp';
  /** Whether it is of a type WITH TIME ZONE. */
  readonly zoned: boolean;
  /** Its fractional seconds' precision. */
  readonly precision: number;
  /** The displacement it is shown in, in minutes east of UTC. */
  readonly zone: number;
  /** Its instant, microseconds in UTC from 0001-01-01. */
  readonly utc: bigint;
}

/**
 * A datetime as shown, its shortest literal's string: YYYY-MM-DD, HH:MM:SS
 * with as many digits of the fraction as its precision, and its
 * displacement if of a type WITH TIME ZONE; in the displacement it is shown
 * in.
 *
 * @param d - its fields
 * @returns its string
 */
export function datetimeText(d: DatetimeFields): string {
  const shifted = d.utc + BigInt(d.zone) * MINUTE;
  const local = d.moment === 'time' ? floorRem(shifted, DAY) : shifted;
  const [year, month, day] = civil(Number(floorDiv(local, DAY)) - UNIX_EPOCH_DAYS);
  const time = floorRem(local, DAY);
  let text = '';
  if (d.moment !== 'time') {
    text = `${digits(year, YEAR_DIGITS)}-${digits(month, FIELD_DIGITS)}-${digits(day, FIELD_DIGITS)}`;
  }
  if (d.moment === 'date') return text;
  if (d.moment === 'timestamp') text += ' ';
  const seconds = time / SECOND;
  const [h, m, s] = [seconds / HOUR_SECONDS, (seconds / MINUTE_SECONDS) % MINUTE_SECONDS, seconds % MINUTE_SECONDS];
  text += `${digits(h, FIELD_DIGITS)}:${digits(m, FIELD_DIGITS)}:${digits(s, FIELD_DIGITS)}`;
  text += fraction(time % SECOND, d.precision);
  return d.zoned ? text + displacementText(d.zone) : text;
}

/** The units of each field: months of YEAR and MONTH, microseconds of the rest. */
const UNIT: Readonly<Record<IntervalField, bigint>> = {
  YEAR: YEAR_MONTHS,
  MONTH: 1n,
  DAY,
  HOUR,
  MINUTE,
  SECOND: 1n,
};

/** The fields, most significant first. */
const FIELDS: readonly IntervalField[] = ['YEAR', 'MONTH', 'DAY', 'HOUR', 'MINUTE', 'SECOND'];

/** The separator before each field but the leading one. */
const SEPARATOR: Readonly<Record<IntervalField, string>> = {
  YEAR: ':',
  MONTH: '-',
  DAY: ':',
  HOUR: ' ',
  MINUTE: ':',
  SECOND: ':',
};

/**
 * An interval's qualifier as written: `start(leading)`, then TO and its
 * end, SECOND with its fraction's digits.
 *
 * @param q - the qualifier
 * @returns as `DAY(2) TO SECOND(6)`
 */
export function qualifierText(q: Qualifier): string {
  if (q.start === q.end) {
    return q.end === 'SECOND'
      ? `SECOND(${String(q.leading)}, ${String(q.fraction)})`
      : `${q.start}(${String(q.leading)})`;
  }
  const end = q.end === 'SECOND' ? `SECOND(${String(q.fraction)})` : q.end;
  return `${q.start}(${String(q.leading)}) TO ${end}`;
}

/**
 * An interval as shown: its sign, if negative; its leading field's digits;
 * each other field two, after its separator; the second's fraction to its
 * precision.
 *
 * @param q - its qualifier
 * @param units - its units
 * @returns its string
 */
export function intervalText(q: Qualifier, units: bigint): string {
  const size = units < 0n ? -units : units;
  const fields = FIELDS.slice(FIELDS.indexOf(q.start), FIELDS.indexOf(q.end) + 1);
  let text = units < 0n ? '-' : '';
  fields.forEach((field, i) => {
    const above = i === 0 ? size : size % UNIT[FIELDS[FIELDS.indexOf(field) - 1] ?? field];
    const n = field === 'SECOND' ? above : above / UNIT[field];
    const whole = field === 'SECOND' ? n / SECOND : n;
    text += i === 0 ? String(whole) : SEPARATOR[field] + digits(whole, FIELD_DIGITS);
    if (field === 'SECOND') text += fraction(n % SECOND, q.fraction);
  });
  return text;
}

/**
 * Octets as hexits, two to each, upper case, as a binary string literal
 * writes them.
 *
 * @param octets - the octets
 * @returns their hexits
 */
export function hexText(octets: Uint8Array): string {
  return Array.from(octets, (b) => b.toString(HEX).toUpperCase().padStart(FIELD_DIGITS, '0')).join('');
}
