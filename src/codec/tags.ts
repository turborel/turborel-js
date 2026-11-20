/**
 * The tags of the protocol's data types and values
 * (`[PROTOCOL Data types]`, `[PROTOCOL Values]`), as turborel-protocol's
 * `fields.rs` names them, UUID's tag 27 among them (turborel's RULES.md
 * D184). One number may be a type's tag and a value's. Internal.
 *
 * @packageDocumentation
 */

/** The null value. */
export const NULL = 0;
/** CHARACTER; a character string value, of either character type. */
export const CHARACTER = 1;
/** Exact numeric; an exact number. */
export const EXACT = 2;
/** Approximate numeric; an approximate number. */
export const APPROXIMATE = 3;
/** A plug-in's type, and its value. */
export const PLUGIN = 4;
/** CHARACTER VARYING, a type alone: its values are written as CHARACTER's. */
export const VARYING = 5;
/** BINARY; a binary string value, of either binary type. */
export const BINARY = 6;
/** BINARY VARYING, a type alone. */
export const BINARY_VARYING = 7;
/** DATE; a date. */
export const DATE = 8;
/** TIME; a time, of either time type. */
export const TIME = 9;
/** TIME WITH TIME ZONE, a type alone. */
export const TIME_ZONED = 10;
/** TIMESTAMP; a timestamp, of either timestamp type. */
export const TIMESTAMP = 11;
/** TIMESTAMP WITH TIME ZONE, a type alone. */
export const TIMESTAMP_ZONED = 12;
/** INTERVAL; an interval. */
export const INTERVAL = 13;
/** BOOLEAN; a truth value. */
export const BOOLEAN = 14;
/** DECFLOAT; a decimal floating-point number. */
export const DECFLOAT = 15;
/** An array type; an array. */
export const ARRAY = 16;
/** A row type; a row. */
export const ROW = 17;
/** CHARACTER LARGE OBJECT, a type alone. */
export const CLOB = 18;
/** BINARY LARGE OBJECT, a type alone. */
export const BLOB = 19;
/** A large object's value, whole. */
export const LOB_WHOLE = 20;
/** A large object's value, by its locator. */
export const LOB_LOCATOR = 21;
/** A multiset type; a multiset. */
export const MULTISET = 22;
/** A structured type; a structured value. */
export const STRUCTURED = 23;
/** A reference type; a reference. */
export const REFERENCE = 24;
/** JSON; a JSON value, D89's binary tree in turborel. */
export const JSON_TAG = 25;
/** XML; an XML value, its serialization as CONTENT. */
export const XML = 26;
/** UUID, with no parameters; a UUID, its 16 octets as bytes. */
export const UUID = 27;

/** A large object's kind: character. */
export const LOB_CHARACTER = 0;
/** A large object's kind: binary. */
export const LOB_BINARY = 1;

/** A character type's units: characters. */
export const UNITS_CHARACTERS = 0;
/** A character type's units: octets. */
export const UNITS_OCTETS = 1;

/** An interval's fields, numbered 0 YEAR to 5 SECOND (`[PROTOCOL Data types]`). */
export const INTERVAL_FIELDS = ['YEAR', 'MONTH', 'DAY', 'HOUR', 'MINUTE', 'SECOND'] as const;

/** The modifiers of an XML type: primary 0 DOCUMENT, 1 CONTENT, 2 SEQUENCE. */
export const XML_PRIMARY = ['document', 'content', 'sequence'] as const;

/** Secondary 0 UNTYPED, 1 ANY, 2 XMLSCHEMA. */
export const XML_SECONDARY = ['untyped', 'any', 'xmlschema'] as const;

/** The secondary modifier that names a registered XML Schema after it. */
export const XML_SCHEMA_TYPED = 2;

/** The most parameters a plug-in's type has, as turborel's `MAX_PARAMS`. */
export const MAX_PLUGIN_PARAMETERS = 2;

/** A parameter no plug-in's type has: `u32::MAX`, turborel's mark of one absent. */
export const ABSENT_PARAMETER = 0xffff_ffff;

/** The most elements of an array type, and of a multiset, as turborel's maximum cardinality. */
export const MAX_CARDINALITY = 65_535;
