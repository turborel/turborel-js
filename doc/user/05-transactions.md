# Transactions

[Contents](README.md)

This chapter tells how a session's transaction begins and ends, how a
cursor and a large object's locator keep it, and how a session is reset
or changes its user.

## Beginning and ending

A transaction begins with the first statement and lasts until COMMIT or
ROLLBACK, as SQL-92 has it. `inTransaction` says whether one is active,
as the server said after the last statement. A COMMIT that fails, as of
a deferred constraint not satisfied, rolls the transaction back and
fails with SQLSTATE 40002.

## Autocommit

`setAutocommit(true)` makes each statement `query`, `queryInto`,
`queryMany` and `execute` run its own transaction: the server commits it
as the statement succeeds, or rolls it back as it fails, within the same
request, so no COMMIT is sent.

```js
import { Trust, connectTo, tcp } from 'turborel';

const conn = await connectTo(tcp('127.0.0.1', 7422), 'ann', new Trust());
await conn.query("INSERT INTO STAFF VALUES (3, 'Edsger')");
console.log(conn.inTransaction);
await conn.query('ROLLBACK');
console.log(conn.inTransaction);
conn.setAutocommit(true);
await conn.query("INSERT INTO STAFF VALUES (3, 'Edsger')");
console.log(conn.inTransaction, conn.commitPosition > 0n);
await conn.query('DELETE FROM STAFF WHERE ID = 3');
await conn.terminate();
// true
// false
// false true
```

A cursor is read within its transaction. Under autocommit, the server
granting `fetch-ends`, the transaction ends as the cursor does: the
fetch of its last row commits it, `close` commits it, and a fetch that
fails rolls it back.

```js
import { Trust, connectTo, tcp } from 'turborel';

const conn = await connectTo(tcp('127.0.0.1', 7422), 'ann', new Trust());
conn.setAutocommit(true);
const all = await conn.prepare('SELECT ID FROM STAFF ORDER BY ID');
await conn.openCursor(all, [], { rows: 1 });
console.log(conn.inTransaction);
await conn.fetch(all);
console.log(conn.inTransaction);
await conn.terminate();
// true
// false
```

A large object longer than SERVER.LOB_INLINE_BYTES comes as a locator,
valid until its transaction ends, so a result that sent one keeps its
transaction, under autocommit too; commit once its value is read.

## Reset and change of user

`reset()` puts the session back as it was at login: its transaction
rolled back, its prepared statements, cursors, temporary tables and
settings gone, its user and cancel key kept. The server tells each
setting again. A transaction rolled back is told by notice 01T01.

`changeUser(user, mechanism)` authenticates the connection again as
another user, proved by a mechanism, and renews the session as `reset` does,
under a new cancel key; no transaction is active after it. A refusal
closes the connection.

`ping()` asks whether the server answers, with none of its workers
taken.
