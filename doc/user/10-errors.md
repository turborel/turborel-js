# Errors and Diagnostics

[Contents](README.md)

Every failure reaches a program as a `TurborelError`: a statement's,
the server's, or the driver's own. This chapter tells what it carries,
which failures end the connection, and how warnings and notices come.

## A failure

A `TurborelError` carries `sqlcode`, negative; `sqlstate`, whose first
two characters are its class; `message`; `rule`, the rule of a standard
it cites, if any; `position`, where in the statement it is; `active`,
whether the session's transaction is still active after it; and
`diagnostics`, where the server granted `diagnostics`: its `severity`,
`detail`, `hint`, `context`, `schema`, `table`, `column`, `dataType` and
`constraint`, each where it is said.

```js
import { Trust, connectTo, tcp } from 'turborel';

const conn = await connectTo(tcp('127.0.0.1', 7422), 'ann', new Trust());
try {
  await conn.query("INSERT INTO STAFF VALUES (1, 'Again')");
} catch (e) {
  console.log(e.sqlcode, e.sqlstate, e.active);
  console.log(e.diagnostics);
}
await conn.query('SELECT SUM(V) FROM (VALUES (CAST(NULL AS INTEGER)), (1)) AS T(V)');
console.log(conn.warning, conn.conditions.map((c) => c.message));
conn.setNoticeHandler((notice) => console.log('notice', notice.sqlstate, notice.message));
await conn.reset();
await conn.terminate();
// -201 23000 true
// {
//   severity: 'ERROR',
//   detail: 'the key (1) is held by another row',
//   schema: 'ANN',
//   table: 'STAFF',
//   constraint: 'STAFF_PRIMARY1'
// }
// 01003 [
//   'the statement completed with warning: null value eliminated in set function'
// ]
// notice 01T01 [DESIGN] Reset rolled back the transaction that was active
```

A severity of ERROR is a statement's failure, and the session goes on.
FATAL ends the connection: the connection takes nothing more, and
`isLost` says so. A connection failure (SQLCODE -919, SQLSTATE 08006),
any other failure of class 08 but 08003, and credentials refused as the
connection is made or its user changed, lose it too.
[Appendix B](../appendix/b-errors.md) lists the failures.

## Warnings, conditions and notices

A statement's warnings, of class 01, and the conditions of class 02 its
routines signalled, are told one way. Where the server granted
`conditions`, as a connection asks by default, they come with its
completion: `conditions` gives them, `takeConditions()` takes them, so
each is told once, and `warning` gives the SQLSTATE it completed with.
Otherwise, where it granted `notices`, each comes as a notice. A
statement that fails has no completion, so its conditions come as
notices. The server's own notices, as 01T01, always come as notices.

A notice goes to the handler `setNoticeHandler` set, as it comes,
before the statement's last reply. With no handler, the last 64 are
kept, and `takeNotices()` takes them.
