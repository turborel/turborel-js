# Installing

[Contents](README.md)

This chapter tells what the driver needs, how a program takes it in, and
how it runs a first query. The driver runs on Node.js 22.12 or later, on
Linux, macOS or Windows, and has no dependency beyond Node.js's own
modules. No package is published until every Turborel driver is done;
until then the driver is built from its source, as the repository's
[README](../../README.md) says.

## Building from source

Until the package is published, a program takes the driver from a clone
of its repository. It needs Node.js 22.12 or later and npm:

```
git clone https://github.com/turborel/turborel-js.git
cd turborel-js
npm ci
npm run build          # the package, in dist/
```

A program then installs it from the clone, as
`npm install ../turborel-js`. The package is an ES module, which a
CommonJS program loads with `require` as well:

```js
import { TurborelError } from 'turborel';
```

```js
const { TurborelError } = require('turborel');
```

## A first query

`connect` takes a `turborel://` URI, or options named as its settings
are, and gives a connection of the standard API. `query` runs a
statement, its `?` taking the values given, and gives its rows; an exact
number of scale 0 comes as a `bigint`. `await using` closes the
connection at the end of its block.

```js
import { connect } from 'turborel';

await using conn = await connect('turborel://ann@127.0.0.1:7422/?tls_mode=disable');
await conn.query('CREATE TABLE STAFF (ID INTEGER PRIMARY KEY, NAME VARCHAR(20))');
await conn.query("INSERT INTO STAFF VALUES (1, 'Ada'), (2, 'Grace'), (3, 'Edsger')");
await conn.commit();
const { rows } = await conn.query('SELECT ID, NAME FROM STAFF WHERE ID < ? ORDER BY ID', [3n]);
for (const [id, name] of rows) console.log(id, name);
// 1n Ada
// 2n Grace
```

## What the package gives

The standard API is `connect` and the `Client` it gives, with prepared
statements, cursors read by `for await`, transactions, large objects as
Node.js streams, statements cancelled by an `AbortSignal`, and pools by
`createPool` ([Connections](../client/01-api-connection.md)).

Beneath it is the low-level client, every feature of turborel-client:
`connectTo` and the connections it makes ([Connecting](02-connecting.md)),
or settings make ([Settings](09-settings.md)); the statements they run
([Running Queries](03-queries.md)); their large objects, copies,
imports and exports ([Copying, Importing and Exporting](07-copying.md));
pipelines, pools and the SQL-agent
([Pipelines and Pools](08-pipelines-and-pools.md)); the error type,
`TurborelError` ([Errors and Diagnostics](10-errors.md)); and the values
and data types the codec reads and writes, among them `Decimal`,
`DecFloat`, `Datetime`, `Json` and `Uuid` ([Values](../client/23-values.md)).
