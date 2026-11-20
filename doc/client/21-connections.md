# Connections

[Contents](README.md)

## NAME

`connectTo`, `Connection`, targets, mechanisms, TLS, `Offer`,
`Canceller`: connecting to a server, and the session it gives.

## SYNOPSIS

```ts
function tcp(host: string, port?: number): Target;
function local(path: string): Target;
function overTls(host: string, tls: TlsConfig, port?: number): Target;
function connectTo(target: Target, user: string, mechanism: Mechanism,
  options?: { offer?: Offer; timeouts?: Timeouts }): Promise<Connection>;

class Trust; class Password; class Certificate;
class Scram { constructor(password: string, options?: ScramOptions) }
class KeyCache { size: number; lookups(): Lookups; clear(): void }

function trusting(file: string): TlsConfig;
function roots(file: string | undefined, platform: boolean): string[];
function config(authorities: readonly string[], serverName?: string): TlsConfig;
function presenting(file: string, identity: { chain: string; key: string }): TlsConfig;

class Offer {
  static default(): Offer; static none(): Offer;
  compressed(): Offer; attribute(name: string, value: string): Offer;
}

class Connection {
  static open(stream: FrameStream, user: string, mechanism: Mechanism, options?: OpenOptions): Promise<Connection>;
  readonly authorization: string; readonly server: string;
  readonly granted: readonly string[]; readonly inTransaction: boolean; readonly isLost: boolean;
  has(capability: string): boolean;
  setting(name: string): string | undefined; settings(): ReadonlyMap<string, string>;
  setNoticeHandler(handler?: (notice: Notice) => void): void; takeNotices(): Notice[];
  readTimeout: number | undefined; setReadTimeout(ms?: number): void; setMaxBody(bytes: number): void;
  ping(): Promise<void>; reset(): Promise<void>;
  changeUser(user: string, mechanism: Mechanism): Promise<void>;
  terminate(): Promise<void>; destroy(): void;
}

class Canceller {
  static of(connection: Connection): Canceller | undefined;
  cancel(ms?: number): Promise<void>;
}
```

## DESCRIPTION

`connectTo` connects to `target` and logs in as `user`, proved by
`mechanism`, as [Connecting](../user/02-connecting.md) tells. It asks
for what `options.offer` asks, every capability but compression by
default, and waits as `options.timeouts` says: 30 seconds to connect,
begin TLS and for each step of the login, then without limit. Over TLS
it binds the mechanism to the connection's channel before the login.

`Connection.open` logs in over a stream the program opened itself, a
`FrameStream` of its socket; a TLS stream's channel is bound by
`mechanism.bind(channelOf(socket))` first. Such a connection cannot be
reached again, so has no canceller.

A connection keeps the session's authorization identifier, the
server's product, the capabilities granted in the protocol's order,
and each setting the server told by Status, its last value. Notices go
to the handler set, or the last 64 are kept for `takeNotices`. A
request of a capability not granted fails before it is sent. A failure
of the connection loses it: it takes no more, and its socket is
closed.

`ping` asks whether the server answers, once it granted `ping`.
`reset` puts the session back as it was at login, once it granted
`reset`: its transaction rolled back, told by notice 01T01, its prepared
statements, cursors, temporary tables and settings gone, its user and
cancel key kept. `changeUser` authenticates the connection again as
another user, once it granted `change-user`, and renews the session as
`reset` does, under a new cancel key, the capabilities those granted;
no transaction is active after it, and a refusal closes the connection.
The statements a connection runs are on
[Statements and Cursors](22-statements.md).

`terminate` ends the session, its transaction as SESSION.COMMIT_AT_END
says, waiting for the server to close at most the read timeout, else
60 seconds. `destroy` closes the connection at once. `Canceller.cancel`
sends the session's cancel key over a connection of its own, giving up
after 10 seconds unless told; the statement fails with SQLCODE -920.
The cancel key is never shown by a connection's or a canceller's
display form.

## ERRORS

| SQLSTATE | SQLCODE | When |
|---|---|---|
| 28000 | -919 | A password or SCRAM over plain TCP, refused before connecting; credentials the server refused, as the connection is made or its user changed; a SCRAM exchange whose server did not prove itself, or not bound under `require` |
| 08004 | -919 | The server refused the connection, as of a protocol version it does not speak |
| 08006 | -919 | No connection made, in time; a TLS handshake that failed, as of a server no authority trusted vouches for; a wait that ran out; a reply longer than taken; a request of a capability not granted |
| TB920 | -920 | The statement was cancelled |

## EXAMPLES

```js
import { Trust, connectTo, tcp } from 'turborel';

const conn = await connectTo(tcp('127.0.0.1', 7422), 'ann', new Trust());
console.log(conn.authorization, conn.server);
console.log(conn.setting('SESSION.TIME_ZONE'), conn.granted.includes('ping'));
await conn.terminate();
// ANN turborel 0.0.0 (alpha)
// +00:00 true
```

## SEE ALSO

[Connecting](../user/02-connecting.md), [Errors](30-errors.md),
[Settings](26-settings.md)
