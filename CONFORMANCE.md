# Conformance

What turborel-js implements of turborel's native protocol, version 1,
and of turborel-client's features, row by row. It is the parity matrix
every turborel driver keeps, the same rows in the same order, so one
driver is checked against another and each against turborel-client. A
driver is done when every row is.

The rows come from three documents of turborel, in their order: the
protocol, `doc/client/05-protocol.md`; the client library,
`doc/client/02-library.md`; and its settings, pipelines and pools,
`doc/client/02-library-connections.md`. Each section is one of theirs,
named by its heading and cited as the tests cite it (RULES.md R-DOC-4).
Where the spec and turborel-client's code differ, the code is right, and
the rows follow it: UUID's tag 27, the status names beyond the spec's
four, and the JSON value's body, D89's binary tree in turborel. Last
come the rows of this driver's standard API (RULES.md D2).

**Done** means implemented, tested by tests that cite the section, and
checked against turborel-client. **Not yet** means not implemented.
Choices the driver makes where the protocol leaves them open are listed
beside their rows as they are made.

Contents: [The protocol](#the-protocol) ·
[The client library](#the-client-library) ·
[Settings, pipelines and pools](#settings-pipelines-and-pools) ·
[The standard API](#the-standard-api)

---

## Summary

| Part | Rows | Done |
|---|---|---|
| The protocol | 170 | 0 |
| The client library | 88 | 0 |
| Settings, pipelines and pools | 79 | 0 |
| The standard API | 10 | 0 |
| All | 347 | 0 |

---

## The protocol

From `doc/client/05-protocol.md`.

### Frames

`[PROTOCOL Frames]`

| Row | Status |
|---|---|
| A frame's header, its kind `u8` then its body's length `u32`, written and read | not yet |
| A kind the reader does not know fails the connection (SQLCODE -919, SQLSTATE 08006) | not yet |
| A body cut short fails the connection | not yet |
| Bytes left over after a message's last field fail the connection | not yet |
| Replies taken up to 16 MiB of body unless told otherwise; a longer one fails the connection | not yet |

### Compressed frames

`[PROTOCOL Compressed frames]`

| Row | Status |
|---|---|
| A frame sent compressed, as kind `z`, once `compression` is granted, at a threshold of the client's own | not yet |
| A `z` frame received, inflated to at most its `length`, itself at most the longest body taken | not yet |
| A `z` frame holding another `z` frame fails the connection | not yet |
| A `z` frame that inflates to another length fails the connection | not yet |
| A `z` frame received when `compression` was not granted fails the connection | not yet |

### Values and fields

`[PROTOCOL Values and fields]`

| Row | Status |
|---|---|
| `u8`, `u32` and `u64`, little-endian; `i32 as u32` and `i64 as u64` | not yet |
| `i128`, two's complement, little-endian | not yet |
| flag: 0 or 1; any other byte fails the connection | not yet |
| string: its length `u32`, then its UTF-8 | not yet |
| bytes: its length `u32`, then the bytes | not yet |
| list: its count `u32`, then each item; strings, a list of strings | not yet |
| key: 16 bytes, with no length before them | not yet |
| A count larger than what follows fails as the body runs out, reserving no memory | not yet |

### Data types

`[PROTOCOL Data types]`

| Row | Status |
|---|---|
| 1 CHARACTER: length `u32`, units `u8` | not yet |
| 2 exact numeric: precision `u32`, scale `u32` | not yet |
| 3 approximate numeric: precision `u32` | not yet |
| 4 a plug-in's type: its name, its parameters; one the client lacks read by its name | not yet |
| 5 CHARACTER VARYING: length `u32`, units `u8` | not yet |
| 6 BINARY: length `u32` | not yet |
| 7 BINARY VARYING: length `u32` | not yet |
| 8 DATE: precision `u32` | not yet |
| 9 TIME: precision `u32` | not yet |
| 10 TIME WITH TIME ZONE: precision `u32` | not yet |
| 11 TIMESTAMP: precision `u32` | not yet |
| 12 TIMESTAMP WITH TIME ZONE: precision `u32` | not yet |
| 13 INTERVAL: start field, end field, leading precision, fractional precision; fields 0 YEAR to 5 SECOND | not yet |
| 14 BOOLEAN | not yet |
| 15 DECFLOAT: precision `u32` | not yet |
| 16 array: maximum cardinality `u32`, then the element type | not yet |
| 17 row: each field's name and type | not yet |
| 18 CHARACTER LARGE OBJECT: length `u64`, units `u8` | not yet |
| 19 BINARY LARGE OBJECT: length `u64`, units `u8` | not yet |
| 22 multiset: the element type | not yet |
| 23 structured type: its schema and name, its proper supertypes | not yet |
| 24 reference type: the referenced type's names, scoped `u8`, the scope | not yet |
| 25 JSON | not yet |
| 26 XML: primary and secondary modifiers; of XMLSCHEMA, the schema, namespace and element | not yet |
| 27 UUID, with no parameters (RULES.md D184 in turborel; not yet in the spec's table) | not yet |
| A distinct type read as its source type | not yet |

### Values

`[PROTOCOL Values]`

| Row | Status |
|---|---|
| 0 null | not yet |
| 1 character string, of a CHARACTER or CHARACTER VARYING column | not yet |
| 2 exact number: units `i128`, scale `u32` (RULES.md D6) | not yet |
| 3 approximate number: an IEEE 754 double's bits; NaN and -0.0 kept | not yet |
| 4 a plug-in's value: its type's name, its text, its bytes | not yet |
| 6 binary string | not yet |
| 8 date, as a timestamp | not yet |
| 9 time, as a timestamp | not yet |
| 11 timestamp: zoned, precision, displacement in minutes (-12:59 to +14:00), microseconds in UTC | not yet |
| 13 interval: its qualifier, then units `i128`, months or microseconds | not yet |
| 14 truth value; unknown as null | not yet |
| 15 decimal floating point: coefficient `i128`, exponent `i32 as u32` | not yet |
| 16 array: a list of values, nested | not yet |
| 17 row: a list of values | not yet |
| 20 large object, whole: kind, octets | not yet |
| 21 large object, by locator: kind, locator, octets, characters | not yet |
| 22 multiset: a list of values, in no set order | not yet |
| 23 structured value: its most specific type, its attributes | not yet |
| 24 reference: bytes | not yet |
| 25 JSON: D89's binary tree in turborel, a version octet then nodes of tags 0 to 11, read to a JSON value and written from one | not yet |
| 26 XML: its serialization as CONTENT | not yet |
| 27 UUID: bytes, a count of 16, then the 16 octets (RULES.md D184 in turborel; not yet in the spec's table) | not yet |
| A large object sent whole, or as a locator the client made | not yet |

### Composite fields

`[PROTOCOL Composite fields]`

| Row | Status |
|---|---|
| row: a list of values | not yet |
| column: named flag, name, data type, not null flag | not yet |
| parameter: varying flag, data type | not yet |
| failure: SQLCODE, SQLSTATE, message, cited rule, position, active flag, tail 7 to 15 | not yet |

### The tail

`[PROTOCOL The tail]`

| Row | Status |
|---|---|
| Tags in increasing order; a tag the message does not take, or one not past the last, fails the connection | not yet |
| 1 attributes, on Hello, Query and Execute: at most 32, a name of 1 to 64 bytes, a value of at most 1024 | not yet |
| 2 multi, on Query | not yet |
| 3 cursor, on Execute, Fetch and Close | not yet |
| 4 position, on Complete | not yet |
| 5 more, on Complete | not yet |
| 6 rows, on Complete | not yet |
| 7 severity, on a failure and Notice | not yet |
| 8 detail, on a failure and Notice | not yet |
| 9 hint, on a failure and Notice | not yet |
| 10 context, on a failure and Notice | not yet |
| 11 schema, on a failure and Notice | not yet |
| 12 table, on a failure and Notice | not yet |
| 13 column, on a failure and Notice | not yet |
| 14 data type, on a failure and Notice | not yet |
| 15 constraint, on a failure and Notice | not yet |
| 16 generated, on Complete | not yet |
| 17 conditions, on Complete, each a failure as bytes | not yet |
| 18 time, on Complete: total, queued, locks | not yet |

### Opening a connection

`[PROTOCOL Opening a connection]`

| Row | Status |
|---|---|
| Hello, then Challenge and Answer as the mechanism needs, then Status with `status`, then Ready | not yet |
| A refusal, an Error, after which the server closes | not yet |
| Ready at login never compressed | not yet |

### Mechanisms

`[PROTOCOL Mechanisms]`

| Row | Status |
|---|---|
| `trust` | not yet |
| `password`, only over TLS, a Unix socket or a named pipe | not yet |
| `certificate`, by the TLS client certificate | not yet |
| `scram-sha-256`: client-first, server-first, client-final, server-final, an empty Answer | not yet |
| `scram-sha-256-plus`, bound by `tls-exporter` | not yet |
| `scram-sha-256-plus`, bound by `tls-server-end-point` | not yet |

### Capabilities

`[PROTOCOL Capabilities]`

| Row | Status |
|---|---|
| `notices` | not yet |
| `status` | not yet |
| `diagnostics` | not yet |
| `describe` | not yet |
| `cursors` | not yet |
| `ping` | not yet |
| `reset` | not yet |
| `change-user` | not yet |
| `query-attributes` | not yet |
| `connection-attributes` | not yet |
| `multi-statement` | not yet |
| `compression` | not yet |
| `commit-position` | not yet |
| `copy` | not yet |
| `row-counts` | not yet |
| `generated-values` | not yet |
| `fetch-ends` | not yet |
| `conditions` | not yet |
| No request or tail field of a capability not granted is sent | not yet |

### Requests

`[PROTOCOL Requests]`

| Row | Status |
|---|---|
| Hello `H` | not yet |
| Answer `A` | not yet |
| Query `Q`, with `ends` | not yet |
| Prepare `P` | not yet |
| Execute `E`, with `rows` and `ends` | not yet |
| Fetch `F` | not yet |
| Close `C` | not yet |
| Deallocate `D` | not yet |
| Lob `L` 0 read | not yet |
| Lob `L` 1 create | not yet |
| Lob `L` 2 append | not yet |
| Lob `L` 3 free | not yet |
| Lob `L` 4 hold | not yet |
| Cancel `Z`, on a connection of its own | not yet |
| Terminate `X` | not yet |
| Describe `Y`, of a statement or a cursor | not yet |
| Ping `G` | not yet |
| Reset `W` | not yet |
| ChangeUser `U` | not yet |
| CopyIn `I` | not yet |
| CopyData `J` | not yet |
| CopyEnd `N`, with `abandon` | not yet |
| Requests sent before the last is answered, their replies read in order | not yet |

### Replies

`[PROTOCOL Replies]`

| Row | Status |
|---|---|
| Challenge `C` | not yet |
| Ready `R`: authorization, key, capabilities, server | not yet |
| Prepared `P` | not yet |
| Description `D` | not yet |
| Rows `B` | not yet |
| Suspended `S` | not yet |
| Complete `K` | not yet |
| Error `E` | not yet |
| Lob `L` 0 data | not yet |
| Lob `L` 1 locator | not yet |
| Notice `N` | not yet |
| Status `T` | not yet |
| Pong `G` | not yet |

### Status 'T'

`[PROTOCOL Status 'T']`

| Row | Status |
|---|---|
| AUTHORIZATION | not yet |
| SCHEMA | not yet |
| READ_ONLY, YES or NO | not yet |
| SERVER_VERSION | not yet |
| SERVER_READ_ONLY, YES or NO (`server/src/native/status.rs` in turborel; not yet in the spec) | not yet |
| CATALOG (as above) | not yet |
| OWNER, YES or NO (as above) | not yet |
| Every setting a session may set for itself, SESSION.TIME_ZONE and TRANSACTION.ISOLATION among them | not yet |
| A setting a statement changed, told again; a null as empty | not yet |

### Conversations

`[PROTOCOL Conversations]`

| Row | Status |
|---|---|
| A statement's replies read in their order: Rows, Notices, Statuses, then Complete, Error or Suspended | not yet |

### Errors and notices

`[PROTOCOL Errors and notices]`

| Row | Status |
|---|---|
| Severity ERROR, FATAL, WARNING or NOTICE | not yet |
| A statement's conditions told one way: in Complete with `conditions`, else as Notices with `notices` | not yet |
| 01T01, Reset or ChangeUser rolled back the transaction | not yet |
| TBR01, the replica had not applied REPLICATION.READ_AFTER's position in time | not yet |
| An Error of class 08 but 08003, or of class 28 as the connection is made, ends the connection | not yet |

### A worked example

`[PROTOCOL A worked example]`

| Row | Status |
|---|---|
| The worked example's Hello, Ping, Pong, Query, Rows and Complete, byte for byte | not yet |

---

## The client library

From `doc/client/02-library.md`.

### Connecting

`[CLIENT Connecting]`

| Row | Status |
|---|---|
| Connect over TCP | not yet |
| Connect over a Unix socket, or on Windows the named pipe `\\.\pipe\turborel` | not yet |
| Connect to a target, either, over TLS or not | not yet |
| SCRAM-SHA-256 of a password; refused (08006) unless the server proves it knows the verifier | not yet |
| SCRAM only over TLS, a Unix socket or a named pipe, unless asked to send it in the clear | not yet |
| SCRAM-SHA-256-PLUS over TLS: by `tls-exporter` over TLS 1.3, by the server's certificate over TLS 1.2 | not yet |
| A TLS stream the program opened, bound before SCRAM-PLUS | not yet |
| `password`, sent whole, only over TLS, a Unix socket or a named pipe | not yet |
| `certificate`, presenting a certificate chain and key from PEM files | not yet |
| `trust` | not yet |
| A password or SCRAM refused over plain TCP before connecting (28000) | not yet |
| TLS trusting a PEM file's authorities, the platform's, or both; SSL_CERT_FILE and SSL_CERT_DIR | not yet |
| The server's product and the session's authorization identifier, as Ready told them | not yet |
| Terminate: the transaction as SESSION.COMMIT_AT_END says, its failure given, waiting at most 60 seconds | not yet |

### Timeouts

`[CLIENT Timeouts]`

| Row | Status |
|---|---|
| Connect timeout, for connecting, TLS and each step of the login: 30 seconds by default | not yet |
| Read timeout, for each read or write after: none by default; changed on a connection | not yet |
| A timeout that runs out loses the connection (08006) | not yet |
| A named pipe bounded only as it is opened | not yet |
| The longest reply taken, 16 MiB by default, changed on a connection | not yet |

### Running statements

`[CLIENT Running statements]`

| Row | Status |
|---|---|
| A statement run: a query's columns and rows, or another's completion | not yet |
| A failure's SQLCODE, SQLSTATE, message, rule and position | not yet |
| A query's rows given a batch at a time as they come | not yet |
| Values: exact, approximate, character, binary, datetime, interval, a plug-in's, null | not yet |
| Whether the session's transaction is active | not yet |
| Cancel from elsewhere, giving up after 10 seconds or a limit of the program's | not yet |
| Transactions begin with the first statement and last until COMMIT or ROLLBACK | not yet |
| Autocommit, each statement its own transaction by `ends` | not yet |

### Prepared statements

`[CLIENT Prepared statements]`

| Row | Status |
|---|---|
| Prepare, with dynamic parameters `?` | not yet |
| Execute, as many times as wanted | not yet |
| The parameters' types and a query's columns | not yet |
| Open a cursor, fetch the next batch, close it | not yet |
| Deallocate | not yet |

### Large objects

`[CLIENT Large objects]`

| Row | Status |
|---|---|
| A large object of at most 64 KiB whole in its row; a longer one by its locator | not yet |
| Read a range, by octets or by characters, at most 256 KiB at a time | not yet |
| A reader of the whole, a chunk at a time | not yet |
| A locator keeps its transaction, under autocommit too | not yet |
| Free a locator | not yet |
| Hold a locator past its commit | not yet |
| Create a large object a piece at a time, and send it as a parameter | not yet |
| A CLOB's character split between writes | not yet |

### XML values

`[CLIENT XML values]`

| Row | Status |
|---|---|
| An XML value read as its serialization | not yet |
| Its nodes parsed from it | not yet |
| An XML parameter sent from its text | not yet |
| A value the server cannot serialize fails the fetch (2200W) | not yet |

### UUIDs

`[CLIENT UUIDs]`

| Row | Status |
|---|---|
| A UUID read, its octets and its text | not yet |
| A UUID parameter sent from octets or from text | not yet |

### Importing

`[CLIENT Importing]`

| Row | Status |
|---|---|
| Import the rows of a source into a table over a connection | not yet |
| A source of headings, then records, read in bounded memory | not yet |
| CSV and tab-separated text, with a header, a delimiter and a text for null | not yet |
| Rows committed a batch at a time, 1000 by default, 0 for all at once | not yet |
| A failing row skipped and given to the program, if asked | not yet |
| An import error: where the record began, why, the rows committed and rolled back | not yet |
| Refused with a transaction active | not yet |
| A field longer than 64 KiB for a large object column sent by creating a large object | not yet |

### What a connection asks for

`[CLIENT What a connection asks for]`

| Row | Status |
|---|---|
| Every capability but compression asked for by default | not yet |
| An offer of the program's: none, compression, connection attributes | not yet |
| What was granted | not yet |
| A method needing a capability not granted fails before sending | not yet |

### What the server tells

`[CLIENT What the server tells]`

| Row | Status |
|---|---|
| A session setting's value as last told, and all of them, with no round trip | not yet |
| Notices given to a handler, or the last 64 kept and taken | not yet |
| The last statement's conditions | not yet |
| Rows affected | not yet |
| Generated identity values | not yet |
| The server's time: total, queued, locks | not yet |
| The last commit's position | not yet |
| A failure's diagnostics: severity, detail, hint, context, schema, table, column, data type, constraint | not yet |
| A cursor under autocommit ending its transaction as it ends, with `fetch-ends` | not yet |

### Controlling the session

`[CLIENT Controlling the session]`

| Row | Status |
|---|---|
| Ping | not yet |
| Reset | not yet |
| Change user | not yet |
| Query attributes carried by every later statement | not yet |
| Several statements as one request, each outcome and the failure that stopped the rest | not yet |
| Describe a prepared statement again | not yet |
| Several numbered cursors of one statement open at once | not yet |
| Describe an open cursor | not yet |

### Copying and exporting

`[CLIENT Copying and exporting]`

| Row | Status |
|---|---|
| Copy in, of the columns named or all | not yet |
| Rows sent many to a message, no reply each | not yet |
| Finish, giving the rows inserted | not yet |
| A copy dropped before it finishes abandoned | not yet |
| Copy the rows an iterator gives | not yet |
| Import by copy where granted and no column is a large object | not yet |
| Export as CSV, a header then a record a row | not yet |
| Export as the protocol's frames, and read back with every value as it was | not yet |

### The SQL-agent

`[CLIENT The SQL-agent]`

| Row | Status |
|---|---|
| Named connections, one current | not yet |
| CONNECT, through a connector the program gives | not yet |
| SET CONNECTION | not yet |
| DISCONNECT | not yet |
| Every other statement to the current connection | not yet |

---

## Settings, pipelines and pools

From `doc/client/02-library-connections.md`.

### Connecting by settings

`[CLIENT Connecting by settings]`

| Row | Status |
|---|---|
| Connect as settings say | not yet |
| A password proved by SCRAM-SHA-256; else the certificate named; else trust | not yet |
| A secret mechanism refused over plain TCP before anything is sent (28000) | not yet |

### Where settings come from

`[CLIENT Where settings come from]`

| Row | Status |
|---|---|
| `host`: several, each with its port, IPv6 in brackets, a path a Unix socket or named pipe | not yet |
| `port`: one for all, or one each | not yet |
| `user` | not yet |
| `password` | not yet |
| `tls_mode` | not yet |
| `channel_binding` | not yet |
| `application_name`, sent as the connection attribute `application` | not yet |
| `connect_timeout` | not yet |
| `service` | not yet |
| `service_file` | not yet |
| `passfile` | not yet |
| `target` | not yet |
| `load_balance` | not yet |
| `tls_roots` | not yet |
| `tls_system_roots` | not yet |
| `tls_certificate` and `tls_key` | not yet |
| `server_name` | not yet |
| Layers: the program's options or URI, the service file's section, the environment, the defaults | not yet |
| TURBOREL_HOST, _PORT, _USER, _PASSWORD, _TLS_MODE, _APPLICATION_NAME, _CONNECT_TIMEOUT, _SERVICE, _SERVICE_FILE and _PASSFILE; one set but empty gives nothing | not yet |
| The environment read through a function the program gives | not yet |
| Settings that cannot be read, or that name no user, refused (08001) | not yet |

### The connection URI

`[CLIENT The connection URI]`

| Row | Status |
|---|---|
| `turborel://` with user, password, hosts and ports, and settings | not yet |
| Percent-encoding; IPv6 addresses in brackets; a Unix socket's path | not yet |
| Another scheme, a path, an unknown setting or a pair without `=` refused (08001) | not yet |

### The service file

`[CLIENT The service file]`

| Row | Status |
|---|---|
| Sections of `setting = value` lines; comments and blank lines skipped | not yet |
| A section cannot set `service` or `service_file` | not yet |
| A malformed line refused, its file and line named | not yet |

### The password file

`[CLIENT The password file]`

| Row | Status |
|---|---|
| Lines `host:port:user:password`, `*` matching anything, `\` escaping, `#` comments | not yet |
| The first line that matches taken; a Unix socket matched by its path and the default port | not yet |
| Read only if a regular file, or a link to one | not yet |

### Several servers

`[CLIENT Several servers]`

| Row | Status |
|---|---|
| Hosts tried in order, or in a random order with `load_balance=random` | not yet |
| Each address a name resolves to tried, each step within the connect timeout | not yet |
| A server unreachable, refusing the user, or not of the role asked passed for the next | not yet |
| With none kept, a failure naming each address and why (08001; 28000 if the last refused the user) | not yet |
| `target=read-write` and `read-only`, by SERVER_READ_ONLY | not yet |
| The role read from INFORMATION_SCHEMA.REPLICAS of a server that does not tell it | not yet |
| The role a connection's session sees | not yet |

### TLS by mode

`[CLIENT TLS by mode]`

| Row | Status |
|---|---|
| `disable` | not yet |
| `prefer`, connecting again over plain TCP if the handshake fails | not yet |
| `require` | not yet |
| `verify-ca` | not yet |
| `verify-full`, against `server_name` or the host's | not yet |
| No TLS over a Unix socket or a named pipe | not yet |
| `channel_binding` `disable`, `prefer` and `require`, refusing before any connection (28000) | not yet |

### Pipelines

`[CLIENT Pipelines]`

| Row | Status |
|---|---|
| Queue queries and executions, run them, one outcome each in order | not yet |
| A failure its request's own, the requests after it run | not yet |
| Written a window of 64 KiB at a time, its replies read before the next | not yet |
| Under autocommit, each request its own transaction | not yet |
| Skip on error: a savepoint before each request but the first, the rest rolled back and skipped | not yet |
| A skipping batch one transaction, committed as it ends under autocommit | not yet |
| Run fails if the connection is lost (08006) or a skipping batch cannot be undone | not yet |

### Pools

`[CLIENT Pools]`

| Row | Status |
|---|---|
| A bounded set of connections shared; its clones the same pool | not yet |
| Get an idle connection that answers, or make one under `max`, or wait | not yet |
| A connection given back as it is released | not yet |
| `max` 10 | not yet |
| `max_idle` 10 | not yet |
| `idle_timeout` 10 minutes | not yet |
| `max_lifetime` 1 hour | not yet |
| `wait` 30 seconds | not yet |
| `check`, by Ping, yes | not yet |
| `reset` statements, none | not yet |
| Returned by the protocol's Reset, autocommit off, then the `reset` statements | not yet |
| Of a server without ping or reset: ROLLBACK, and a pipeline that resets | not yet |
| A connection lost, failing its reset, past its lifetime or beyond `max_idle` closed | not yet |
| One idle too long or failing its check closed as `get` meets it | not yet |
| Get fails with 08001 if none comes back within `wait` | not yet |
| A pool of settings, or of anything that makes a connection | not yet |
| No thread or timer started by the pool itself | not yet |

### The SCRAM key cache

`[CLIENT The SCRAM key cache]`

| Row | Status |
|---|---|
| Keys a password derived kept after a login the server proved | not yet |
| One cache for every connection settings make | not yet |
| A cache given to a mechanism the program makes | not yet |
| Its hits and misses | not yet |
| An entry found by the salt, the iterations and a keyed tag of the password | not yet |
| At most 64 entries, the oldest dropped first | not yet |
| An entry dropped when a login that used it fails | not yet |
| Held in the process's memory alone | not yet |

---

## The standard API

This driver's own, over the rows above (RULES.md D2).

### The Promise-based API

`[DESIGN] D2`

| Row | Status |
|---|---|
| `connect`, of a URI or options, giving a connection | not yet |
| `query`, with parameters | not yet |
| `prepare`, and executing the statement | not yet |
| Cursors as async iterators, read by `for await` | not yet |
| Transactions and autocommit | not yet |
| Pools | not yet |
| `close()` and `Symbol.asyncDispose` on connections, cursors and pools | not yet |
| Exact numbers as `bigint` and `Decimal` (RULES.md D6) | not yet |
| Large objects as Node.js streams | not yet |
| Cancel by an `AbortSignal` | not yet |
