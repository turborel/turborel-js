/**
 * Each value as turborel shows it, and as a literal writes it
 * (`src/value.rs`, `Value`'s `Display` and `to_literal`; `src/json/serialize.rs`):
 * what an export writes for a value, and what a composite value shows of
 * its parts.
 *
 * @packageDocumentation
 */

import { DecFloat } from './decfloat.js';
import { Decimal } from './decimal.js';
import { Json, JsonObject, type JsonItem } from './json.js';
import { hexText, qualifierText } from './shown.js';
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
  type Value,
  Xml,
} from './values.js';
import { TurborelError, dataException } from '../error.js';

/** SQLSTATE 22032, invalid JSON text: an item of which no JSON text is. */
const INVALID_JSON_TEXT = '22032';

/** The escapes of a JSON string's characters that have a short one [RFC 8259 §7]. */
const JSON_ESCAPES: Readonly<Record<string, string>> = {
  '"': '\\"',
  '\\': '\\\\',
  '\b': '\\b',
  '\f': '\\f',
  '\n': '\\n',
  '\r': '\\r',
  '\t': '\\t',
};
/** The last control character, which JSON escapes. */
const LAST_CONTROL = 0x1f;
/** The digits of a `\u` escape. */
const ESCAPE_DIGITS = 4;
/** The radix of hexadecimal digits. */
const HEX = 16;

/**
 * An approximate number as turborel shows it, Rust's `{:E}`: the shortest
 * digits that read back to it, one before the point, and its exponent.
 *
 * @param x - the number
 * @returns as `1.5E0`, `1E-7`, `NaN`, `inf`
 */
export function approximateText(x: number): string {
  if (Number.isNaN(x)) return 'NaN';
  if (!Number.isFinite(x)) return x < 0 ? '-inf' : 'inf';
  if (x === 0) return Object.is(x, -0) ? '-0E0' : '0E0';
  return x.toExponential().replace('e+', 'E').replace('e-', 'E-');
}

/**
 * A JSON string of `s`, its quotes, reverse solidi and control characters
 * escaped, nothing else.
 *
 * @param s - the string
 * @returns the JSON string
 */
function jsonString(s: string): string {
  let out = '"';
  for (const c of s) {
    const code = c.codePointAt(0) ?? 0;
    const short = JSON_ESCAPES[c];
    if (short !== undefined) out += short;
    else if (code <= LAST_CONTROL) out += `\\u${code.toString(HEX).padStart(ESCAPE_DIGITS, '0')}`;
    else out += c;
  }
  return `${out}"`;
}

/**
 * The JSON text of a scalar item.
 *
 * @param item - the item, no array or object
 * @returns its text
 * @throws {@link TurborelError} 22032 for a datetime, or an approximate number not finite
 */
function jsonScalar(item: Exclude<JsonItem, readonly JsonItem[] | JsonObject>): string {
  if (item === null) return 'null';
  if (typeof item === 'string') return jsonString(item);
  if (typeof item === 'boolean') return item ? 'true' : 'false';
  if (typeof item === 'bigint' || item instanceof Decimal) return item.toString();
  if (item instanceof DecFloat) return item.numeral();
  if (item instanceof Datetime) throw dataException(INVALID_JSON_TEXT, 'no JSON text parses to a datetime');
  if (!Number.isFinite(item)) {
    throw dataException(INVALID_JSON_TEXT, 'no JSON text parses to an approximate number that is not finite');
  }
  const text = approximateText(item);
  const [mantissa = '', exponent = ''] = text.split('E');
  return mantissa.includes('.') ? text : `${mantissa}.0E${exponent}`;
}

/**
 * The JSON text of an item, as turborel serializes it: no white space,
 * members in their order, numbers as CAST writes them.
 *
 * @param item - the item
 * @returns its text
 * @throws {@link TurborelError} 22032 if it is or holds a datetime, or an approximate number not finite
 */
export function jsonText(item: JsonItem): string {
  if (Array.isArray(item)) return `[${item.map((e: JsonItem) => jsonText(e)).join(',')}]`;
  if (item instanceof JsonObject) {
    return `{${item.members.map(([k, v]) => `${jsonString(k)}:${jsonText(v)}`).join(',')}}`;
  }
  return jsonScalar(item as Exclude<JsonItem, readonly JsonItem[] | JsonObject>);
}

