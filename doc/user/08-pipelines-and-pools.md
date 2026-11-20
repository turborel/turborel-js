# Pipelines and Pools

[Contents](README.md)

This chapter tells how a program sends a batch of requests in one round
trip, shares a bounded set of connections, and holds several named
connections at once.

## Pipelines

A pipeline sends a connection's requests without waiting for each
reply. `pipeline()` begins one; `query` and `execute` queue requests;
`run()` writes them and gives one outcome each, in order: `done` with
its outcome, `failed` with its failure, or `skipped`. The server answers
each request alone and in turn, so a failure is its request's own, and
the requests after it run.

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

Requests are written a window of 64 KiB at a time, its replies read
before the next window is written, so a long batch never leaves client
and server each waiting for the other to read. Under autocommit each
request is its own transaction.

`onError('skip')` makes a batch stop at its first failure, the requests
before it kept: a savepoint is set before each request but the first,
the requests after a failure are rolled back to the savepoint set after
it, and those of a window not yet written are never sent; each is
`skipped`. Such a batch is one transaction, committed as the batch ends
under autocommit where it began none. A session's settings, which no
rollback undoes, are not undone.

`run` fails, giving no outcome, if the connection is lost (SQLSTATE
08006), or if a skipping batch cannot be undone.

## Pools

A `Pool` keeps a bounded set of connections a program's tasks share.
`get()` hands out an idle connection that answers, or makes one while
fewer than `max` are made, or waits for one to come back. It gives a
`Pooled`, whose `connection` is used as any, and which goes back to the
pool as it is released, by `release()`, or as `await using` disposes of
it. A pool is made of `Settings`, or of any function that connects.

```js
import { Pool, Settings } from 'turborel';

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

A connection comes back reset to the session it logged in with, by the
protocol's Reset, which ends its transaction, prepared statements,
cursors, temporary tables and settings and keeps its user; autocommit is
off, then the pool's `reset` statements run. Its check is a Ping. Of a
server that takes neither, the check is ROLLBACK and the reset one
pipeline: its transaction rolled back, the statements it prepared closed
and destroyed, its user and schema those of its login and its time zone
local; a setting a borrower changed by SET stays, unless `reset` sets it
back. [Appendix C](../appendix/c-settings.md) lists the pool's settings.

A connection lost, whose reset fails, that has lived its time, or beyond
`maxIdle` is closed. One idle past `idleTimeout`, or that does not
answer its check, is closed as `get` meets it, and another taken or
made. `get` fails with SQLSTATE 08001 if none comes back within `wait`,
or with the failure of making one. The pool starts nothing of its own:
each wait is the waiting task's. `close()` closes the idle connections.

## The SQL-agent

An `Agent` holds a program's connections, each named, one current, as
SQL-92's SQL-agent does. `query` runs CONNECT TO, SET CONNECTION and
DISCONNECT itself, making connections through a connector the program
gives, and sends every other statement to the current connection. A
connection's name, a server and a user are written as character string
literals; a name is read as an identifier.

```js
import { Agent, Trust, connectTo, tcp } from 'turborel';

const agent = new Agent({ connect: (server, user) => connectTo(tcp('127.0.0.1', 7422), user ?? 'ann', new Trust()) });
await agent.query("CONNECT TO 'db' AS 'reports' USER 'bob'");
await agent.query("CONNECT TO 'db' AS 'admin' USER 'ann'");
console.log(agent.currentName, (await agent.query('VALUES CURRENT_USER')).rows);
await agent.query('ROLLBACK');
await agent.query("SET CONNECTION 'reports'");
console.log(agent.currentName, (await agent.query('VALUES CURRENT_USER')).rows);
await agent.query('ROLLBACK');
await agent.query('DISCONNECT ALL');
// ADMIN [ [ 'ANN' ] ]
// REPORTS [ [ 'BOB' ] ]
```

The current connection's active transaction keeps the agent from
connecting or choosing another (SQLSTATE 0A001), as no transaction spans
servers, and a connection whose transaction is active is not
disconnected (25000).
