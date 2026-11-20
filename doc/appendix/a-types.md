# Appendix A: Types

[Contents](README.md)

Each data type and value of the native protocol, version 1, and the
JavaScript value the driver gives for it and takes back (RULES.md D11,
D17). A value read and sent again is written byte for byte as it came.

## Values

| Tag | Value | JavaScript | Bounds |
|---|---|---|---|
| 0 | null | `null` | |
| 1 | character string, of CHARACTER or CHARACTER VARYING | `string` | UTF-8 on the wire; a string holding a lone surrogate is refused (22021) |
| 2 | exact number | `bigint` of scale 0, else `Decimal` | units within 128 bits, signed; scale 0 to 4,294,967,295 |
| 3 | approximate number | `number` | the double's bits, -0.0 and NaN among them |
| 4 | a plug-in's value | `PluginValue` | its type's name, its text and its bytes, sent back unchanged |
| 6 | binary string, of BINARY or BINARY VARYING | `Uint8Array` | |
| 8, 9, 11 | date, time, timestamp | `Datetime` | instant in microseconds in UTC, a 64-bit signed `bigint`; displacement in minutes, -32,768 to 32,767; precision 0 to 255 |
| 13 | interval | `Interval` | units within 128 bits, signed: months of a year-month interval, microseconds of a day-time one |
| 14 | truth value | `boolean` | unknown is `null` |
| 15 | decimal floating point | `DecFloat` | at most 34 digits; exponent of the leading digit -6143 to 6144 |
| 16 | array | an array of values | nested at most 16 deep |
| 17 | row | `SqlRow` | |
| 20 | large object, whole | `Lob`, of a `string` or a `Uint8Array` | a CLOB's octets UTF-8 |
| 21 | large object, by locator | `LobLocator` | locator a 32-bit unsigned integer; lengths 64-bit unsigned `bigint`s |
| 22 | multiset | `Multiset` | at most 65,535 elements |
| 23 | structured value | `Structured` | its most specific type's schema and name, and its attributes |
| 24 | reference | `Reference` | its octets |
| 25 | JSON | `Json` | its tree checked whole, nested at most 128 deep; its item a `JsonItem` |
| 26 | XML | `Xml` | its serialization as CONTENT |
| 27 | UUID | `Uuid` | 16 octets; text of 32 hexadecimal digits, hyphenated |

A `number` is always sent as an approximate number, and a `bigint` or a
`Decimal` as an exact one, so no value changes kind silently. A
JavaScript `Date` is not taken: a datetime is a `Datetime`. A value of
any other type is refused (SQLCODE -910, SQLSTATE TB910).

## JSON items

| Node | Item | JavaScript |
|---|---|---|
| 0 | null | `null` |
| 1, 2 | false, true | `boolean` |
| 3, 4, 5 | exact number | `bigint` of scale 0, else `Decimal`; written in the narrowest node that holds it |
| 6 | decimal floating point | `DecFloat` |
| 7 | approximate number | `number` |
| 8 | string | `string` |
| 9 | datetime | `Datetime` |
| 10 | array | an array of items |
| 11 | object | `JsonObject`, its members in the order written, a key perhaps more than once; `get` gives the first member of a key |

A JSON value is made with `Json.of`, of items, or of plain objects and
arrays of them, their members in their properties' order.

## Data types

A column's and a parameter's type is a `DataType`, an object whose
`kind` names it:

| Tag | Type | `kind` and fields |
|---|---|---|
| 1, 5 | CHARACTER, CHARACTER VARYING | `character`, `varying`: `length`, `units` (`characters` or `octets`) |
| 2 | exact numeric | `exact`: `precision`, `scale` |
| 3 | approximate numeric | `approximate`: `precision` |
| 4 | a plug-in's type | `plugin`: `name`, `parameters`, at most two |
| 6, 7 | BINARY, BINARY VARYING | `binary`, `varbinary`: `length` |
| 8 | DATE | `date`: `precision` |
| 9, 10 | TIME, WITH TIME ZONE | `time`: `precision`, `zoned` |
| 11, 12 | TIMESTAMP, WITH TIME ZONE | `timestamp`: `precision`, `zoned` |
| 13 | INTERVAL | `interval`: `qualifier`, its `start` and `end` fields, `YEAR` to `SECOND`, and its `leading` and `fraction` precisions |
| 14 | BOOLEAN | `boolean` |
| 15 | DECFLOAT | `decfloat`: `precision` |
| 16 | array | `array`: `maxCardinality`, 1 to 65,535, and `element` |
| 17 | row | `row`: `fields`, one or more, each a `name` and a `type` |
| 18, 19 | CLOB, BLOB | `clob`, `blob`: `length`, a `bigint`, and `units` |
| 22 | multiset | `multiset`: `element` |
| 23 | structured type | `structured`: `name`, its `schema`, `name` and `supertypes` |
| 24 | reference type | `reference`: `referenced`, and `scope` if scoped |
| 25 | JSON | `json` |
| 26 | XML | `xml`: `primary` (`document`, `content`, `sequence`), `secondary` (`untyped`, `any`, `xmlschema`), and the `schema` of `xmlschema` |
| 27 | UUID | `uuid` |

A distinct type is described as its source type, as the server writes
it.
