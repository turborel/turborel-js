# Errors

[Contents](README.md)

## NAME

`TurborelError`: a failure, of a statement or of the connection.

## SYNOPSIS

```ts
import { TurborelError } from 'turborel';

class TurborelError extends Error {
  constructor(sqlcode: number, sqlstate: string, message: string, options?: TurborelErrorOptions);
  readonly sqlcode: number;
  readonly sqlstate: string;
  readonly rule: string | undefined;
  readonly position: bigint | undefined;
  readonly active: boolean;
  readonly diagnostics: Diagnostics | undefined;
}

interface TurborelErrorOptions {
  readonly rule?: string;
  readonly position?: bigint;
  readonly active?: boolean;
  readonly diagnostics?: Diagnostics;
  readonly cause?: unknown;
}

interface Diagnostics {
  readonly severity?: string;
  readonly detail?: string;
  readonly hint?: string;
  readonly context?: string;
  readonly schema?: string;
  readonly table?: string;
  readonly column?: string;
  readonly dataType?: string;
  readonly constraint?: string;
}
```

## DESCRIPTION

Every failure the driver reports is a `TurborelError`: it throws
nothing else, and rejects no promise with anything else (RULES.md D12,
R-ERR-1). It carries the failure as the server or the driver gave it:
`sqlcode`, negative; `sqlstate`, five characters, whose first two are
its class; `message`, in plain words; `rule`, the rule of a standard it
cites, if any; `position`, where in the statement it is, in characters;
`active`, whether the session's transaction is still active after it;
`diagnostics`, its severity and what it is about, where the server said;
and `cause`, an error of Node.js's beneath it, if there is one. Its
`name` is `TurborelError`.

A failure the driver raises itself has turborel's codes, as
turborel-client gives the same failure.

## ERRORS

| SQLSTATE | SQLCODE | When the driver raises it |
|---|---|---|
| 08006 | -919 | A message that cannot be read: a frame cut short, a body past the limit taken, a field malformed |
| 22003 | -301 | A number past what the protocol carries, as an exact number's units past 128 bits |
| 22021 | -301 | A string holding a lone surrogate, which is no Unicode character |
| 0A000 | -900 | A value past turborel's limits, as a JSON value nested past 128 levels |
| TB910 | -910 | An argument of a type or range the driver does not take |

A connection failure, any failure of class 08 but 08003, and
credentials refused as a connection is made or its user changed, lose
the connection. The server's failures, and those of each request, are
in [Appendix B](../appendix/b-errors.md) and on each page.

## EXAMPLES

```js
import { TurborelError } from 'turborel';

const failure = new TurborelError(-103, '2A000', 'table ANN.NOPE is not defined', {
  rule: 'X3.135-1986 §5.4 SR5',
  position: 14n,
});
console.log(failure instanceof Error, failure.name);
console.log(failure.sqlcode, failure.sqlstate, failure.message);
console.log(failure.rule, failure.position, failure.active);
// true TurborelError
// -103 2A000 table ANN.NOPE is not defined
// X3.135-1986 §5.4 SR5 14n false
```

## SEE ALSO

[Errors](../user/10-errors.md), [Appendix B: Errors](../appendix/b-errors.md)
