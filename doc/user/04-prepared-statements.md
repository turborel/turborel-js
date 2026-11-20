# Prepared Statements

[Contents](README.md)

A statement prepared once runs as often as wanted, with new values for
its parameters each time. This chapter tells how a program prepares and
executes a statement, reads a query's rows in parts through a cursor,
and lets a statement go.

## Preparing and executing

`prepare(sql)` prepares a statement whose dynamic parameters are written
`?`, and gives a `Statement`: `parameters`, the type each `?` takes, and
`columns`, a query's columns. `execute(statement, values)` runs it with a
value for each parameter, and gives its outcome as `query` does. A
statement stays valid across transactions, until `deallocate` lets it
go.

```js
import { Trust, connectTo, tcp } from 'turborel';

const conn = await connectTo(tcp('127.0.0.1', 7422), 'ann', new Trust());
const byId = await conn.prepare('SELECT NAME FROM STAFF WHERE ID = ?');
console.log(byId.parameters.map((p) => p.type.kind), byId.columns.map((c) => c.name));
console.log((await conn.execute(byId, [1n])).rows);
console.log((await conn.execute(byId, [2n])).rows);
await conn.deallocate(byId);
await conn.terminate();
// [ 'exact' ] [ 'NAME' ]
// [ [ 'Ada' ] ]
// [ [ 'Grace' ] ]
```

Values too few or too many for the parameters fail with SQLSTATE 07001;
a statement deallocated, with 26000.

A CALL's parameters are its inputs alone. Its columns are one for each
`?` of an OUT or INOUT parameter, in the procedure's parameter order, so
an INOUT `?` is both; `execute` gives their values once the procedure
ran, as one row.

```js
import { Trust, connectTo, tcp } from 'turborel';

const conn = await connectTo(tcp('127.0.0.1', 7422), 'ann', new Trust());
await conn.query(
  'CREATE PROCEDURE TWICE(IN A INTEGER, OUT C INTEGER) LANGUAGE SQL CONTAINS SQL BEGIN SET C = A * 2; END',
);
const call = await conn.prepare('CALL TWICE(?, ?)');
console.log(call.parameters.length, call.columns.map((c) => c.name));
console.log((await conn.execute(call, [21n])).rows);
await conn.query('ROLLBACK');
await conn.terminate();
// 1 [ 'C' ]
// [ [ 42n ] ]
```

## Cursors

`openCursor(statement, values, { rows })` opens a cursor of a prepared
query and gives its first `rows` rows, all if 0, and whether it has
more. `fetch(statement, { rows })` gives the next batch, and the cursor
closes once its last row is read; `close(statement)` closes it sooner.
A cursor already open fails a second open with SQLSTATE 24000, as a
fetch or close of one not open does.

```js
import { Trust, connectTo, tcp } from 'turborel';

const conn = await connectTo(tcp('127.0.0.1', 7422), 'ann', new Trust());
const all = await conn.prepare('SELECT ID, NAME FROM STAFF ORDER BY ID');
let batch = await conn.openCursor(all, [], { rows: 1 });
console.log(batch);
while (batch.more) {
  batch = await conn.fetch(all, { rows: 1 });
  console.log(batch);
}
await conn.query('COMMIT');
await conn.terminate();
// { rows: [ [ 1n, 'Ada' ] ], more: true }
// { rows: [ [ 2n, 'Grace' ] ], more: false }
```

A statement has several cursors open at once, each numbered by the
program, `{ cursor: n }`, once the server granted `cursors`; 0 is the
one opened unless told. `describeCursor(statement, n)` gives an open
cursor's columns, and `describe(statement)` the statement's parameters
and columns as they are now, once the server granted `describe`.

## XML and UUID values

An XML value comes as an `Xml`: `text` is its serialization, and
`nodes()` parses it for its elements, attributes, text, comments and
processing instructions. A parameter of an XML type is made of its
text, `new Xml(text)`. A value the server cannot serialize, such as an
attribute standing alone, fails the fetch with SQLSTATE 2200W.

A UUID comes as a `Uuid`: `octets` holds its 16 octets and `String(u)`
gives its text. A parameter is made of its octets, `new Uuid(octets)`,
or of its text, `Uuid.parse(text)`.

```js
import { Trust, Uuid, Xml, connectTo, tcp } from 'turborel';

const conn = await connectTo(tcp('127.0.0.1', 7422), 'ann', new Trust());
await conn.query('CREATE TABLE ORDERS (ID UUID, BODY XML)');
const insert = await conn.prepare('INSERT INTO ORDERS VALUES (?, ?)');
const id = Uuid.parse('919108f7-52d1-4320-9bac-f847db4148a8');
await conn.execute(insert, [id, new Xml('<order no="18"><item>jam</item></order>')]);
const { rows } = await conn.query('SELECT ID, BODY FROM ORDERS');
const [uuid, body] = rows[0];
console.log(String(uuid), body.text);
const [order] = body.nodes();
console.log(order.name, order.attributes[0].value, order.children[0].children[0].text);
await conn.query('ROLLBACK');
await conn.terminate();
// 919108f7-52d1-4320-9bac-f847db4148a8 <order no="18"><item>jam</item></order>
// order 18 jam
```
