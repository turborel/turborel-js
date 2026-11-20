# Connections

[Contents](README.md)

## NAME

`connect`, `Client`: a connection of the driver's standard interface, a
Promise-based API for Node.js, with TypeScript types.

## SYNOPSIS

```ts
function connect(settings: string | ConnectOptions): Promise<Client>;
type ConnectOptions = { [setting: string]?: string | number | boolean; autocommit?: boolean };

class Client {
  readonly connection: Connection;
  query(sql: string, params?: readonly Value[], options?: { signal?: AbortSignal }): Promise<Result>;
  prepare(sql: string): Promise<PreparedStatement>;
  cursor(sql: string, params?: readonly Value[], options?: { batch?: number; signal?: AbortSignal }): Promise<Cursor>;
  autocommit: boolean;
  readonly inTransaction: boolean;
  commit(): Promise<void>;
  rollback(): Promise<void>;
  transaction<T>(work: (client: Client) => Promise<T>): Promise<T>;
  readLob(lob: Lob | LobLocator): Readable;
  writeLob(kind: 'character' | 'binary', source: AsyncIterable<Uint8Array | string> | Iterable<Uint8Array | string>): Promise<LobLocator>;
  readonly closed: boolean;
  close(): Promise<void>;
  [Symbol.asyncDispose](): Promise<void>;
}

interface Result {
  readonly rows: readonly (readonly Value[])[];
  readonly columns: readonly Column[];
  readonly rowCount: bigint | undefined;
  readonly completion: Completion | undefined;
}
```

## DESCRIPTION

`connect` connects as a `turborel://` URI, or options named as its
settings are ([Appendix C](../appendix/c-settings.md)), say, and gives a
`Client`; `autocommit` among the options sets it on.

`query` runs a statement; with `params`, its `?` take them in order, by a
statement prepared for it and destroyed after. Its `Result` gives a
query's `rows` and `columns`, or another statement's `completion`, and
`rowCount`, the rows the server counted, where it counts them.
`prepare` gives a [prepared statement](02-api-statements.md), and
`cursor` a [cursor](03-api-cursors.md) of a query's rows.

A transaction begins with the first statement and lasts until `commit`
or `rollback`; under `autocommit` each statement is its own.
`transaction(work)` runs `work` in a transaction of its own, autocommit
off within it: committed as it succeeds, rolled back as it fails.

`readLob` gives a large object's octets as a Node.js readable stream;
`writeLob` writes one from a stream, or any iterable of octets or text,
and gives its locator to pass as a parameter.

An `AbortSignal` given as `signal` cancels its statement as it aborts:
the statement fails with SQLCODE -920 and SQLSTATE TB920, and the
connection goes on; one aborted before the statement is sent fails with
the same codes, and nothing is sent.

A client runs one operation at a time, in the order asked, so concurrent
calls of one client wait their turn. `close`, or `await using`, ends the
connection once its operations are done. `connection` gives the
low-level client beneath it, for what the standard interface has no
place for: copies, pipelines, notices, settings told.

## ERRORS

| SQLSTATE | SQLCODE | When |
|---|---|---|
| TB920 | -920 | The statement was cancelled by its signal |
| TB910 | -910 | An operation of a client closed |
| 25000 | -917 | `transaction` while a transaction is active |
| 08001 | -919 | Settings that cannot be read, or by which no connection is made |

The statement's own failures are the server's, as it reports them.

## EXAMPLES

```js
import { connect } from 'turborel';

await using conn = await connect({ host: '127.0.0.1', port: 7422, user: 'ann', tls_mode: 'disable' });
await conn.query('CREATE TABLE STAFF (ID INTEGER PRIMARY KEY, NAME VARCHAR(20))');
await conn.commit();
await conn.transaction(async (tx) => {
  await tx.query('INSERT INTO STAFF VALUES (?, ?)', [1n, 'Ada']);
  await tx.query('INSERT INTO STAFF VALUES (?, ?)', [2n, 'Grace']);
});
const inserted = await conn.query("INSERT INTO STAFF VALUES (3, 'Edsger')");
console.log(inserted.rowCount, inserted.completion.sqlstate, conn.inTransaction);
await conn.rollback();
console.log((await conn.query('SELECT COUNT(*) FROM STAFF')).rows);
try {
  await conn.query('VALUES 1', [], { signal: AbortSignal.abort() });
} catch (e) {
  console.log(e.sqlcode, e.sqlstate);
}
// 1n 00000 true
// [ [ 2n ] ]
// -920 TB920
```

## SEE ALSO

[Installing](../user/01-installing.md), [Prepared Statements](02-api-statements.md),
[Cursors](03-api-cursors.md), [Pools](04-api-pools.md),
[Connections](21-connections.md)
