# Pools

[Contents](README.md)

## NAME

`Pool`, `Pooled`, `PoolConfig`, `Connection.giveBack`: a bounded set of
connections tasks share.

## SYNOPSIS

```ts
type PoolSource = Settings | (() => Promise<Connection>);
interface PoolConfig {
  max?: number; maxIdle?: number; idleTimeout?: number | undefined; maxLifetime?: number | undefined;
  wait?: number; check?: boolean; reset?: readonly string[];
}

class Pool {
  constructor(source: PoolSource, config?: PoolConfig);
  get(): Promise<Pooled>;
  readonly counts: { made: number; idle: number };
  close(): void;
}

class Pooled {
  readonly connection: Connection;
  release(): Promise<void>;
  [Symbol.asyncDispose](): Promise<void>;
}

class Connection { giveBack(more?: readonly string[]): Promise<void> }
```

## DESCRIPTION

`get` hands out an idle connection, checked to answer if `check`, by
Ping, else ROLLBACK; else makes one while fewer than `max` are made;
else waits for one to come back, at most `wait` milliseconds. Times are
in milliseconds; `idleTimeout` and `maxLifetime` undefined for no limit.
`release`, once, gives a connection back: past `maxLifetime`, closed;
else `giveBack` resets it, and it is kept idle if fewer than `maxIdle`
are, else closed. `close` closes the idle connections.

`giveBack` puts a session back as it logged in: autocommit off; by the
protocol's Reset where granted, then `more`; else, in one pipeline,
ROLLBACK, each statement it prepared closed and destroyed, SET SESSION
AUTHORIZATION and SET SCHEMA of its login, SET TIME ZONE LOCAL, then
`more`. A session that prepared more than `RESET_MOST_STATEMENTS`, 256,
is not given back, but closed.

## ERRORS

| SQLSTATE | SQLCODE | When |
|---|---|---|
| 08001 | -919 | No connection came back within `wait` |
| 08006 | -919 | `giveBack` of a connection lost, or past 256 statements left prepared |

The failure of making a connection is `get`'s own.

## EXAMPLES

```js
import { Pool, Settings, Trust, connectTo, tcp } from 'turborel';

const conn = await connectTo(tcp('127.0.0.1', 7422), 'ann', new Trust());
await conn.query('CREATE TABLE STAFF (ID INTEGER PRIMARY KEY, NAME VARCHAR(20))');
await conn.query("INSERT INTO STAFF VALUES (1, 'ANN'), (2, 'BOB')");
await conn.query('COMMIT');
await conn.terminate();
const pool = new Pool(Settings.fromUri('turborel://ann@127.0.0.1:7422/?tls_mode=disable'), { max: 2 });
const work = async (id) => {
  await using lent = await pool.get();
  const { rows } = await lent.connection.query(`SELECT NAME FROM STAFF WHERE ID = ${id}`);
  return rows[0][0];
};
console.log(await Promise.all([work(1), work(2), work(1)]));
console.log(pool.counts);
pool.close();
// [ 'ANN', 'BOB', 'ANN' ]
// { made: 2, idle: 2 }
```

## SEE ALSO

[Pipelines and Pools](../user/08-pipelines-and-pools.md),
[Appendix C](../appendix/c-settings.md), [Settings](26-settings.md)