/**
 * A JSON value as shown: its text, or, of an item of which no JSON text is, a note saying why.
 *
 * @param json - the value
 * @returns its text
 */
function jsonShown(json: Json): string {
  try {
    return jsonText(json.item());
  } catch (e) {
    return `<${e instanceof TurborelError ? e.message : String(e)}>`;
  }
}

/**
 * `s` as a character string literal, its quotes written twice.
 *
 * @param s - the string
 * @returns the literal
 */
function quoted(s: string): string {
  return `'${s.replaceAll("'", "''")}'`;
}

/**
 * Values as literals, comma separated.
 *
 * @param parts - the values
 * @returns their literals
 */
function literals(parts: readonly Value[]): string {
  return parts.map((p) => literalOf(p)).join(', ');
}

/**
 * The literal of a value of a class of the driver's own.
 *
 * @param v - the value
 * @returns its literal
 */
function classLiteral(
  v: Exclude<Value, null | string | bigint | number | boolean | Uint8Array | readonly Value[]>,
): string {
  if (v instanceof Datetime) return `${v.moment.toUpperCase()} '${v.toString()}'`;
  if (v instanceof Interval) {
    const text = v.toString();
    const [sign, body] = text.startsWith('-') ? ['-', text.slice(1)] : ['', text];
    return `INTERVAL ${sign}'${body}' ${qualifierText(v.qualifier)}`;
  }
  if (v instanceof DecFloat) return `CAST('${v.toString()}' AS DECFLOAT)`;
  if (v instanceof SqlRow) return `ROW(${literals(v.values)})`;
  if (v instanceof Multiset) return `MULTISET[${literals(v.elements)}]`;
  if (v instanceof Structured) return `${v.type.schema}.${v.type.name}(${literals(v.attributes)})`;
  if (v instanceof Reference) return `REF(${hexText(v.octets)})`;
  if (v instanceof Lob) return typeof v.data === 'string' ? quoted(v.data) : `X'${hexText(v.data)}'`;
  if (v instanceof Json) return `JSON(${quoted(jsonShown(v))})`;
  if (v instanceof Uuid) return `UUID '${v.toString()}'`;
  if (v instanceof Xml) return `XMLPARSE(CONTENT ${quoted(v.text)} PRESERVE WHITESPACE)`;
  return textOf(v);
}

/**
 * A value as a literal writes it, as turborel's `to_literal` does.
 *
 * @param v - the value
 * @returns its literal: `NULL`, `'it''s'`, `X'0A'`, `DATE '2026-11-19'`, `ARRAY[1, 2]`
 */
export function literalOf(v: Value): string {
  if (v === null) return 'NULL';
  if (typeof v === 'string') return quoted(v);
  if (typeof v === 'bigint' || typeof v === 'number' || typeof v === 'boolean') return textOf(v);
  if (v instanceof Uint8Array) return `X'${hexText(v)}'`;
  if (Array.isArray(v)) return `ARRAY[${literals(v)}]`;
  return classLiteral(v as Exclude<Value, null | string | bigint | number | boolean | Uint8Array | readonly Value[]>);
}

/**
 * The text of a value that shows itself, by its `toString`.
 *
 * @param v - the value
 * @returns its text, or undefined if it is not such a value
 */
function selfShown(v: Value): string | undefined {
  if (typeof v === 'bigint' || v instanceof Decimal || v instanceof DecFloat || v instanceof Datetime)
    return v.toString();
  if (v instanceof Interval || v instanceof Lob || v instanceof LobLocator || v instanceof Uuid) return v.toString();
  return undefined;
}

/**
 * A value as turborel shows it, as its `Display` does: a string as it is,
 * a number as CAST writes it, a binary string's hexits, a datetime's or an
 * interval's literal string, a composite value's literal.
 *
 * @param v - the value
 * @returns its text
 */
export function textOf(v: Value): string {
  if (v === null) return 'NULL';
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return approximateText(v);
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (v instanceof Uint8Array) return hexText(v);
  if (v instanceof Json) return jsonShown(v);
  if (v instanceof Xml || v instanceof PluginValue) return v.text;
  return selfShown(v) ?? literalOf(v);
}
