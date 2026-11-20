/**
 * The values the protocol carries (`[PROTOCOL Values]`), as the driver
 * gives and takes them: JavaScript's own types where one holds the value
 * exactly, and a small class of the driver's own where none does
 * (RULES.md D11, D17).
 *
 * @packageDocumentation
 */

import type { DecFloat } from './decfloat.js';
import type { Decimal } from './decimal.js';
import type { Json } from './json.js';
import type { Qualifier, TypeName } from './types.js';
import { checkUnits } from './decimal.js';
import { datetimeText, hexText, intervalText } from './shown.js';
import { apiMisuse } from '../error.js';
import { type XmlNode, parseContent } from '../xml/nodes.js';

/** The octets of a UUID. */
export const UUID_OCTETS = 16;

/** A UUID's text: 32 hexadecimal digits in groups of 8, 4, 4, 4 and 12. */
const UUID_TEXT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

/** A UUID's 32 digits, in the groups its text hyphenates. */
const UUID_GROUPS = /^(.{8})(.{4})(.{4})(.{4})(.{12})$/u;

/** The radix of hexadecimal digits. */
const HEX = 16;

/** The digits of an octet in hexadecimal. */
const OCTET_DIGITS = 2;

/** The least and the largest displacement an `i16` holds, in minutes. */
const MIN_ZONE = -0x8000;
const MAX_ZONE = 0x7fff;

/** The largest precision, an octet. */
const MAX_PRECISION = 0xff;

/** The bits of a datetime's instant, an `i64`. */
const INSTANT_BITS = 64;

/** The largest locator, a `u32`. */
const MAX_LOCATOR = 0xffff_ffff;

/** The bits of a large object's lengths, `u64`. */
const LENGTH_BITS = 64;

/** Which moment a datetime is. */
export type Moment = 'date' | 'time' | 'timestamp';

/** A large object's kind. */
export type LobKind = 'character' | 'binary';

/**
 * Checks that `n` is an integer from `min` to `max`.
 *
 * @param n - the number
 * @param min - the least it may be
 * @param max - the largest it may be
 * @param what - what it is, for the failure
 * @throws {@link TurborelError} TB910 if it is not
 */
function checkRange(n: number, min: number, max: number, what: string): void {
  if (!Number.isInteger(n) || n < min || n > max) {
    throw apiMisuse(`${what} is an integer from ${String(min)} to ${String(max)}, not ${String(n)}`);
  }
}

/**
 * A date, a time or a timestamp, as the protocol carries it: its instant
 * in microseconds in UTC, and the displacement it is shown in.
 */
export class Datetime {
  /** Whether it is a date, a time or a timestamp. */
  readonly moment: Moment;
  /** Whether it is of a type WITH TIME ZONE. */
  readonly zoned: boolean;
  /** Its fractional seconds' precision. */
  readonly precision: number;
  /** The displacement it is shown in, in minutes east of UTC. */
  readonly zone: number;
  /**
   * Its instant, in microseconds in UTC from 0001-01-01 00:00:00: of a
   * date, its midnight's; of a time, from midnight UTC, within a day.
   */
  readonly utc: bigint;

  /**
   * A datetime of these fields.
   *
   * @param fields - its moment, zone flag, precision, displacement and instant
   * @throws {@link TurborelError} TB910 if a field is out of its range
   */
  constructor(fields: {
    readonly moment: Moment;
    readonly zoned: boolean;
    readonly precision: number;
    readonly zone: number;
    readonly utc: bigint;
  }) {
    checkRange(fields.precision, 0, MAX_PRECISION, 'a precision');
    checkRange(fields.zone, MIN_ZONE, MAX_ZONE, 'a displacement');
    if (BigInt.asIntN(INSTANT_BITS, fields.utc) !== fields.utc) throw apiMisuse('an instant is past 64 bits');
    this.moment = fields.moment;
    this.zoned = fields.zoned;
    this.precision = fields.precision;
    this.zone = fields.zone;
    this.utc = fields.utc;
  }

