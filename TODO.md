# TODO

Open work, by milestone. Each item says what is missing. How the driver
is built is in [RULES.md](RULES.md), and the parity matrix every item
ends in is [CONFORMANCE.md](CONFORMANCE.md). Finished work leaves this
file, and git keeps its history.

Code never cites this file (RULES.md R-DOC-5).

[M1 Codec](#m1-codec) · [M2 Connect](#m2-connect) ·
[M3 Statements](#m3-statements) ·
[M4 Large objects and bulk](#m4-large-objects-and-bulk) ·
[M5 Settings](#m5-settings) · [M6 Throughput](#m6-throughput) ·
[M7 Standard API](#m7-standard-api) · [M8 Parity audit](#m8-parity-audit)

---

## M1 Codec

The protocol's encoding, without I/O, in `src/codec/`, each part with
codec tests from the spec.

- A reader and a writer of fields: integers, `i128` as `bigint`, flags,
  strings, bytes, lists and keys, a count checked against what follows
  before anything is allocated by it.
- The 27 data types and values, UUID's tag 27 among them, at their edges:
  `i128` limits, scales, NaN and -0.0, DECFLOAT, each interval qualifier,
  displacements, nested arrays, rows, multisets and structured values,
  locators, each XML modifier.
- `Decimal`, and the mapping of every value to JavaScript and back
  (RULES.md D6), recorded as a decision.
- JSON values as D89's binary tree in turborel, every node, read to a
  JSON value and written from one.
- The tail, its tags in order, and the column, parameter and failure
  fields.
- Every request written and every reply read, malformed ones failing the
  connection.
- Compressed frames, by `node:zlib`, inflated within the longest body.
- `TurborelError` given a failure's position and diagnostics.
- The worked example as the first test of whole messages.
- A check in `verify` that every test's `Verifies:` tag is well formed,
  so R-TRACE-1 is held by a tool.

## M2 Connect

- TCP on port 7422, Unix sockets, and Windows named pipes.
- TLS begun on the same port, verified by mode.
- Every mechanism: trust, password, certificate, SCRAM-SHA-256 and
  SCRAM-SHA-256-PLUS by `tls-exporter` and `tls-server-end-point`, with
  the key cache.
- Hello, capabilities, Ready and Status.
- Connect and read timeouts, terminate and cancel.
- The live tests against `ghcr.io/turborel/turborel:nightly`, with test
  certificates, SCRAM users and TRUST_LOCAL, set up in `test/server/`.

## M3 Statements

- Query, and rows streamed a batch at a time.
- Prepared statements, numbered cursors and describe.
- Errors, diagnostics, notices and conditions.
- Autocommit, and `fetch-ends`.
- Completion details: rows affected, generated values, server time,
  commit position.
- Multi-statement queries, query attributes, ping, reset and change-user.

## M4 Large objects and bulk

- Locators: read, create, append, free and hold, and Node.js streams over
  them.
- Copy in, and copying the rows an iterable gives.
- CSV and tab-separated import.
- CSV and native export, and reading the native form back.

## M5 Settings

- The `turborel://` URI, options and the TURBOREL_ variables.
- The service file and the password file.
- Several hosts, `load_balance` and `target` roles.
- TLS modes and `channel_binding`.

## M6 Throughput

- Pipelines, with the 64 KiB window and skipping on error by savepoints.
- Pools, with PoolConfig's defaults, the Ping check and the Reset return.
- The SQL-agent: CONNECT, SET CONNECTION and DISCONNECT.

## M7 Standard API

- The Promise-based API of RULES.md D2 over the layers above.
- The manual, `doc/`, filled: every chapter its contents page names, its
  examples run.

## M8 Parity audit

- Every row of CONFORMANCE.md checked against turborel-client and the
  spec, and marked done.
- Every frame of the sample file turborel's repository is to keep beside
  the protocol's spec, decoded at a pinned commit, once that file exists.
- The coverage floor held, and this file empty.
