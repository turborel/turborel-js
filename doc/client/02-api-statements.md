# Prepared Statements

[Contents](README.md)

## NAME

`Client.prepare`, `PreparedStatement`: a statement prepared once,
executed with parameters as often as wanted.

## SYNOPSIS

```ts
class PreparedStatement {
  readonly statement: Statement;
  readonly columns: readonly ResultColumn[];
  readonly parameterCount: number;
  execute(params?: readonly Value[], options?: { signal?: AbortSignal }): Promise<Result>;
  cursor(params?: readonly Value[], options?: { batch?: number; signal?: AbortSignal }): Promise<Cursor>;
  close(): Promise<void>;
  [Symbol.asyncDispose](): Promise<void>;
}
```

## DESCRIPTION

`prepare` prepares a statement whose parameters are written `?`.
`parameterCount` gives how many it takes, and `columns` a query's
columns, or a CALL's output parameters'. `execute` runs it with a value
for each, giving a `Result` as `query` does: a query's rows, a CALL's
output parameters as one row, or another statement's completion. It
stays valid across transactions. `cursor` opens a cursor of it, a
query. `close`, or `await using`, destroys it; `statement` gives the
low-level client's statement.

## ERRORS

| SQLSTATE | SQLCODE | When |
|---|---|---|
| 42000 | -103 | A statement that cannot be prepared, or a `?` that takes no type where it stands |
| 07001 | -921 | Values not one for each parameter |
| 26000 | -921 | A statement closed |

## EXAMPLES

```js
import { connect } from 'turborel';

await using conn = await connect('turborel://ann@127.0.0.1:7422/?tls_mode=disable');
await conn.query('CREATE TABLE STAFF (ID INTEGER PRIMARY KEY, NAME VARCHAR(20))');
await using insert = await conn.prepare('INSERT INTO STAFF VALUES (?, ?)');
for (const [id, name] of [[1n, 'Ada'], [2n, 'Grace']]) await insert.execute([id, name]);
await using byId = await conn.prepare('SELECT NAME FROM STAFF WHERE ID = ?');
console.log(byId.parameterCount, (await byId.execute([2n])).rows);
await conn.commit();
// 1 [ [ 'Grace' ] ]
```

## SEE ALSO

[Connections](01-api-connection.md), [Cursors](03-api-cursors.md),
[Statements and Cursors](22-statements.md)