  /** @returns it as turborel shows it, in the displacement it is shown in: as `2026-11-19 10:00:00.25+02:00` */
  toString(): string {
    return datetimeText(this);
  }
}

/** An interval: its qualifier, and its units, months of a year-month one and microseconds of a day-time one. */
export class Interval {
  /** Its fields and precisions. */
  readonly qualifier: Qualifier;
  /** Its units, within an `i128`. */
  readonly units: bigint;

  /**
   * An interval of `units` in the fields of `qualifier`.
   *
   * @param qualifier - its fields and precisions
   * @param units - months or microseconds
   */
  constructor(qualifier: Qualifier, units: bigint) {
    checkUnits(units);
    this.qualifier = qualifier;
    this.units = units;
  }

  /** @returns it as turborel shows it, its literal's string: as `1 02:30:00` of DAY TO SECOND */
  toString(): string {
    return intervalText(this.qualifier, this.units);
  }
}

/** A large object held whole: a CLOB's text, or a BLOB's octets. */
export class Lob {
  /** Its kind. */
  readonly kind: LobKind;
  /** Its text, of a character one, or its octets, of a binary one. */
  readonly data: string | Uint8Array;

  /**
   * A large object of `data`.
   *
   * @param data - a CLOB's text or a BLOB's octets
   */
  constructor(data: string | Uint8Array) {
    this.kind = typeof data === 'string' ? 'character' : 'binary';
    this.data = data;
  }

  /** @returns a CLOB's text, or a BLOB's octets as hexits */
  toString(): string {
    return typeof this.data === 'string' ? this.data : hexText(this.data);
  }
}

/** A large object reached by its locator, read with Lob requests until its transaction ends. */
export class LobLocator {
  /** Its kind. */
  readonly kind: LobKind;
  /** Its locator. */
  readonly locator: number;
  /** Its length in octets. */
  readonly octets: bigint;
  /** Its length in characters. */
  readonly characters: bigint;

  /**
   * A locator's value.
   *
   * @param kind - character or binary
   * @param locator - its locator, a `u32`
   * @param lengths - its octets and characters, each a `u64`
   * @throws {@link TurborelError} TB910 if a field is out of its range
   */
  constructor(kind: LobKind, locator: number, lengths: { readonly octets: bigint; readonly characters: bigint }) {
    checkRange(locator, 0, MAX_LOCATOR, 'a locator');
    for (const n of [lengths.octets, lengths.characters]) {
      if (BigInt.asUintN(LENGTH_BITS, n) !== n) throw apiMisuse('a large object length is a u64');
    }
    this.kind = kind;
    this.locator = locator;
    this.octets = lengths.octets;
    this.characters = lengths.characters;
  }

  /** @returns what it is, which a program reads by its locator */
  toString(): string {
    return this.kind === 'character'
      ? `<CHARACTER LARGE OBJECT of ${String(this.characters)} characters>`
      : `<BINARY LARGE OBJECT of ${String(this.octets)} octets>`;
  }
}

/** A row value: one value for each field. */
export class SqlRow {
  /** Its fields' values. */
  readonly values: readonly Value[];

  /** @param values - its fields' values */
  constructor(values: readonly Value[]) {
    this.values = values;
  }
}

/** A multiset: its elements, in no set order. */
export class Multiset {
  /** Its elements. */
  readonly elements: readonly Value[];

  /** @param elements - its elements */
  constructor(elements: readonly Value[]) {
    this.elements = elements;
  }
}

/** A value of a structured type: its most specific type, and its attributes. */
export class Structured {
  /** Its most specific type's schema and name. */
  readonly type: TypeName;
  /** Its attributes' values. */
  readonly attributes: readonly Value[];

  /**
   * A structured value.
   *
   * @param type - its most specific type
   * @param attributes - its attributes' values
   */
  constructor(type: TypeName, attributes: readonly Value[]) {
    this.type = type;
    this.attributes = attributes;
  }
}

