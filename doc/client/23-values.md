# Values

[Contents](README.md)

## NAME

The values the low-level client gives and takes, one for each of the
protocol's values.

## SYNOPSIS

```ts
import {
  Datetime, Interval, DecFloat, Decimal, Lob, LobLocator, SqlRow, Multiset,
  Structured, Reference, Json, JsonObject, Xml, Uuid, PluginValue,
} from 'turborel';
import type { Value, JsonItem, JsonInput, DataType } from 'turborel';

type Value =
  | null | string | bigint | Decimal | number | boolean | Uint8Array
  | Datetime | Interval | DecFloat | readonly Value[] | SqlRow | Lob | LobLocator
  | Multiset | Structured | Reference | Json | Xml | Uuid | PluginValue;
```

## DESCRIPTION

A value is JavaScript's own type where that type holds it exactly, and
an immutable class of the driver's own where none does (RULES.md D17).
[Appendix A](../appendix/a-types.md) gives each tag's type and bounds.

- `null`, `string`, `boolean` and `Uint8Array` are the null value, a
  character string, a truth value and a binary string.
- An exact number is a `bigint` of scale 0, else a `Decimal`
  ([Decimal and DecFloat](05-api-decimal.md)). An approximate number is
  a `number`, its bits kept; a `number` is always sent as one.
- `Datetime` is a date, time or timestamp: its `moment`, whether it is
  `zoned`, its `precision`, the displacement it is shown in, `zone`, in
  minutes, and its instant, `utc`, in microseconds in UTC from
  0001-01-01 00:00:00: of a date, its midnight's; of a time, from
  midnight UTC, within a day.
- `Interval` is its `qualifier` and its `units`, months of a year-month
  interval and microseconds of a day-time one.
- An array is an array of values; `SqlRow`, `Multiset` and `Structured`
  hold a row's fields, a multiset's elements, and a structured value's
  most specific `type` and `attributes`.
- `Lob` is a large object held whole, of its text or its octets, and
  `LobLocator` one reached by its `locator`, with its lengths in
  `octets` and `characters`.
- `Json` is a JSON value: `Json.of` makes one of JSON items, or of plain
  objects and arrays of them, and `item` gives its item. An object is a
  `JsonObject`, its `members` in the order written; `get` gives the
  first member of a key.
- `Reference`, `Xml` and `Uuid` are a reference's octets, an XML value's
  serialization, and a UUID's 16 octets, `Uuid.parse` reading its text
  and `toString` writing it.
- `PluginValue` is a value of a plug-in's type: its `typeName`, its
  `text` and its `octets`, sent back unchanged.

Each value has the text turborel shows it as, which `textOf(v)` gives
and an export writes: a string as it is, an approximate number as
`1.5E0`, a binary string's hexits, a datetime's or an interval's
literal string, `2026-11-19 10:00:00+02:00` or `1 02:30:00`, a JSON
value's text, and a composite value as its literal. `literalOf(v)`
gives a value as a literal writes it, as `DATE '2026-11-19'`. A
`Datetime`'s, an `Interval`'s, a `Lob`'s and a `LobLocator`'s
`toString` give their text.

A column's or a parameter's type is a `DataType`, an object whose `kind`
names its type ([Appendix A](../appendix/a-types.md#data-types)).

The rest of this page, how a statement's results and parameters carry
these values, is written at milestone M3.

## ERRORS

| SQLSTATE | SQLCODE | When |
|---|---|---|
| 08006 | -919 | A value received malformed: a tag of no value, a large object of no kind, a CLOB not UTF-8, a UUID not of 16 octets, a DECFLOAT not in its one form, values nested past 16 or a multiset past 65,535 elements |
| TB916 | -916 | A value received that its reader cannot take, its frame read whole: a truth value or a length's units byte not 0 or 1, a JSON value whose tree is damaged, value tags 18 and 19; the statement fails alone, the rest of its replies read past, and the connection goes on |
| 22003 | -301 | An exact number or an interval whose units are past 128 bits |
| 22021 | -301 | A string holding a lone surrogate |
| 0A000 | -900 | A JSON value nested past 128 levels, or longer than 256 MiB; one received so fails its statement alone, as TB916 does |
| TB910 | -910 | A value of a type the protocol carries none of, `undefined` and `Date` among them, or a field out of its range |

## EXAMPLES

```js
import { Datetime, Json, JsonObject, Uuid, SqlRow } from 'turborel';

const id = Uuid.parse('919108f7-52d1-4320-9bac-f847db4148a8');
console.log(String(id), id.octets.length);
const noon = new Datetime({ moment: 'timestamp', zoned: true, precision: 0, zone: 60, utc: 1_767_268_800_000_000n });
console.log(noon.moment, noon.zone, noon.utc);
const doc = Json.of({ name: 'Ada', born: 1815n, tags: ['math'] });
const item = doc.item();
console.log(item instanceof JsonObject, item.get('born'), item.get('tags'));
console.log(new SqlRow([1n, 'x']).values);
// 919108f7-52d1-4320-9bac-f847db4148a8 16
// timestamp 60 1767268800000000n
// true 1815n [ 'math' ]
// [ 1n, 'x' ]
```

## SEE ALSO

[Decimal and DecFloat](05-api-decimal.md), [Errors](30-errors.md),
[Appendix A: Types](../appendix/a-types.md)
