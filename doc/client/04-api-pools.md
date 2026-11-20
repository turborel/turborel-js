# Pools

[Contents](README.md)

## NAME

`createPool`, `ClientPool`: connections a program's tasks share.

## SYNOPSIS

```ts
function createPool(settings: string | ConnectOptions, config?: PoolConfig): ClientPool;

class ClientPool {
  readonly pool: Pool;
  connect(): Promise<Client>;
  query(sql: string, params?: readonly Value[], options?: { signal?: AbortSignal }): Promise<Result>;
  close(): Promise<void>;
  [Symbol.asyncDispose](): Promise<void>;
}
```

## DESCRIPTION

`createPool` makes a pool of the connections a URI or options make,
kept as `config` says ([Appendix C](../appendix/c-settings.md)).
`connect` hands out a `Client` of one of them, whose `close`, or
`await using`, gives the connection back, reset, rather than ending it.
`query` runs a statement on one, given back once it is done. `close`
closes the idle connections; `pool` gives the low-level pool beneath
it.

## ERRORS

| SQLSTATE | SQLCODE | When |
|---|---|---|
| 08001 | -919 | No connection came back within `wait`; settings that cannot be read |

The failure of making a connection is `connect`'s own.

## EXAMPLES

```js
import { connect, createPool } from 'turborel';

{
  await using conn = await connect('turborel://ann@127.0.0.1:7422/?tls_mode=disable');
  await conn.query('CREATE TABLE STAFF (ID INTEGER PRIMARY KEY, NAME VARCHAR(20))');
  await conn.query("INSERT INTO STAFF VALUES (1, 'Ada'), (2, 'Grace')");
  await conn.commit();
}
await using pool = createPool('turborel://ann@127.0.0.1:7422/?tls_mode=disable', { max: 2 });
const names = await Promise.all([1n, 2n, 1n].map(async (id) => (await pool.query('SELECT NAME FROM STAFF WHERE ID = ?', [id])).rows[0][0]));
console.log(names);
{
  await using conn = await pool.connect();
  console.log((await conn.query('VALUES CURRENT_USER')).rows);
}
console.log(pool.pool.counts);
// [ 'Ada', 'Grace', 'Ada' ]
// [ [ 'ANN' ] ]
// { made: 2, idle: 2 }
```

## SEE ALSO

[Connections](01-api-connection.md), [Pools](28-pools.md)
