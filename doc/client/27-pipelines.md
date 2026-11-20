# Pipelines

[Contents](README.md)

## NAME

`Connection.pipeline`, `Pipeline`, `Piped`: requests sent at once, one
outcome each.

## SYNOPSIS

```ts
const PIPELINE_WINDOW = 65_536;
type OnError = 'continue' | 'skip';
type Piped =
  | { kind: 'done'; outcome: Outcome }
  | { kind: 'failed'; failure: TurborelError }
  | { kind: 'skipped' };

class Connection { pipeline(): Pipeline }
class Pipeline {
  query(sql: string): this;
  execute(statement: Statement, values?: readonly Value[]): this;
  release(number: number): this;
  onError(onError: OnError): this;
  readonly length: number;
  readonly isEmpty: boolean;
  run(): Promise<Piped[]>;
}
```

## DESCRIPTION

A pipeline queues queries and executions of a connection, then `run`
writes them a window of at most `PIPELINE_WINDOW` bytes at a time, a
longer request alone in its own, and reads each window's replies before
the next is written: one outcome a request, in order. An execution
gives all of a query's rows. Under autocommit each request is its own
transaction. `release` queues a statement's Close and Deallocate by its
number, as a pool's reset does.

Under `onError('skip')`, a savepoint is set before each request but the
first, named `TURBOREL_PIPELINE_` and its place; after a failure the
requests that ran are rolled back to the savepoint set after it, those
not yet written never sent, each `skipped`; the first savepoint is
released; and the batch, one transaction, is committed under autocommit
where it began none.

## ERRORS

| SQLSTATE | SQLCODE | When |
|---|---|---|
| 08006 | -919 | The connection lost, `run` giving no outcome |

A skipping batch that cannot be undone fails `run` with the failure of
undoing it. Each request's own failure is its `failed` outcome.

## EXAMPLES

```js
import { Trust, connectTo, tcp } from 'turborel';

const conn = await connectTo(tcp('127.0.0.1', 7422), 'ann', new Trust());
await conn.query('CREATE TABLE STAFF (ID INTEGER PRIMARY KEY, NAME VARCHAR(20))');
const insert = await conn.prepare('INSERT INTO STAFF VALUES (?, ?)');
const outcomes = await conn
  .pipeline()
  .query("INSERT INTO STAFF VALUES (1, 'ANN')")
  .execute(insert, [2n, 'BOB'])
  .execute(insert, [2n, 'AGAIN'])
  .query('SELECT ID, NAME FROM STAFF ORDER BY ID')
  .run();
for (const piped of outcomes) {
  if (piped.kind === 'done') console.log(piped.outcome.kind === 'rows' ? piped.outcome.rows : piped.outcome.completion.sqlstate);
  else console.log(piped.kind, piped.kind === 'failed' ? piped.failure.sqlstate : '');
}
await conn.query('COMMIT');
await conn.terminate();
// 00000
// 00000
// failed 23000
// [ [ 1n, 'ANN' ], [ 2n, 'BOB' ] ]
```

## SEE ALSO

[Pipelines and Pools](../user/08-pipelines-and-pools.md), [Pools](28-pools.md)
