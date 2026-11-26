# Copying, Importing and Exporting

[Contents](README.md)

This chapter tells how a program copies rows into a table in bulk,
imports CSV and tab-separated text, and exports a query's rows.

## Copying

`copyIn(table, columns)` begins a copy into a table, of the columns
named, in order, or of all of them if none, once the server granted
`copy`. `send(row)` sends a row, a value for each column; rows go many
to a message, about 256 KiB of them, with no reply. `finish()` ends the
copy and gives the rows inserted. Until it ends, the connection sends
nothing else but a `ping()` of the copy's; another request fails with
SQLSTATE TB910.

A copy is all or nothing. A row the server refuses fails `finish`,
every row of the copy undone, the failure's detail naming the row, as
`row 2 of the copy`. A copy runs within the session's transaction, or,
under autocommit, is its own. `abandon()` gives it up, every row undone,
and a copy disposed of before it ends, as `await using` disposes of it,
is abandoned. `copyRows(table, columns, rows)` copies the rows an
iterable or an async iterable gives, and abandons the copy if they fail
to come.

`sendText(row)` sends a row of text instead, a string or null for each
column, as a file's fields hold them, where the server grants `columns`.
Such rows go by column, the faster way for a bulk load, and the server
casts each cell to its column's type, so `'42'` goes into an INTEGER
column, a null and an empty string stay apart, and a cell too long fails
`finish`, its row named. A copy may mix rows of values and rows of text.

```js
import { Trust, connectTo, tcp } from 'turborel';

const conn = await connectTo(tcp('127.0.0.1', 7422), 'ann', new Trust());
await conn.query('CREATE TABLE T (ID INTEGER PRIMARY KEY, NAME VARCHAR(10))');
const copy = await conn.copyIn('T', ['ID', 'NAME']);
for (let i = 1; i <= 1000; i += 1) await copy.send([BigInt(i), `name ${i}`]);
console.log(await copy.finish());
try {
  await conn.copyRows('T', [], [[1001n, 'new'], [1n, 'again']]);
} catch (e) {
  console.log(e.sqlstate, e.diagnostics.detail);
}
await conn.query('COMMIT');
await conn.terminate();
// 1000n
// 23000 row 2 of the copy
```

## Importing

`importInto(conn, source, options)` inserts a source's records into the
table `options.table` names. A source gives its headings, if it has
them, which name the table's columns, then its records one at a time,
each with where it began; any object of `headings()` and `record()`
serves. `Delimited` reads CSV, `Dialect.csv()`, or tab-separated text,
`Dialect.tsv()`, from chunks of octets, as a Node.js stream gives them,
a record at a time, with a header if `withHeader()`, another delimiter
by `withDelimiter`, and a text for null by `withNull`: by default an
empty field is null, and `""` the empty string.

The import commits a batch of rows at a time, 1000 unless
`options.batch` says, 0 for all at once, so it begins with no
transaction active. A string for a character string column is assigned
as INSERT assigns it, so one too long is refused, not cut. Where the
server grants `copy`, no bad row is to be skipped, and no column is a
large object's, the rows go by copy, a batch to each: by column, each
field its text as read, where the server grants `columns`.

A row that fails stops the import, its batch rolled back, with an
`ImportError`: where its record began, why, the input's or SQL's, and
how many rows were committed and rolled back. With `options.skip`, a
failing row is skipped instead and given to `options.rejected`, and the
import goes on.

```js
import { writeFileSync, createReadStream } from 'node:fs';
import { Delimited, Dialect, Trust, connectTo, importInto, tcp } from 'turborel';

writeFileSync('staff.csv', 'id,name\n1,Ada\n2,Grace\n2,Again\n3,Edsger\n');
const conn = await connectTo(tcp('127.0.0.1', 7422), 'ann', new Trust());
await conn.query('CREATE TABLE STAFF (ID INTEGER PRIMARY KEY, NAME VARCHAR(20))');
await conn.query('COMMIT');
const source = new Delimited(createReadStream('staff.csv'), Dialect.csv().withHeader());
const done = await importInto(conn, source, {
  table: 'staff',
  skip: true,
  rejected: (row) => console.log('skipped', row.position, row.cause.failure.sqlstate),
});
console.log(done);
await conn.terminate();
// skipped { record: 3, line: 4 } 23000
// { rows: 3n, rejected: 1n }
```

## Exporting

`export(sql, out, format)` runs a query and writes its rows to `out`, a
batch at a time as they come, each write awaited. As `'csv'`: a header
of the columns' names, then a record for each row, each ended by CR LF;
a field quoted where it holds a comma, a quote, a line break or spaces
at either end, a null an empty field, an empty string `""`, any other
value its text as turborel shows it (`textOf`). As `'native'`: the
protocol's own frames, which `readNative` reads back with every value
as it was, of whatever type.

```js
import { Trust, connectTo, readNative, tcp } from 'turborel';

const conn = await connectTo(tcp('127.0.0.1', 7422), 'ann', new Trust());
const out = { write: (bytes) => process.stdout.write(bytes) };
await conn.export('SELECT ID, NAME FROM STAFF ORDER BY ID', out, 'csv');
const frames = [];
await conn.export('SELECT ID, NAME FROM STAFF ORDER BY ID', { write: (bytes) => frames.push(bytes) }, 'native');
const { columns, rows } = await readNative(frames);
console.log(columns.map((c) => c.name), rows);
await conn.terminate();
// ID,NAME
// 1,Ada
// 2,Grace
// 3,Edsger
// [ 'ID', 'NAME' ] [ [ 1n, 'Ada' ], [ 2n, 'Grace' ], [ 3n, 'Edsger' ] ]
```
