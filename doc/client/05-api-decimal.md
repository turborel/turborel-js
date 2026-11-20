# Decimal and DecFloat

[Contents](README.md)

## NAME

`Decimal`, `DecFloat`: the driver's exact and decimal floating-point
numbers.

## SYNOPSIS

```ts
import { Decimal, DecFloat } from 'turborel';

class Decimal {
  constructor(units: bigint, scale: number);
  static parse(text: string): Decimal;
  readonly units: bigint;
  readonly scale: number;
  equals(other: Decimal): boolean;
  toString(): string;
  toNumber(): number;
  toJSON(): string;
}

class DecFloat {
  static of(coefficient: bigint, exponent: number): DecFloat;
  static parse(text: string): DecFloat;
  readonly coefficient: bigint;
  readonly exponent: number;
  equals(other: DecFloat): boolean;
  toString(): string;
  toNumber(): number;
  toJSON(): string;
}
```

## DESCRIPTION

A `number` holds integers exactly only up to 2^53, so the driver never
reads an exact number or a DECFLOAT into one (RULES.md D11). An exact
number of scale 0 is a `bigint`. One of another scale is a `Decimal`:
its `units`, a `bigint` within the protocol's 128 bits, divided by ten
to its `scale`, a 32-bit unsigned integer. A DECFLOAT is a `DecFloat`:
a `coefficient` of at most 34 digits times ten to its `exponent`, in its
one form, with no trailing zeros and zero of exponent 0.

`Decimal.parse` reads digits with an optional sign and point, keeping
as many places as the text has. `DecFloat.of` and `DecFloat.parse` round
half to even to 34 digits. `equals` compares by value: a `Decimal` of
1.50 equals one of 1.5. `toString` and `toJSON` give every digit.
`toNumber` gives the nearest `number`, which may lose digits, and only
when asked.

## ERRORS

| SQLSTATE | SQLCODE | When |
|---|---|---|
| 22003 | -301 | A `Decimal`'s units past 128 bits, or a `DecFloat` whose exponent of its leading digit is outside -6143 to 6144 |
| TB910 | -910 | A scale that is no 32-bit unsigned integer, an exponent that is no integer, or text that is no numeral |

## EXAMPLES

```js
import { Decimal, DecFloat } from 'turborel';

const price = Decimal.parse('-12.50');
console.log(price.units, price.scale, price.toString());
console.log(price.equals(new Decimal(-125n, 1)), price.toNumber());
const d = DecFloat.of(150n, -2);
console.log(d.coefficient, d.exponent, d.toString());
console.log(DecFloat.parse('1.5E-9').toString(), JSON.stringify({ d }));
// -1250n 2 -12.50
// true -12.5
// 15n -1 1.5
// 1.5E-9 {"d":"1.5"}
```

## SEE ALSO

[Values](23-values.md), [Appendix A: Types](../appendix/a-types.md)
