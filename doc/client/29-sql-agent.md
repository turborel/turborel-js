# The SQL-agent

[Contents](README.md)

## NAME

`Agent`, `Connector`: a program's named connections, one current.

## SYNOPSIS

```ts
interface Connector {
  connect(server: string | undefined, user: string | undefined): Promise<Connection>;
}

class Agent {
  constructor(connector: Connector, connection?: Connection);
  query(sql: string): Promise<Outcome>;
  queryInto(sql: string, sink: Sink): Promise<Streamed>;
  connectionStatement(sql: string): Promise<Completion | undefined>;
  current(): Connection;
  readonly currentConnection: Connection | undefined;
  readonly currentName: string | undefined;
  readonly warning: string | undefined;
  readonly isLost: boolean;
  canceller(): Canceller | undefined;
  terminate(): Promise<void>;
}
```

## DESCRIPTION

An agent runs SQL-92's connection statements itself: CONNECT TO a
server \[AS a name\] \[USER a user\], or TO DEFAULT; SET CONNECTION a
name, or DEFAULT; DISCONNECT a name, DEFAULT, ALL or CURRENT; each value
a character string literal. CONNECT makes a connection through the
connector, named by its name, else its server, read as an identifier,
and makes it current; the connection begun with, if given, is the
default one. Every other statement goes to the current connection.
`terminate` ends every connection.

## ERRORS

| SQLSTATE | SQLCODE | When |
|---|---|---|
| 08003 | -919 | No current connection; SET CONNECTION or DISCONNECT of a connection not held |
| 08002 | -919 | CONNECT of a name in use |
| 08001 | -919 | The connector could not reach the server |
| 08004 | -919 | The server refused the connection |
| 0A001 | -900 | CONNECT or SET CONNECTION while the current connection's transaction is active |
| 25000 | -917 | DISCONNECT of a connection whose transaction is active |
| 28000 | -104 | A user that is no authorization identifier |
| 2E000 | -919 | A connection name that is no identifier |
| 2A000 | -102 or -103 | A connection statement malformed, or naming by a value that is no character string literal |

A DISCONNECT that failed to end a connection completes with warning
01002.

## EXAMPLES

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

## SEE ALSO

[Pipelines and Pools](../user/08-pipelines-and-pools.md), [Connections](21-connections.md)
