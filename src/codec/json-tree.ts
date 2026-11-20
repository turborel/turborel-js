/**
 * The binary tree a JSON value travels as (`[PROTOCOL Values]`, value tag
 * 25; Turborel's RULES.md D89): a version octet, 1, then the root node, a
 * tag octet and its body, integers little-endian. This module reads a
 * document whole, checking it as turborel's `binary::validate` does, so a
 * damaged one is refused before anything is made of it. Internal.
 *
 * ```text
 * 0 null | 1 false | 2 true
 * 3 integer: i64          4 decimal: units i64, scale u8
 * 5 wide decimal: units i128, scale u32
 * 6 decimal floating point: coefficient i128, exponent i32
 * 7 approximate: f64 bits 8 string: octets u32, UTF-8
 * 9 datetime: moment u8, utc i64, zone minutes i16, zoned u8, precision u8
 * 10 array: count u32, size u32, an offset u32 of each element, the elements
 * 11 object: count u32, size u32, an offset u32 of each member in key order,
 *    the members in written order, each key octets u32, key, value node
 * ```
 *
 * @packageDocumentation
 */

import { DecFloat } from './decfloat.js';
import { Decimal } from './decimal.js';
import { Datetime, type Moment } from './values.js';

/** The version of the format, the first octet of every document. */
export const FORMAT_VERSION = 1;

/** How deep arrays and objects nest, as turborel's `json::MAX_NESTING`. */
export const MAX_JSON_NESTING = 128;

/** The most octets a document holds, as turborel's `MAX_DOCUMENT_OCTETS`, 256 MiB. */
export const MAX_DOCUMENT_OCTETS = 268_435_456;

/** The node tags, as D89 numbers them. */
export const NODE = {
  NULL: 0,
  FALSE: 1,
  TRUE: 2,
  INTEGER: 3,
  DECIMAL: 4,
  WIDE: 5,
  DECFLOAT: 6,
  APPROXIMATE: 7,
  STRING: 8,
  DATETIME: 9,
  ARRAY: 10,
  OBJECT: 11,
} as const;

/** A count, a size, an offset or a string's length. */
export const WORD = 4;
/** An i64, an f64 or a datetime's instant. */
export const LONG = 8;
/** An i128. */
export const WIDE_WORD = 16;
/** A container's head after its tag: its count and its size. */
export const CONTAINER_HEAD = 8;

/** A datetime's zone, an `i16`. */
const ZONE_BYTES = 2;

/** The fewest octets of a document: its version and a node's tag. */
const MIN_DOCUMENT = 2;

/** A datetime's body: its moment, instant, zone, zoned flag and precision. */
const DATETIME_BODY = 13;

/** Where a datetime's fields begin in its body. */
const UTC_AT = 1;
const ZONE_AT = 9;
const ZONED_AT = 11;
const PRECISION_AT = 12;

/** The moments of a datetime, by their octet. */
export const MOMENTS: readonly Moment[] = ['date', 'time', 'timestamp'];

/** The bits of a wide decimal's units. */
const I128_BITS = 128;

/** The bits of a `u64`, the high half of an `i128` shifted by them. */
const BITS_64 = 64n;

/** Decodes UTF-8, failing on any octet that is not, keeping a leading BOM. */
const UTF8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

/** An object of a JSON value: its members in the order written, a key perhaps more than once. */
export class JsonObject {
  /** Its members, each a key and its value. */
  readonly members: readonly (readonly [string, JsonItem])[];

  /** @param members - its members, in order */
  constructor(members: readonly (readonly [string, JsonItem])[]) {
    this.members = members;
  }

  /**
   * The value of the first member of `key`, as a member accessor takes it.
   *
   * @param key - the key
   * @returns its value, or undefined if no member has it
   */
  get(key: string): JsonItem | undefined {
    return this.members.find(([k]) => k === key)?.[1];
  }
}

/**
 * An SQL/JSON item as the driver reads it: the JSON null as `null`, exact
 * numbers as `bigint` or `Decimal` (RULES.md D11), approximate ones as
 * `number`, and datetimes as `Datetime`.
 */
export type JsonItem =
  null | boolean | bigint | Decimal | DecFloat | number | string | Datetime | readonly JsonItem[] | JsonObject;

/** A document's damage: why it is no document of the format. */
export class JsonDamage extends Error {
  /** @param why - what is wrong */
  constructor(why: string) {
    super(why);
    this.name = 'JsonDamage';
  }
}

/** A node read in place: the document's octets, and where the node begins. */
class Node {
  readonly view: DataView;
  readonly bytes: Uint8Array;
  readonly at: number;

  /**
   * @param bytes - the document
   * @param at - where the node begins
   */
  constructor(bytes: Uint8Array, at: number) {
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.at = at;
  }

  /** @returns its tag */
  get tag(): number {
    return this.byte(0);
  }

  /**
   * The octet `offset` bytes into the node.
   *
   * @param offset - from the node's tag
   * @returns it
   */
  byte(offset: number): number {
    return this.view.getUint8(this.reach(offset, 1));
  }

