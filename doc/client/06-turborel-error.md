# TurborelError

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
  readonly active: boolean;
}

interface TurborelErrorOptions {
  readonly rule?: string;
  readonly active?: boolean;
  readonly cause?: unknown;
}
```

## DESCRIPTION

Every failure the driver reports is a `TurborelError`: it throws nothing
else, and rejects no promise with anything else (RULES.md D7). It carries
the failure as the server or the driver gave it:

- `sqlcode`, the failure's SQLCODE, negative;
- `sqlstate`, its SQLSTATE, five characters, whose first two are its
  class ([Appendix B](../appendix/b-errors.md));
- `message`, what happened, in plain words;
- `rule`, the rule of a standard it cites, if it cites one;
- `active`, whether the session's transaction is still active after it;
- `cause`, an error of Node.js's beneath it, such as a socket's, if there
  is one.

Its `name` is `TurborelError`. A failure the driver raises itself has
the SQLCODE and SQLSTATE turborel-client gives for the same failure; a
frame it cannot read, for one, fails the connection with SQLCODE -919
and SQLSTATE 08006. The failure's position in the statement and its
diagnostics are added in milestones M1 and M3.

## ERRORS

None: making one does not fail.

## EXAMPLES

```js
import { TurborelError } from 'turborel';

const failure = new TurborelError(-103, '2A000', 'table ANN.NOPE is not defined', {
  rule: 'X3.135-1986 §5.4 SR5',
});
console.log(failure instanceof Error, failure.name);
console.log(failure.sqlcode, failure.sqlstate, failure.message);
console.log(failure.rule, failure.active);
// true TurborelError
// -103 2A000 table ANN.NOPE is not defined
// X3.135-1986 §5.4 SR5 false
```

## SEE ALSO

[Errors](../user/10-errors.md), [Appendix B: Errors](../appendix/b-errors.md)
