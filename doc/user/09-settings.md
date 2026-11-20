# Settings

[Contents](README.md)

A program may connect as settings say rather than naming a target and
a mechanism itself: where the servers are, as whom to connect, how, and
what a server must be. This chapter tells where settings come from, how
several servers are tried, and how TLS protects a connection.

## Connecting by settings

`Settings.fromUri(uri)` reads a connection URI, and `connect()`
connects as it says, giving a connection like `connectTo`'s. A password
the settings give is proved by SCRAM-SHA-256; with none, the user is
proved by the client's certificate if one is named, else trusted as a
local client. A password is refused over plain TCP before anything is
sent (SQLSTATE 28000).

```js
import { Settings } from 'turborel';

const settings = Settings.fromUri('turborel://ann@127.0.0.1:7422/?tls_mode=require&application_name=reports');
const conn = await settings.connect();
console.log(conn.server, conn.authorization, conn.target.kind);
await conn.terminate();
// turborel 0.0.0 (alpha) ANN tls
```

## Where settings come from

Each setting has a name, the same in the program's options, a URI's
query and a service file; [Appendix C](../appendix/c-settings.md) lists
them, with their defaults. Settings come in layers, each setting taken
from the first that has it:

1. the program's own: `Options` it fills by `set(name, value)`, or a
   connection URI;
2. the section of the service file the program or the environment
   names;
3. the environment's variables, TURBOREL_HOST and the like, a variable
   set but empty giving nothing;
4. the defaults.

`Settings.resolve(options)` lays them, reading `process.env`;
`Settings.resolveIn(options, variable)` reads the environment through a
function the program gives. A setting that cannot be read, a service
file that cannot be read or has no section of the name, and settings
that name no user are refused with SQLSTATE 08001.

### The connection URI

```text
turborel://[user[:password]@][host[:port][,host[:port]]...][/][?setting=value[&setting=value]...]
```

Its parts are percent-encoded, so `p%40ss` is the password `p@ss` and
`%2Frun%2Fturborel.sock` a Unix socket; an IPv6 address is written in
brackets. A server serves one database, so the URI names none, and has
no path. A URI of another scheme, of a path, of a setting not named or
of a pair without `=` is refused (SQLSTATE 08001).

### The service file

A service file names sets of settings: sections, each `[name]` on a line
of its own, then lines `setting = value`. A line beginning with `#` is a
comment, and blank lines are skipped. A section cannot set `service` or
`service_file`. A malformed line is refused, its file and line named.

### The password file

A password the settings do not give is looked up in the password file,
by the server and the user each connection is made to. Each line is
`host:port:user:password`; a field `*` matches anything; `\` takes the
character after it as it is, so `\:` is a colon in a field and `\*` a
star; a line beginning with `#` is a comment. The first line that
matches is taken. A Unix socket is matched by its path, and the default
port. The file is read only if it is a regular file, or a link to one;
its owner answers for keeping it private.

```js
import { writeFileSync } from 'node:fs';
import { Options, Settings, role } from 'turborel';

writeFileSync('pass', '127.0.0.1:7422:bob:bob-secret\n');
writeFileSync('services.conf', '[reports]\nhost = 127.0.0.1:1,127.0.0.1:7422\nuser = bob\ntls_mode = require\npassfile = pass\ntarget = read-write\n');
const options = new Options().set('service', 'reports').set('service_file', 'services.conf');
const settings = Settings.resolve(options);
const conn = await settings.connect();
console.log(conn.authorization, await role(conn), conn.target.kind);
await conn.terminate();
try {
  await Settings.fromUri('turborel://ann@127.0.0.1:1,127.0.0.1:2/?tls_mode=disable').connect();
} catch (e) {
  console.log(e.sqlstate, e.message);
}
// BOB read-write tls
// 08001 no server was kept: 127.0.0.1 (127.0.0.1:1): cannot connect: connect ECONNREFUSED 127.0.0.1:1; 127.0.0.1 (127.0.0.1:2): cannot connect: connect ECONNREFUSED 127.0.0.1:2
```

## Several servers

`host` may name several servers. They are tried in the order given, or,
with `load_balance=random`, in an order drawn at random for each
connection. A name is tried at each address it resolves to, each step
within the connect timeout. A server that cannot be reached, refuses the
user, or is not of the role asked is passed for the next. With none
kept, the failure names each address and why (SQLSTATE 08001; 28000 if
the last refused the user).

`target=read-write` keeps a server that takes changes: a server alone,
or its group's primary. `target=read-only` keeps a replica that follows
its group. A server tells each session whether it takes changes, as its
SERVER_READ_ONLY status; of one that does not, the role is read from
INFORMATION_SCHEMA.REPLICAS. `role(conn)` gives the role a connection's
session sees.

## TLS by mode

`tls_mode` says how a connection over TCP uses TLS; a Unix socket or a
named pipe uses none.

| Mode | TLS | The server's certificate |
|---|---|---|
| `disable` | Never | |
| `prefer` | If the server takes it, else plain TCP | Not checked |
| `require` | Always | Not checked |
| `verify-ca` | Always | Signed by an authority trusted |
| `verify-full` | Always | Signed by an authority trusted, and of the server's name |

`verify-ca` and `verify-full` need the authorities trusted:
`tls_roots`, or `tls_system_roots`. The name checked is `server_name`,
else the host's. Under `prefer`, a server reached whose TLS handshake
fails is connected to again over plain TCP; one that cannot be reached
is not tried twice. `tls_certificate` and `tls_key` present the client's
certificate.

`channel_binding` says whether SCRAM binds its exchange to the TLS
connection carrying it: `prefer` where the connection has a binding,
`disable` never, and `require` refuses, before any connection, settings
whose mechanism binds nothing, or a connection not over TLS (SQLSTATE
28000).

One SCRAM key cache, `keyCache`, serves every connection the same
settings make, so a reconnection skips the slow derivation of its keys.