  /**
   * The position of `n` bytes `offset` into the node, checked within the document.
   *
   * @param offset - from the node's tag
   * @param n - how many
   * @returns their position in the document
   */
  reach(offset: number, n: number): number {
    const from = this.at + offset;
    if (from + n > this.bytes.byteLength) throw new JsonDamage('a node runs past its document');
    return from;
  }

  /**
   * The `u32` `offset` bytes into the node.
   *
   * @param offset - from the node's tag
   * @returns it
   */
  word(offset: number): number {
    return this.view.getUint32(this.reach(offset, WORD), true);
  }

  /**
   * The `i64` `offset` bytes into the node.
   *
   * @param offset - from the node's tag
   * @returns it
   */
  long(offset: number): bigint {
    return this.view.getBigInt64(this.reach(offset, LONG), true);
  }

  /**
   * The `i128` `offset` bytes into the node.
   *
   * @param offset - from the node's tag
   * @returns it
   */
  wide(offset: number): bigint {
    const at = this.reach(offset, WIDE_WORD);
    const low = this.view.getBigUint64(at, true);
    const high = this.view.getBigUint64(at + LONG, true);
    return BigInt.asIntN(I128_BITS, (high << BITS_64) | low);
  }

  /**
   * The string whose length is `offset` bytes into the node.
   *
   * @param offset - from the node's tag
   * @returns its text and the octets it takes, its length among them
   */
  string(offset: number): [string, number] {
    const length = this.word(offset);
    const from = this.reach(offset + WORD, length);
    try {
      return [UTF8.decode(this.bytes.subarray(from, from + length)), WORD + length];
    } catch {
      throw new JsonDamage('a string is not UTF-8');
    }
  }

  /** @returns the octets it takes, its tag among them */
  length(): number {
    return 1 + this.bodyLength();
  }

  /** @returns the octets of its body */
  private bodyLength(): number {
    switch (this.tag) {
      case NODE.NULL:
      case NODE.FALSE:
      case NODE.TRUE:
        return 0;
      case NODE.INTEGER:
      case NODE.APPROXIMATE:
        return LONG;
      case NODE.DECIMAL:
        return LONG + 1;
      case NODE.WIDE:
      case NODE.DECFLOAT:
        return WIDE_WORD + WORD;
      case NODE.STRING:
        return WORD + this.word(1);
      case NODE.DATETIME:
        return DATETIME_BODY;
      case NODE.ARRAY:
      case NODE.OBJECT:
        return CONTAINER_HEAD + this.word(1) * WORD + this.word(1 + WORD);
      default:
        throw new JsonDamage("a node's tag is no kind's");
    }
  }

  /** @returns where a container's first element or member begins, from its tag */
  first(): number {
    return 1 + CONTAINER_HEAD + this.word(1) * WORD;
  }

  /**
   * A container's offset `i`.
   *
   * @param i - which
   * @returns it, from its first element or member
   */
  offset(i: number): number {
    return this.word(1 + CONTAINER_HEAD + i * WORD);
  }

  /**
   * The node `offset` bytes into this one.
   *
   * @param offset - from this node's tag
   * @returns it
   */
  child(offset: number): Node {
    this.reach(offset, 1);
    return new Node(this.bytes, this.at + offset);
  }
}

/**
 * Checks a node whole, as turborel's `Node::check` does.
 *
 * @param node - the node
 * @param depth - how deep in arrays and objects it is
 * @returns the octets it takes
 * @throws JsonDamage if it is damaged
 */
function check(node: Node, depth: number): number {
  if (depth > MAX_JSON_NESTING) throw new JsonDamage('arrays and objects nest too deep');
  const length = node.length();
  node.reach(0, length);
  switch (node.tag) {
    case NODE.STRING:
      node.string(1);
      break;
    case NODE.DATETIME:
      datetimeOf(node);
      break;
    case NODE.DECFLOAT:
      decfloatOf(node);
      break;
    case NODE.ARRAY:
      checkElements(node, depth);
      break;
    case NODE.OBJECT:
      checkMembers(node, depth);
      break;
    default:
      // The other tags have no body to check beyond its length.
      break;
  }
  return length;
}

/**
 * Checks that each element of an array is whole and where its offset says, filling its size.
 *
 * @param node - the array
 * @param depth - its depth
 */
function checkElements(node: Node, depth: number): void {
  let expected = 0;
  for (let i = 0; i < node.word(1); i += 1) {
    if (node.offset(i) !== expected) throw new JsonDamage("an element's offset is not where it is");
    expected += check(node.child(node.first() + expected), depth + 1);
  }
  if (expected !== node.word(1 + WORD)) throw new JsonDamage("an array's size is not its elements'");
}

/**
 * Checks that each member of an object is whole, filling its size, and
 * that its directory lists each once, sorted by key octets, then by
 * where it is.
 *
 * @param node - the object
 * @param depth - its depth
 */
