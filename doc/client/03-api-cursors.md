# Cursors

[Contents](README.md)

## NAME

`Client.cursor`, `PreparedStatement.cursor`, `Cursor`: a query's rows
as an async iterator, read by `for await`.

## SYNOPSIS

```ts
const DEFAULT_CURSOR_BATCH = 100;

class Cursor implements AsyncIterable<readonly Value[]> {
  readonly columns: readonly ResultColumn[];
  next(): Promise<readonly Value[] | undefined>;
  [Symbol.asyncIterator](): AsyncGenerator<readonly Value[]>;
  close(): Promise<void>;
  [Symbol.asyncDispose](): Promise<void>;
}
```

## DESCRIPTION

A cursor opens with its first batch of rows, `batch` of them, 100
unless told, and fetches the next batch as the rows before it are taken,
so a result of any size is held a batch at a time. `for await` reads its
rows; leaving the loop early, or `close`, or `await using`, closes it.
`next` gives one row at a time, undefined once all are read, the cursor
then closed. A cursor of `Client.cursor` has a statement of its own,
destroyed as it closes; one of a prepared statement leaves the
statement prepared.

A cursor is read within its transaction. Under autocommit, the server
granting `fetch-ends`, the transaction ends as the cursor does: the
fetch of its last row commits it, closing it commits it, a fetch that
fails rolls it back.

## ERRORS

| SQLSTATE | SQLCODE | When |
|---|---|---|
| 24000 | -501 | A prepared statement's cursor opened while another of it is open |
| TB920 | -920 | A fetch cancelled by the cursor's signal |

## EXAMPLES

```js
import { connect } from 'turborel';

await using conn = await connect('turborel://ann@127.0.0.1:7422/?tls_mode=disable');
await conn.query('CREATE TABLE NUMBERS (N INTEGER)');
await conn.query('INSERT INTO NUMBERS VALUES (1), (2), (3), (4), (5)');
let sum = 0n;
for await (const [n] of await conn.cursor('SELECT N FROM NUMBERS WHERE N > ? ORDER BY N', [1n], { batch: 2 })) {
  sum += n;
  if (n === 4n) break;
}
console.log(sum);
await conn.commit();
// 9n
```

## SEE ALSO

[Connections](01-api-connection.md), [Prepared Statements](02-api-statements.md)
