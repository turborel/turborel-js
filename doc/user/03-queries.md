# Running Queries

[Contents](README.md)

A connection runs one statement at a time, in its session. This chapter
tells how a program runs a statement, reads a query's rows, whole or a
batch at a time, and what the server tells of each statement.

## Running a statement

`query(sql)` runs one SQL statement and gives its outcome. A query gives
`{ kind: 'rows', columns, rows }`: each column's name and type, and each
row an array of values, one for each column. Any other statement gives
`{ kind: 'done', completion }`, its SQLCODE and SQLSTATE: 0 and 00000,
100 and 02000 where it found no row, or a warning's. A statement that
fails rejects the promise with a `TurborelError`, as
[Errors and Diagnostics](10-errors.md) tells.

```js
import { Trust, connectTo, tcp } from 'turborel';

const conn = await connectTo(tcp('127.0.0.1', 7422), 'ann', new Trust());
await conn.query('CREATE TABLE STAFF (ID INTEGER PRIMARY KEY, NAME VARCHAR(20))');
const insert = await conn.query("INSERT INTO STAFF VALUES (1, 'Ada'), (2, 'Grace')");
console.log(insert.kind, insert.completion.sqlstate, conn.rowsAffected);
const staff = await conn.query('SELECT ID, NAME FROM STAFF ORDER BY ID');
console.log(staff.columns.map((c) => c.name), staff.rows);
try {
  await conn.query('SELECT * FROM NOPE');
} catch (e) {
  console.log(e.sqlcode, e.sqlstate, e.message);
}
await conn.query('COMMIT');
await conn.terminate();
// done 00000 2n
// [ 'ID', 'NAME' ] [ [ 1n, 'Ada' ], [ 2n, 'Grace' ] ]
// -103 2A000 table ANN.NOPE is not defined
```

## Values

Each value comes as the JavaScript value that holds it exactly
([Appendix A](../appendix/a-types.md)): an exact number of scale 0 as a
`bigint`, any other as a `Decimal`; an approximate number as a `number`;
a character string as a `string`; a binary string as a `Uint8Array`; a
date, time or timestamp as a `Datetime`; an interval as an `Interval`;
a value of a plug-in's type as a `PluginValue`; a UUID as a `Uuid`; an
XML value as an `Xml`; a null as `null`.

```js
import { Trust, connectTo, tcp } from 'turborel';

const conn = await connectTo(tcp('127.0.0.1', 7422), 'ann', new Trust());
const { rows } = await conn.query(
  "VALUES (CAST(1.5 AS DECIMAL(5,2)), 2.5E0, 'text', X'0A0B', 7, CAST(NULL AS INTEGER), DATE '2026-11-19', INTERVAL '90' MINUTE)",
);
const [exact, approximate, text, binary, integer, none, date, interval] = rows[0];
console.log(String(exact), approximate, text, binary, integer, none);
console.log(date.moment, date.utc, interval.qualifier.start, interval.units);
await conn.terminate();
// 1.50 2.5 text Uint8Array(2) [ 10, 11 ] 7n null
// date 63930643200000000n MINUTE 5400000000n
```

A `Datetime`'s instant is in microseconds in UTC from 0001-01-01
00:00:00; a date's is its midnight's.

## Rows a batch at a time

`queryInto(sql, sink)` runs a statement as `query` does, but gives a
query's columns to `sink.columns` and its rows to `sink.rows` as each
batch comes, so no more than a batch is held. A promise either returns
is awaited before the next batch is read. It gives how many rows went to
the sink, or another statement's completion.

## Several statements in one request

`queryMany(sql)` sends several statements, separated by semicolons, in
one request. The server runs each in order, and the first that fails
stops the rest: the result gives each statement's outcome that ran, and
the failure that stopped them, if one did.

```js
import { Trust, connectTo, tcp } from 'turborel';

const conn = await connectTo(tcp('127.0.0.1', 7422), 'ann', new Trust());
let total = 0;
const streamed = await conn.queryInto('SELECT A.ID, B.ID FROM STAFF A, STAFF B', {
  columns: (columns) => console.log(columns.length, 'columns'),
  rows: (rows) => {
    total += rows.length;
  },
});
console.log(streamed, total);
const ran = await conn.queryMany("INSERT INTO STAFF VALUES (3, 'Edsger'); INSERT INTO STAFF VALUES (3, 'Again'); COMMIT");
console.log(ran.outcomes.length, ran.failure.sqlstate, ran.failure.message);
await conn.query('ROLLBACK');
await conn.terminate();
// 2 columns
// { kind: 'rows', count: 4 } 4
// 1 23000 PRIMARY KEY ANN.STAFF_PRIMARY1 (ID) of ANN.STAFF would be violated: a row of these values is there
```

## What the server tells

After each statement the connection keeps what its completion told:

- `rowsAffected`: the rows it inserted, updated, deleted or merged, or
  the rows a query returned, once all were read;
- `lastGenerated`: the identity values an INSERT generated, in the order
  of its rows, as SQL writes them;
- `serverTime`: the server's time for it in microseconds, `total`, with
  the time it waited for a worker, `queued`, and for locks, `locks`;
- `commitPosition`: the log position of the last commit, which a
  replica's session can wait for;
- `warning`: the SQLSTATE of the warning it completed with, if it did;
- `conditions`: the warnings and conditions it raised.

Each is given where the server granted the capability that carries it,
as a connection asks by default.

## Query attributes

`setQueryAttributes([[name, value], ...])` gives attributes every later
statement carries, until set again, read in SQL by
`QUERY_ATTRIBUTE(name)`. The attribute `traceparent` is the request's
trace context.