function checkMembers(node: Node, depth: number): void {
  const starts = new Map<number, Uint8Array>();
  let at = 0;
  for (let i = 0; i < node.word(1); i += 1) {
    const [, taken] = node.string(node.first() + at);
    const key = node.bytes.subarray(node.at + node.first() + at + WORD, node.at + node.first() + at + taken);
    starts.set(at, key);
    at += taken + check(node.child(node.first() + at + taken), depth + 1);
  }
  if (at !== node.word(1 + WORD)) throw new JsonDamage("an object's size is not its members'");
  let previous: [Uint8Array, number] | undefined;
  for (let i = 0; i < node.word(1); i += 1) {
    const offset = node.offset(i);
    const key = starts.get(offset);
    if (key === undefined || (previous !== undefined && compareEntries(previous, [key, offset]) >= 0)) {
      throw new JsonDamage("an object's key directory is not sorted");
    }
    previous = [key, offset];
  }
}

/**
 * The order of two directory entries: by key octets, then by where the member is.
 *
 * @param a - one entry
 * @param b - the other
 * @returns negative, zero or positive
 */
export function compareEntries(a: readonly [Uint8Array, number], b: readonly [Uint8Array, number]): number {
  const keys = Buffer.compare(a[0], b[0]);
  return keys !== 0 ? keys : a[1] - b[1];
}

/**
 * The datetime of a datetime node.
 *
 * @param node - the node
 * @returns it
 */
function datetimeOf(node: Node): Datetime {
  const moment = MOMENTS[node.byte(1)];
  if (moment === undefined) throw new JsonDamage("a datetime's moment is no moment");
  const zoned = node.byte(1 + ZONED_AT);
  if (zoned > 1) throw new JsonDamage("a datetime's zoned flag is neither 0 nor 1");
  const zone = node.view.getInt16(node.reach(1 + ZONE_AT, ZONE_BYTES), true);
  return new Datetime({
    moment,
    zoned: zoned === 1,
    precision: node.byte(1 + PRECISION_AT),
    zone,
    utc: node.long(1 + UTC_AT),
  });
}

/**
 * The number of a decimal floating-point node, rounded to 34 digits as turborel reads it.
 *
 * @param node - the node
 * @returns it
 */
function decfloatOf(node: Node): DecFloat {
  try {
    return DecFloat.of(node.wide(1), node.view.getInt32(node.reach(1 + WIDE_WORD, WORD), true));
  } catch {
    throw new JsonDamage('a number is out of range');
  }
}

/**
 * The item of a scalar node.
 *
 * @param node - the node
 * @returns the item
 */
function scalarOf(node: Node): JsonItem {
  switch (node.tag) {
    case NODE.NULL:
      return null;
    case NODE.FALSE:
    case NODE.TRUE:
      return node.tag === NODE.TRUE;
    case NODE.INTEGER:
      return node.long(1);
    case NODE.DECIMAL:
      return exact(node.long(1), node.byte(1 + LONG));
    case NODE.WIDE:
      return exact(node.wide(1), node.word(1 + WIDE_WORD));
    case NODE.DECFLOAT:
      return decfloatOf(node);
    case NODE.APPROXIMATE:
      return node.view.getFloat64(node.reach(1, LONG), true);
    case NODE.STRING:
      return node.string(1)[0];
    default:
      return datetimeOf(node);
  }
}

/**
 * An exact number: a `bigint` of scale 0, else a `Decimal` (RULES.md D11).
 *
 * @param units - its units
 * @param scale - its scale
 * @returns it
 */
function exact(units: bigint, scale: number): bigint | Decimal {
  return scale === 0 ? units : new Decimal(units, scale);
}

/**
 * The item of a node checked before.
 *
 * @param node - the node
 * @returns the item
 */
function itemOf(node: Node): JsonItem {
  if (node.tag === NODE.ARRAY) {
    return Array.from({ length: node.word(1) }, (_, i) => itemOf(node.child(node.first() + node.offset(i))));
  }
  if (node.tag !== NODE.OBJECT) return scalarOf(node);
  const members: [string, JsonItem][] = [];
  let at = node.first();
  for (let i = 0; i < node.word(1); i += 1) {
    const [key, taken] = node.string(at);
    const value = node.child(at + taken);
    members.push([key, itemOf(value)]);
    at += taken + value.length();
  }
  return new JsonObject(members);
}

/**
 * The item a document holds, the document checked whole first, as
 * turborel's `binary::validate` checks one read from the wire.
 *
 * @param bytes - the document
 * @returns its item
 * @throws JsonDamage if it is no document of the format
 */
export function decodeDocument(bytes: Uint8Array): JsonItem {
  if (bytes.byteLength < MIN_DOCUMENT || bytes[0] !== FORMAT_VERSION) {
    throw new JsonDamage("it does not begin with its format's version");
  }
  const root = new Node(bytes, 1);
  if (check(root, 0) + 1 !== bytes.byteLength) throw new JsonDamage('octets follow its root');
  return itemOf(root);
}