/** A reference to a row of a typed table: its octets. */
export class Reference {
  /** Its octets. */
  readonly octets: Uint8Array;

  /** @param octets - its octets */
  constructor(octets: Uint8Array) {
    this.octets = octets;
  }
}

/** An XML value: its serialization as CONTENT. */
export class Xml {
  /** Its text. */
  readonly text: string;

  /** @param text - its serialization */
  constructor(text: string) {
    this.text = text;
  }

  /** @returns its serialization */
  toString(): string {
    return this.text;
  }

  /**
   * Its nodes, parsed from its serialization as XML content, its whitespace kept.
   *
   * @returns its nodes, in order
   * @throws {@link TurborelError} 2200N if its text is not well-formed XML content
   */
  nodes(): XmlNode[] {
    return parseContent(this.text);
  }
}

/** A UUID: its 16 octets. */
export class Uuid {
  /** Its octets. */
  readonly octets: Uint8Array;

  /**
   * The UUID of `octets`.
   *
   * @param octets - exactly 16
   * @throws {@link TurborelError} TB910 if they are not 16
   */
  constructor(octets: Uint8Array) {
    if (octets.byteLength !== UUID_OCTETS) throw apiMisuse(`a UUID is 16 octets, not ${String(octets.byteLength)}`);
    this.octets = octets;
  }

  /**
   * The UUID `text` writes, as `919108f7-52d1-4320-9bac-f847db4148a8`.
   *
   * @param text - its 32 hexadecimal digits, hyphenated
   * @returns it
   * @throws {@link TurborelError} TB910 if the text is no UUID's
   */
  static parse(text: string): Uuid {
    if (!UUID_TEXT.test(text)) throw apiMisuse(`${JSON.stringify(text)} is no UUID`);
    const digits = text.replaceAll('-', '');
    return new Uuid(
      Uint8Array.from({ length: UUID_OCTETS }, (_, i) =>
        Number.parseInt(digits.slice(i * OCTET_DIGITS, (i + 1) * OCTET_DIGITS), HEX),
      ),
    );
  }

  /** @returns its text, lower case and hyphenated */
  toString(): string {
    const digits = [...this.octets].map((b) => b.toString(HEX).padStart(OCTET_DIGITS, '0')).join('');
    return digits.replace(UUID_GROUPS, '$1-$2-$3-$4-$5');
  }

  /** @returns its text, so `JSON.stringify` writes it */
  toJSON(): string {
    return this.toString();
  }
}

/** A value of a plug-in's type: its type's name, its text and its bytes, sent back as they came. */
export class PluginValue {
  /** Its type's name. */
  readonly typeName: string;
  /** Its text, which shows it where the type is not known. */
  readonly text: string;
  /** Its type's bytes of it. */
  readonly octets: Uint8Array;

  /**
   * A plug-in's value.
   *
   * @param typeName - its type's name
   * @param text - its text
   * @param octets - its bytes
   */
  constructor(typeName: string, text: string, octets: Uint8Array) {
    this.typeName = typeName;
    this.text = text;
    this.octets = octets;
  }

  /** @returns its text */
  toString(): string {
    return this.text;
  }
}

/**
 * A value as the driver gives and takes it (RULES.md D17): `null`; a
 * `string` of a character string; a `bigint` or a `Decimal` of an exact
 * number; a `number` of an approximate one; a `boolean` of a truth value;
 * a `Uint8Array` of a binary string; an array of an array; and the
 * driver's classes of the rest.
 */
export type Value =
  | null
  | string
  | bigint
  | Decimal
  | number
  | boolean
  | Uint8Array
  | Datetime
  | Interval
  | DecFloat
  | readonly Value[]
  | SqlRow
  | Lob
  | LobLocator
  | Multiset
  | Structured
  | Reference
  | Json
  | Xml
  | Uuid
  | PluginValue;
