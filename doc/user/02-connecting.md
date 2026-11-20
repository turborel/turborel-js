# Connecting

[Contents](README.md)

A program connects to a server, proves which user it is, and is given
a session of the server's. This chapter tells how, through the
low-level client; the standard API's `connect`, which takes a
`turborel://` URI, is built at milestone M7 over the same connection.

## Where the server is

A target says where the server is and how it is reached:

- `tcp(host, port)`: over TCP, port 7422 unless told another.
- `local(path)`: over a Unix socket, or on Windows a named pipe, as
  `\\.\pipe\turborel`. Only the server's own machine reaches either.
- `overTls(host, tls, port)`: over TLS, begun on the server's TCP port.
  `tls` says which certificate authorities are trusted, and the
  server's certificate is checked against `host`, or the `serverName`
  the configuration gives.

`connectTo(target, user, mechanism, options)` connects, logs in, and
gives a `Connection`. The user is read by the server as an identifier,
so `ann` logs in as ANN.

```js
import { Trust, connectTo, tcp } from 'turborel';

const conn = await connectTo(tcp('127.0.0.1', 7422), 'ann', new Trust());
console.log(conn.authorization, conn.server);
console.log(conn.setting('SESSION.TIME_ZONE'), conn.granted.includes('ping'));
await conn.terminate();
// ANN turborel 0.0.0 (alpha)
// +00:00 true
```

## Proving the user

| Mechanism | Proves the user by | Where |
|---|---|---|
| `new Scram(password)` | SCRAM-SHA-256: the password proved, never sent, and the server made to prove it knows the user's verifier | over TLS, a Unix socket or a named pipe |
| `new Password(password)` | the password, sent whole | over TLS, a Unix socket or a named pipe |
| `new Certificate()` | the TLS client certificate, whose common name names the user | over TLS presenting one (`presenting`) |
| `new Trust()` | nothing: the server trusts a client of its own machine, where SERVER.TRUST_LOCAL is ON | anywhere the server's machine is |

Over TLS, SCRAM binds its exchange to the connection, so a server in
the middle cannot relay it: over TLS 1.3 by `tls-exporter`, over TLS
1.2 by the hash of the certificate the server presented. Its option
`channelBinding` is `prefer` by default; `require` refuses a connection
it cannot bind, `disable` binds nothing.

```js
import { Scram, connectTo, overTls, trusting } from 'turborel';

const target = overTls('localhost', trusting('/etc/turborel/ca.pem'), 7422);
const conn = await connectTo(target, 'ann', new Scram('pencil'));
console.log(conn.authorization, conn.server);
await conn.terminate();
// ANN turborel 0.0.0 (alpha)
```

A password, or SCRAM, is never sent over plain TCP: `connectTo` refuses
it before it connects. SCRAM goes over plain TCP only if the program
asks, `new Scram(password, { inTheClear: true })`, for a server whose
SERVER.SCRAM_WITHOUT_TLS is ON.

```js
import { Password, connectTo, tcp } from 'turborel';

try {
  await connectTo(tcp('127.0.0.1', 7422), 'ann', new Password('pencil'));
} catch (e) {
  console.log(e.sqlcode, e.sqlstate, e.message);
}
// -919 28000 password is sent only over TLS, a Unix socket or a named pipe, never over plain TCP
```

A `KeyCache` given to SCRAM keeps the keys a password derives, so a
later login to a server of the same salt and iterations skips the slow
step: `new Scram(password, { cache })`.

## TLS

`trusting(file)` trusts the authorities of a PEM file;
`roots(file, platform)` those of a file, the platform's, or both, the
platform's being those of the files SSL_CERT_FILE and SSL_CERT_DIR
name if either is set; `config(authorities, serverName)` makes a
configuration of them. `presenting(file, { chain, key })` presents a
certificate chain and key too, for the mechanism `certificate`.

## Waiting

`options.timeouts` says how long a connection waits on its server, in
milliseconds: `connect`, to connect, begin TLS and for each step of the
login, 30 seconds by default; `read`, for each read or write after,
with no limit by default, as a statement may run as long as it must.
`setReadTimeout` changes it. A wait that runs out loses the connection
(SQLSTATE 08006). A named pipe is bounded only as it is opened. A reply
is taken up to 16 MiB unless `setMaxBody` says otherwise.

## What a connection asks for

`options.offer` says what the connection asks for: every capability but
compression by default (`Offer.default()`), none (`Offer.none()`),
compression too (`compressed()`), and connection attributes
(`attribute(name, value)`), which the server shows in
INFORMATION_SCHEMA.CONNECTION_ATTRIBUTES. `granted` gives what the
server granted, and a request of a capability not granted fails before
it is sent. `setting(name)` gives a session setting as the server last
told it, and `settings()` all of them.

## Ending

`terminate()` ends the session, its transaction as
SESSION.COMMIT_AT_END says, and waits for the server to close, at most
the read timeout, else 60 seconds; a commit that fails then is given as
the failure. `Canceller.of(conn)` gives what cancels the statement the
connection runs, from elsewhere: `cancel()` reaches the server again,
as the connection did, and the statement fails with SQLCODE -920
(SQLSTATE TB920).
