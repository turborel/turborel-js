# turborel-js rules

How turborel-js is designed, written and verified. Every change follows
these rules; `npm run verify` checks those a tool can check, and
review checks the rest.

Rules (R-…) say how code and tests are written. **shall** is mandatory,
and a departure needs a decision recorded here (§7). **should** is
expected, and a reviewer may accept a reasoned exception.

Decisions (D1…) record how the driver is built and why. Change one only
by changing this file in a reviewed commit. A decision says what was
chosen and why, and the module it names holds the mechanism.

Cite both by ID in code, tests, reviews and commit messages, as in
`RULES.md D6` or `R-ERR-2`.

The rules are modelled on Turborel's own
[RULES.md](https://github.com/turborel/turborel/blob/main/RULES.md),
adapted to drivers. Every Turborel driver keeps the same requirement IDs
with the same meaning, and the same decisions D1 to D8, so a rule is
cited the same way in every repository; a driver's own decisions begin
at D9, and its own requirements are in families of their own. Where
JavaScript's library conventions and a rule here disagree, the rule is
kept, and D8 lists where.

Before changing code, read §3 (code rules), §4 (test rules) and the
decisions covering your area. What the driver implements is in
[CONFORMANCE.md](CONFORMANCE.md), and open work is in [TODO.md](TODO.md).

[1 Decisions](#1-decisions) · [2 Layout](#2-project-layout) ·
[3 Code](#3-code-rules) · [4 Tests](#4-test-rules) ·
[5 Coverage](#5-coverage) · [6 Process](#6-process-and-tools) ·
[7 The decisions](#7-the-decisions) · [8 References](#8-references)

---

## 1. Decisions

Each is told in full in [§7](#7-the-decisions).

| # | Decision |
|---|---|
| **Shared by every Turborel driver** | |
| D1 | The native protocol, version 1, in layers that follow turborel-client |
| D2 | The language's standard API, over a low-level client of turborel-client's features |
| D3 | The runtime minimum follows the ecosystem's own support |
| D4 | One command runs every check, before each commit and in CI on three platforms |
| D5 | The version is the Turborel release's: 0.0.0 in the alpha, speaking protocol 1 |
| D6 | Tests and code cite Turborel's documents by their headings |
| D7 | A coverage floor, enforced in CI, that only rises |
| D8 | Where these rules depart from JavaScript's conventions |
| **This driver's own** | |
| D9 | One ES module, with an exports map, which CommonJS loads by `require` |
| D10 | No runtime dependencies: Node.js's own modules |
| D11 | Exact numbers are BigInt, and a Decimal of the driver's own |
| D12 | One error type, `TurborelError` |
| D13 | TypeScript 6.0, strict, compiled to JavaScript and declarations |
| D14 | ESLint with typescript-eslint, and Prettier, rather than Biome |
| D15 | Tests on `node:test` against the compiled code; coverage by c8 |
| D16 | The development dependencies |
| D17 | Each value of the protocol is a JavaScript type that holds it exactly, or a class of the driver's own |
| D18 | A connection is a promise of replies over Node.js's own sockets, each wait bounded as turborel-client bounds it |
| D19 | Bulk data moves through Node.js's streams and iterables, a copy holding the connection until it ends |
| D20 | Settings are read as turborel-client reads them, from Node.js's own environment, home directory and resolver |
| D21 | A pool is shared by a program's tasks, its waits promises of their own; a pooled connection is released, or disposed of |
| D22 | The standard API is a `Client` of one operation at a time, over the low-level client, its examples run |

---

## 2. Project layout

| Path | What |
|---|---|
| `package.json` | the package: its name, version (D5), exports (D9), engines (D3), scripts (D4) and development dependencies (D16) |
| `package-lock.json` | their pinned versions |
| `tsconfig.json`, `tsconfig.build.json`, `tsconfig.test.json` | the type check, the package's build to `dist/`, the tests' build to `build/` (D13) |
| `eslint.config.js`, `.prettierrc.json` | the linters and the formatter (D14) |
| `.c8rc.json` | coverage and its floor (D7, D15) |
| `tools/` | the checks tool, `check.ts`, and the headings of Turborel's documents it holds citations to (D4, D6) |
| `src/index.ts` | the package's one entry: everything it exports |
| `src/error.ts` | `TurborelError`, the driver's error (D12) |
| `src/codec/` | the `codec` layer, with no I/O |
| `src/transport/`, `src/auth/`, `src/tls/`, `src/session/`, `src/statements/`, `src/lobs/`, `src/copy/`, `src/settings/`, `src/pipeline/`, `src/pool/`, `src/api/` | the other layers of D1, each made as its milestone comes |
| `test/` | the tests, one `*.test.ts` beside the path of what it tests; `test/support/`, the helpers they share; `test/tools/`, the checks tool's; `test/live/`, the live tests, and `test/server/`, their server's set-up (D18) |
| `doc/` | the manual |
| `dist/`, `build/`, `coverage/` | made by the build, the tests and coverage; ignored |

---

## 3. Code rules

The tools named by "the formatter", "the linters", "the type checker" and
"the checks tool" are D4's.

### R-STYLE: formatting and idiom

| ID | Rule | Checked by |
|---|---|---|
| R-STYLE-1 | Code **shall** be formatted by the formatter. | the formatter |
| R-STYLE-2 | Names **shall** follow the language's own conventions; code implementing a message, field or setting is named after it, as the spec names it. | the linters; review |
| R-STYLE-3 | Library code **shall not** print, or write to a stream it was not given. | the linters or the checks tool |
| R-STYLE-4 | What is not public **shall** be private, by the language's own means, so the public API is what is documented. | review |

### R-SIZE: short functions and files

| ID | Rule | Checked by |
|---|---|---|
| R-SIZE-1 | A function **shall** have at most 50 lines of code, blank lines and comments not counted. | the linters or the checks tool |
| R-SIZE-2 | A source file **shall** have at most 600 lines; split by the spec's sections or by layer. | the linters or the checks tool |
| R-SIZE-3 | A function **shall** take at most 5 parameters; else a structure or an options object. | the linters |
| R-SIZE-4 | A module **should** hold one concept, stated in its doc comment. | review |
| R-SIZE-5 | A function's complexity **shall** be at most 15, and its blocks nested at most 5 deep. | the linters |

### R-DOC: comments and documentation

| ID | Rule | Checked by |
|---|---|---|
| R-DOC-1 | Every public item **shall** have a doc comment in the language's documentation format, saying each parameter, what it returns, and each failure it gives. | the linters; review |
| R-DOC-2 | Comments **shall** say *why*: the section implemented, the choice made, the invariant relied on. | review |
| R-DOC-3 | The API reference, where the language's tools build one, **shall** build without warnings. | the checks tool |
| R-DOC-4 | Behaviour the protocol or turborel-client governs **shall** cite it by its heading, `[PROTOCOL Frames]`, `[CLIENT Pools]`; the driver's own choices cite their decision (D6). | review; the checks tool |
| R-DOC-5 | No commented-out code, and no `TODO`, `FIXME` or `XXX` comments: open work goes in TODO.md, and code never cites TODO.md. | the linters or the checks tool |
| R-DOC-6 | Every source file **shall** begin with a doc comment giving its responsibility and the sections it implements. | review |
| R-DOC-7 | A change a program can see **shall** update the manual, `doc/`, in the same commit; every claim is checked against the code, and every example is run. `npm run examples` runs them (D22). The manual keeps Turborel's layout, which turborel.com's documentation site reads: each page opens with its `# Title` and a line holding only `[Contents](README.md)`, each volume's README.md lists its pages, links within `doc/` and to other files of this repository are relative links that resolve (the site points the latter at GitHub, at the same tag), a link to Turborel's own manual is its GitHub address under `https://github.com/turborel/turborel/blob/main/doc/`, `user/01-installing.md` keeps its name, and `doc/` holds no images. | review; the checks tool; the examples tool |

### R-CONST: no magic numbers or strings

| ID | Rule | Checked by |
|---|---|---|
| R-CONST-1 | Numbers in library code other than `0` or `1` **shall** be named constants, documenting the value's source. | the linters; review |
| R-CONST-2 | Every protocol tag **shall** be a named constant, defined once: a message's kind, a data type's and a value's tag, a tail tag, a capability's name, a mechanism's name, a status name, and each SQLSTATE the driver raises. | review |
| R-CONST-3 | Strings matched or looked up, such as settings' names, URI parts and environment variables, **shall** be named constants. Messages for people are not. | review |
| R-CONST-4 | Related constants **shall** live together in their layer's module, under a comment naming the section they come from. | review |
| R-CONST-5 | Tests may use literal fixtures, as the spec prints its bytes; an expected value restating a constant **should** use it. | review |

### R-ERR: errors

| ID | Rule | Checked by |
|---|---|---|
| R-ERR-1 | Every failure the library gives **shall** be the driver's error (D2): no stray exception, panic, abort, assertion or other error of the language or its libraries reaches a program, and no library code ends the process. | the linters; tests; review |
| R-ERR-2 | Each failure **shall** carry its SQLCODE, SQLSTATE and message, and, once read from a server, the rest of it: the rule it cites, its position, whether a transaction is still active, and its diagnostics. A failure the driver raises itself carries the SQLCODE and SQLSTATE turborel-client gives the same failure. | tests |
| R-ERR-3 | No failure **shall** be silenced. One caught and given again as the driver's keeps its cause; a result left unread says why it cannot matter. | the linters; review |
| R-ERR-4 | A connection that fails **shall** be closed, and every request waiting on it given that failure; a failed call leaks nothing and leaves nothing waiting. | tests; review |

### R-NUM: integers and numbers

| ID | Rule | Checked by |
|---|---|---|
| R-NUM-1 | Every integer of the protocol **shall** be read and written at its width, little-endian, explicitly: never by the platform's byte order, by casting a buffer, or by bitwise operators on numbers wider than the language's operators keep exact. | review; tests |
| R-NUM-2 | A value out of range for its field, or for the type it is read into, **shall** be refused with the driver's error, never truncated, wrapped or rounded. | tests |
| R-NUM-3 | An exact number (units `i128`, scale `u32`) and a DECFLOAT **shall** never pass through a binary floating-point type. | review; tests |
| R-NUM-4 | An approximate number **shall** keep its bits: NaN and -0.0 are read and written as the double they are, and floats are compared bit for bit, never for equality. | tests; review |
| R-NUM-5 | In a language whose integers are bounded, arithmetic on sizes, counts and offsets **shall** be shown not to overflow before it is done. | the linters; review |

### R-LINT: warnings

| ID | Rule | Checked by |
|---|---|---|
| R-LINT-1 | A warning is an error: of the compiler, the linters and the type checker, and of the runtime itself while the tests run. | the checks tool |
| R-LINT-2 | The strictest standard linters and type checking the language has **shall** be on; a check left off says why in the configuration that leaves it off. | review |
| R-LINT-3 | A warning **shall** be silenced only on its line, naming its rule and saying why; a suppression no longer needed **shall** be removed. | the linters; review |

### R-DEP: dependencies

| ID | Rule | Checked by |
|---|---|---|
| R-DEP-1 | The library **shall** depend on nothing but the language's standard library and runtime, unless a decision here admits a dependency, with its reason, version, license and review. | review |
| R-DEP-2 | A dependency, of the library or of its tools, **shall** be production-grade by its makers' own claims: a stable release they support. | review |
| R-DEP-3 | Tools **shall** be pinned by version, with the ecosystem's lock file under version control where it has one; a change of a tool's version is a commit of its own. | review |

### R-SAFE: what a server sends, and secrets

| ID | Rule | Checked by |
|---|---|---|
| R-SAFE-1 | A length or count a server, or a file the driver reads, gives **shall** be checked against what follows and the limit taken before anything is held for it, so no reply takes the program's memory without bound. | tests; review |
| R-SAFE-2 | What a server sends **shall** never be run, loaded or deserialized as code. | the linters; review |
| R-SAFE-3 | TLS **shall** be used and verified as the settings ask, and a connection **shall not** fall back to less than its mode allows. | tests |
| R-SAFE-4 | A secret (a password, anything derived from one, a SCRAM key or proof, a cancel key) **shall** never be logged, put in a failure's message or an object's display form, or sent where it was refused; where the language allows, it is cleared from memory once used. | tests; review |
| R-SAFE-5 | No module-level mutable state: what lasts belongs to an object a program made, such as a connection, a pool or a key cache. | review |
| R-SAFE-6 | The library **shall** start no thread, timer or task but for an object a program made, and a closed connection, cursor or pool leaves none behind. | tests; review |

### R-PLAT: platforms

| ID | Rule | Checked by |
|---|---|---|
| R-PLAT-1 | The driver **shall** run on Linux, macOS and Windows, on every runtime D3 supports; CI checks each (D4). | CI |
| R-PLAT-2 | Code of one platform, such as a Unix socket or a named pipe, **shall** be chosen by the platform, and elsewhere refused with the driver's error, saying so; never silently something else. | tests; review |
| R-PLAT-3 | Paths **shall** be made by the language's path functions, and files kept with LF line endings (`.gitattributes`). | review |
| R-PLAT-4 | Code built for one platform only **shall** say, when handed back, that it was not run on the others. | review |

### R-TYPE: TypeScript

| ID | Rule | Checked by |
|---|---|---|
| R-TYPE-1 | No `any`, no non-null assertion `!`, and no `==`. | the linters |
| R-TYPE-2 | Exports **shall** be named, never default; a relative import names its file with `.js`; an import of types alone is `import type`. | the linters; the type checker |
| R-TYPE-3 | No `enum` or `namespace`; a set of constants is `const`s, or an object `as const`. | the type checker (`erasableSyntaxOnly`) |
| R-TYPE-4 | An integer the protocol writes as `u64`, `i64` or `i128` **shall** be a `bigint`, both ways; a `bigint` becomes a `number` only once shown to be a safe integer. | review; tests |

### R-ASYNC: promises and events

| ID | Rule | Checked by |
|---|---|---|
| R-ASYNC-1 | No promise **shall** float: each is awaited, returned, or handed to what handles its rejection. | the linters |
| R-ASYNC-2 | Every `'error'` event of a socket or stream **shall** be listened to, so nothing goes unhandled. | review; tests |
| R-ASYNC-3 | No module **shall** await at its top level, as `require` could not load the package (D9). | the linters |

---

## 4. Test rules

### R-TEST: levels and layout

| ID | Rule | Checked by |
|---|---|---|
| R-TEST-1 | A test **shall** sit at the lowest level that shows its requirement: a codec test of bytes, a test of a layer over a stream the test controls, a test of the API, or a live test against a server. | review |
| R-TEST-2 | Tests **shall** derive from the spec and turborel-client, not from the code: normal cases, boundaries included, and robustness cases with the exact SQLCODE and SQLSTATE expected. | review |
| R-TEST-3 | A test's name **shall** say the behaviour checked. | review |
| R-TEST-4 | Test code may assert, print and use literal fixtures; every other rule applies. | the linters' configuration |
| R-TEST-5 | Tests **shall** be deterministic and independent: no clock, randomness, network beyond loopback, or order between them. A case generator uses a fixed seed. A live test runs against a server on loopback that its own set-up starts, on its own port and data directory. | review |
| R-TEST-6 | Every fixed defect **shall** get a regression test that fails without the fix, its doc comment saying so. | review |
| R-TEST-7 | A fixture or helper shared by tests **shall** be written once, in one place. Tests use the one framework D9 or later names, no other. | review |
| R-TEST-8 | Live tests **shall** run against `ghcr.io/turborel/turborel:nightly` in CI, set up by the repository's own server set-up, with test certificates, SCRAM users and SERVER.TRUST_LOCAL. | CI |
| R-TEST-9 | SCRAM **shall** be tested by RFC 7677's test vector, and settings by the URI, service file, password file and environment cases of turborel-client's settings tests, so every driver reads settings as turborel-client does. | review |

### R-TRACE: traceability

| ID | Rule | Checked by |
|---|---|---|
| R-TRACE-1 | Every test **shall** cite what it verifies, by its doc comment, beginning `Verifies:`, beginning with a tag of D6: `[PROTOCOL <heading>]`, `[CLIENT <heading>]`, `[DESIGN] D<n>` or `[TOOL] R-<id>`. | the checks tool |
| R-TRACE-2 | A citation **shall** name a heading, decision or rule that exists. | the checks tool |
| R-TRACE-3 | Code implementing a requirement **shall** cite it (R-DOC-4). | review |
| R-TRACE-4 | CONFORMANCE.md **shall** change with the change that implements or changes a row. A row is marked done only where the driver's code for it exists and tests citing its section pass, or, of a driver built over another, as CONFORMANCE.md says. | review |

---

## 5. Coverage

| ID | Rule | Checked by |
|---|---|---|
| R-COV-1 | Coverage **shall** be measured by `npm run coverage`, over the library and every test. | the checks tool |
| R-COV-2 | Coverage **shall not** fall below the floor (D7); a change raising it **should** raise the floor. | the checks tool, in CI |
| R-COV-3 | A gap is closed by a test derived from a requirement, or by removing dead code; never by a test of no requirement, and never by excluding the code. | review |

---

## 6. Process and tools

| ID | Rule | Checked by |
|---|---|---|
| R-PROC-1 | `npm run verify` **shall** pass before every commit; CI adds every platform, every supported runtime and the coverage floor (D4). | pre-commit hook; CI |
| R-PROC-2 | Every change **shall** be reviewed against the checklist below. | review |
| R-PROC-3 | Commits **should** be small and single-purpose, in CONTRIBUTING.md's form (`area: summary`, then why), citing the rules applied or changed. | review |
| R-PROC-4 | A threshold change **shall** change RULES.md and the configuration that holds it together. | review |
| R-PROC-5 | Project automation **shall** be written in the language's own tooling, never shell scripts; the git hook only hands over to the checks tool. | review |
| R-PROC-6 | CI's actions **shall** be pinned by their full commit SHA, with the version in a comment. | review |
| R-PROC-7 | A release **shall** be published only as VERSIONING.md says, by the owner (D5). | review |

The review checklist:

- the spec or turborel-client cited in code (R-DOC-4) and tests
  (R-TRACE-1);
- normal and robustness tests (R-TEST-2), and a failing-first test for a
  fix (R-TEST-6);
- every failure the driver's, carrying its condition (R-ERR);
- no magic numbers or strings, protocol tags named (R-CONST);
- every length a server sends bounded, no secret disclosed (R-SAFE);
- comments explain why (R-DOC-2);
- CONFORMANCE.md (R-TRACE-4), the manual (R-DOC-7) and TODO.md updated
  where they change.

---

## 7. The decisions

### Shared by every Turborel driver

#### D1. The native protocol, version 1, in layers that follow turborel-client

The driver speaks Turborel's native protocol, version 1, as
`doc/client/05-protocol.md` in Turborel's repository lays it out,
itself, in TypeScript compiled to JavaScript, with no native code and no runtime dependency beyond Node.js's own modules. Where that page and turborel-protocol's code differ,
the code is right, and the driver follows it; CONFORMANCE.md names each
such place.

The reference is turborel-client. The driver does all it does before it
is called done, row by row in CONFORMANCE.md, and is built in the same
layers as turborel-client's modules, so a reviewer checks one against
the other. Each layer is a commit area of CONTRIBUTING.md.

| Layer | What it covers | turborel-client |
|---|---|---|
| `codec` | the 5-byte frame header; fields; the tail and its tag order; the data types and values; JSON values; zlib `z` frames within the length bound; the 16 MiB body limit | `protocol/src` |
| `transport` | TCP on 7422; Unix sockets; the Windows named pipe `\\.\pipe\turborel`; TLS begun on the same port; the connect and read timeouts | `target.rs`, `timeouts.rs`, `pipe.rs` |
| `auth`, `tls` | trust, password, certificate, SCRAM-SHA-256 and -PLUS; secrets refused over plain TCP; the SCRAM key cache; TLS | `mechanism.rs`, `scram.rs`, `tls.rs` |
| `session` | Hello, Ready, Status, notices, conditions, diagnostics, autocommit, cancel, terminate, ping, reset, change-user, query attributes, multi-statement | `connection.rs`, `session.rs`, `cancel.rs`, `told.rs` |
| `statements` | queries and streamed queries; prepare, execute, fetch, close, deallocate; numbered cursors; describe; completions | `statements.rs`, `frames.rs` |
| `lobs`, `copy` | locators, their reads, writes and streams; copy, import and export | `lobs.rs`; `copy.rs`, `import/`, `export.rs` |
| `settings` | the URI, options, variables, service and password files, several hosts, roles, TLS modes, channel binding | `settings/`, `failover.rs`, `role.rs` |
| `pipeline`, `pool` | pipelines; pools; the SQL-agent | `pipeline.rs`; `pool/`, `agent.rs` |
| `api` | the standard API (D2) | the language's own |

In turborel-js each layer is a directory of `src/`, named as its
commit area: `src/codec/` and on (§2). Node.js gives what the layers
need (D10): `node:net` for TCP, Unix sockets and Windows named pipes;
`node:tls` for TLS, with `exportKeyingMaterial` for SCRAM's
`tls-exporter` binding and the peer's certificate for
`tls-server-end-point`; `node:crypto` for SCRAM-SHA-256; and `node:zlib`
for compressed frames.

#### D2. The language's standard API, over a low-level client of turborel-client's features

The driver's standard interface is a Promise-based API for Node.js, with TypeScript types, loaded as an ES module or by `require`, so a program, and the
tools built for JavaScript's database interface, use it as they use
any other driver. It sits over a low-level client that has every feature
of turborel-client. What the standard interface has no place for, such
as pipelines, pools, copy, large objects by locator, notices and the
session's status, is reached through the low-level client or the
driver's own extensions of the standard interface.

Every failure is the driver's error, carrying its SQLCODE and SQLSTATE
(R-ERR). The standard interface is built at milestone M7 and checked in
M8's audit; until then its names may change.

Node.js has no standard database interface of its own, so the driver
gives what its programs expect of one. Every operation that waits on
the server is an `async` call: `connect(settings)` gives a connection,
of a `turborel://` URI or options; a connection's `query(sql, params)`
runs a statement and `prepare(sql)` makes a prepared statement; a
cursor is an async iterator of rows, read by `for await`; a pool hands
out connections and takes them back. A connection, a cursor and a pool
close by `close()`, and by `Symbol.asyncDispose`, so `await using`
closes them where the runtime has it.

The driver's error is `TurborelError` (D12). An exact number is a
`bigint`, or a `Decimal` of the driver's own (D11). A browser cannot
open a TCP connection, which the protocol needs, so the driver does not
run in one, and no bridge for one is planned; Electron and other
programs on Node.js are served.

#### D3. The runtime minimum follows the ecosystem's own support

The driver supports Node.js 22.12 or later. The rule is the ecosystem's own:
support every release its makers still support, and drop each at its
end of life. Where a major framework of the language sets a higher
floor, the driver matches it. The minimum changes in a commit of its
own, which changes this decision, the package's metadata, CI and
README.md together.

In November 2026 that is Node.js 22, 24 and 26, of which 22 ends in
April 2027; CI tests those three, and an odd-numbered release, never a
long-term one, is not tested. The floor within 22 is 22.12, the first
release that loads an ES module by `require` without a flag (D9).
`package.json` says so in `engines`, and the types the code is checked
against are Node.js 22's (D13), so an API only a later release has
fails the type check.

#### D4. One command runs every check, before each commit and in CI on three platforms

`npm run verify` runs every check a change must pass, stopping at the
first failure: the formatter, the linters, the type checker where the
language has one, the checks tool's own rules (lengths a linter does not
measure, citations and their targets, open-work markers, the manual's
titles, `[Contents](README.md)` lines and links), and every test.
`npm run coverage` measures coverage and holds it to its floor (D7).

`.githooks/pre-commit` hands over to the same command. It is a script
only because git runs hooks as scripts. CI runs it on Linux, macOS and
Windows, over every runtime D3 supports, with the live tests against the
nightly image and coverage on Linux. Every action is pinned by its full
commit SHA, its version in a comment, and Dependabot proposes each bump.

The command is an npm script, made only of Node.js and the tools, so it
runs alike on every platform: `format:check` (Prettier, D14), `lint`
(ESLint, D14), `typecheck` (`tsc`, D13), `build`, then `test`, which
compiles the tests and the checks tool to `build/`, runs the checks
tool, `tools/check.ts`, and runs every test on `node:test` (D15).
`npm run install-hooks` points git at `.githooks/` once per clone.
`release.yml` runs only by hand (D5), and the live tests against the
nightly image come with milestone M2.

#### D5. The version is the Turborel release's: 0.0.0 in the alpha, speaking protocol 1

The driver has no version scheme of its own. Its version is the number
of the Turborel release it is made for, the same as the server's: a
Turborel release and each driver's release for it share the number,
**MAJOR.MINOR.PATCH**, as Turborel's VERSIONING.md numbers it. The alpha
is 0.0.0, as Turborel's is, and speaks protocol version 1.

The number is written once, in `package.json`'s `version`. Nothing is
published, and no release is tagged, until every Turborel driver is
done; then the owner publishes them together (VERSIONING.md).

#### D6. Tests and code cite Turborel's documents by their headings

A test cites what it verifies, and code what it implements, by the
heading of the section that says it, as printed:

- `[PROTOCOL <heading>]`, a heading of The Native Protocol,
  `doc/client/05-protocol.md`, as `[PROTOCOL Frames]`;
- `[CLIENT <heading>]`, a heading of The Client Library,
  `doc/client/02-library.md`, or of Settings, Pipelines and Pools,
  `doc/client/02-library-connections.md`, which share no heading, as
  `[CLIENT Pipelines]`;
- `[DESIGN] D<n>`, a decision of this file;
- `[TOOL] R-<id>`, a rule the checks tool holds, for the tool's own
  tests.

What else a test relies on follows the tag, as an RFC by its section:
`[PROTOCOL Mechanisms] [RFC 7677 §3]`. The heading `Lob 'L'` is printed
twice in The Native Protocol, under Requests and under Replies, so a
citation of it says which it means.

The checks tool keeps the headings of those three documents, copied at
the Turborel commit CONFORMANCE.md names, and refuses a citation of a
heading, decision or rule that is not there (R-TRACE-2). In JavaScript,
a test cites by its doc comment, beginning `Verifies:`.

#### D7. A coverage floor, enforced in CI, that only rises

`npm run coverage` measures the library's coverage over every test,
and CI fails below the floor. In every Turborel driver the floor is at
least 90 % of lines, and of branches where the tool measures them. It
only rises: a change that raises coverage well above it raises it. A
floor below 100 % says why.

The floor is 95 % of lines, statements and functions, and 90 % of
branches, kept in `.c8rc.json` and measured over every file of `src/`.
It is below 100 % because the transport's code of one platform, a Unix
socket or a named pipe, is measured on Linux alone, where CI measures
coverage.

#### D8. Where these rules depart from JavaScript's conventions

The driver follows its language's library conventions for layout,
naming, packaging, documentation and testing. Where one conflicts with a
rule here, the rule is kept:

- Libraries commonly leave the length of functions and files to taste.
  These are bounded (R-SIZE).
- Libraries commonly fail an argument out of range with the language's
  own error. Here every failure is the driver's, an argument's too, with
  the SQLCODE and SQLSTATE turborel-client gives it (R-ERR-1), so a
  program handles one kind of failure.

- Libraries commonly read a 64-bit integer as a `number` where they
  expect it small. The driver reads every one as a `bigint` (R-TYPE-4).
- Node.js's own APIs throw a `TypeError` or `RangeError` for an argument
  of the wrong type or range; the driver throws a `TurborelError`, of
  SQLCODE -910 and SQLSTATE TB910 where turborel-client has no such
  failure, as turborel's API misused (D12).

Where turborel-client's code contradicts what The Native Protocol or
The Client Library says outright, the driver follows the documents, and
each such place is listed here, so the reference can be fixed. Where
turborel-client is inconsistent with itself, every Turborel driver
follows one rule, the same in all nine, listed here too:

- A reply value that cannot be decoded loses the connection, with
  SQLCODE -919 and SQLSTATE 08006, as a malformed message does: a
  character string's or a large object's units or kind byte other than
  0 or 1, a truth byte other than 0 or 1, a damaged JSON document, one
  nested past 128 or longer than 256 MiB, a malformed condition of
  Complete's tag 17. turborel-client gives TB916 or 0A000 on some of
  these paths and keeps the connection, the rest of the reply unread.
- Value tags 18 and 19, the server's stored form of a large object,
  never sent on the wire, are refused as malformed (-919, 08006), though
  turborel-protocol's reader takes them.
- Attributes past their bounds, more than 32 or a name or value too
  long, are refused before they are sent (-919, 08006), and the
  connection goes on. turborel-client sends them, and the server then
  fails the connection.
- Value tags 5, 7, 10 and 12, the tags of CHARACTER VARYING, BINARY
  VARYING and the zoned time and timestamp types, are read as value
  tags 1, 6, 9 and 11, as turborel-protocol's reader takes them; the
  driver writes only the latter.

### This driver's own

#### D9. One ES module, with an exports map, which CommonJS loads by `require`

The package is ES modules only, `"type": "module"`, with no CommonJS
build. Every supported release (D3) loads an ES module by `require`, so a
CommonJS program uses the driver as an ES module program does, and the
release workflow loads the packed package both ways.

A package built twice, as CommonJS and as an ES module, is loaded twice by
a program whose parts load it both ways. It then holds two
`TurborelError` classes, so `instanceof` fails across them, and two SCRAM
key caches and two sets of pools. A driver needs one of each, so it ships
one module.

`exports` gives `.`, with its types first, and `./package.json`, and
nothing else, so the internal modules are no part of the API and a
program cannot reach them. `require` cannot load a module that awaits at
its top level, so no module does: ESLint refuses it (R-ASYNC-3).

#### D10. No runtime dependencies: Node.js's own modules

The package depends on nothing at run time. Node.js has all it needs:
`node:net`, `node:tls`, `node:crypto`, `node:zlib`, and `node:fs`,
`node:os` and `node:path` for the service and password files (D1). The
driver uses only APIs Node.js marks stable. A runtime dependency would
need a decision here, and a reason the platform cannot serve (R-DEP-1).

#### D11. Exact numbers are BigInt, and a Decimal of the driver's own

The protocol carries an exact number as units, an `i128`, and a scale, a
`u32`, and a DECFLOAT as a coefficient and an exponent
(`[PROTOCOL Values]`). JavaScript's `number` holds integers exactly only
to 2^53, so neither is ever read as one (R-NUM-3). An exact number of
scale 0 is a `bigint`; one of another scale a `Decimal`, a small
immutable type of the driver's own of its units, a `bigint`, and its
scale (`src/codec/decimal.ts`); a DECFLOAT a `DecFloat`, in turborel's
one form (`src/codec/decfloat.ts`). Each reads and writes its text
exactly and turns into a `number` only when asked. A library of decimal
arithmetic would be a dependency (D10), and a driver needs to carry exact
numbers, not to compute with them.

A `bigint` or a `Decimal` parameter is sent as an exact number and a
`number` as an approximate one, so no value changes kind silently.

#### D12. One error type, `TurborelError`

Every failure, of a statement or of the connection, the server's or the
driver's own, is a `TurborelError` (`src/error.ts`), a subclass of
`Error`. It carries the failure as turborel-client's `Failure` does: its
SQLCODE, SQLSTATE, message, the rule it cites, its position, whether the
session's transaction is active after it, and its diagnostics. An error
of Node.js's beneath it, such as a socket's, is its `cause`. A failure
the driver raises itself has turborel's codes: -919 and 08006 for a
connection whose messages cannot be read, -301 and class 22 for a value
the protocol cannot carry, -900 and 0A000 for one past turborel's
limits, and -910 and TB910 for the API misused.

#### D13. TypeScript 6.0, strict, compiled to JavaScript and declarations

The code is TypeScript, checked with `strict`,
`exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`,
`noPropertyAccessFromIndexSignature`, `noImplicitOverride`,
`noImplicitReturns` and the checks of unused code on (`tsconfig.json`).
`verbatimModuleSyntax` and `erasableSyntaxOnly` keep it to syntax whose
types erase. `tsc` compiles `src/` to `dist/` as ES2024 JavaScript with
its `.d.ts` declarations beside it (`tsconfig.build.json`), which is
what the package ships.

TypeScript is held at 6.0. Its latest release, 7, is not yet one
typescript-eslint takes, and the type-aware lint (D14) is worth more than
a faster compiler; the driver moves once typescript-eslint takes it.
`@types/node` is held at Node.js 22's (D3).

#### D14. ESLint with typescript-eslint, and Prettier, rather than Biome

ESLint lints with its recommended rules and typescript-eslint's
`strict-type-checked` and `stylistic-type-checked`, which ask the
TypeScript compiler for types. `eslint.config.js` adds the rules that
hold §3 where a tool can: the sizes, magic numbers, doc comments
(eslint-plugin-jsdoc) and their TSDoc syntax (eslint-plugin-tsdoc), TODO
comments, top-level await and `process.exit`. `npm run lint` fails on
any warning (R-LINT-1).

Prettier formats the code and its configuration, 120 columns wide, with
single quotes. The documents and the files in `.github/` are written by
hand, in the form Turborel's repository keeps them, so Prettier leaves
them.

Biome would do both with one tool, but it infers types itself rather
than asking the TypeScript compiler, and its rules that need types are
fewer than `strict-type-checked`'s.

#### D15. Tests on `node:test` against the compiled code; coverage by c8

The tests are in `test/`, a file `*.test.ts` beside the path of what it
tests, on Node.js's own runner, `node:test`, with `node:assert/strict`,
so no test framework is a dependency (R-TEST-7). `tsc` compiles them,
and the library and the checks tool with them, to `build/`
(`tsconfig.test.json`), and `node --test` runs the JavaScript, so the
tests run the code as it is compiled. Running TypeScript directly is not
stable on every release supported (D3).

c8 measures coverage from V8's own counts, mapped back to the TypeScript
by source maps, over every file of `src/`, and fails below the floor in
`.c8rc.json` (D7).

#### D16. The development dependencies

The package has no runtime dependency (D10). These are what its checks
run on, each pinned by the lock file, each a stable major release by its
own account, and each under a license that lets it be used so.

| Package | Version | License | For |
|---|---|---|---|
| `typescript` | 6.0 | Apache-2.0 | the compiler and the type checker (D13) |
| `@types/node` | 22 | MIT | Node.js's types, of the oldest release supported (D3) |
| `eslint`, `@eslint/js` | 10 | MIT | the linters (D14) |
| `typescript-eslint` | 8 | MIT | the type-aware lint rules (D14) |
| `eslint-plugin-jsdoc` | 65 | BSD-3-Clause | every public item documented (R-DOC-1) |
| `eslint-plugin-tsdoc` | 0.5 | MIT | doc comments in TSDoc's syntax (R-DOC-1) |
| `prettier` | 3 | MIT | the formatter (D14) |
| `c8` | 12 | ISC | coverage (D15) |

`eslint-plugin-tsdoc` is at 0.5, below 1.0, as it has always been. It is
TSDoc's own linter, made by the project that defines the syntax, and runs
only in the lint.

#### D17. Each value of the protocol is a JavaScript type that holds it exactly, or a class of the driver's own

The codec (`src/codec/value-codec.ts`) gives each of the protocol's
values (`[PROTOCOL Values]`) as the JavaScript type that holds it with no
loss, and as a small immutable class of the driver's own where none does
(`src/codec/values.ts`), and takes each back as the same value, so a
value read and sent again is written byte for byte as it came:

| Tag | Value | JavaScript |
|---|---|---|
| 0 | null | `null` |
| 1 | character string | `string` |
| 2 | exact number | `bigint` of scale 0, else `Decimal` (D11) |
| 3 | approximate number | `number`, its bits kept |
| 4 | a plug-in's value | `PluginValue`, its type's name, text and bytes, sent back unchanged |
| 6 | binary string | `Uint8Array` |
| 8, 9, 11 | date, time, timestamp | `Datetime`, its moment, zone flag, precision, displacement and instant in microseconds, a `bigint` |
| 13 | interval | `Interval`, its qualifier and units, a `bigint` |
| 14 | truth value | `boolean` |
| 15 | decimal floating point | `DecFloat` (D11) |
| 16, 17, 22 | array, row, multiset | an array, `SqlRow`, `Multiset` |
| 20, 21 | large object, whole or by locator | `Lob`, of text or octets, and `LobLocator` |
| 23 | structured value | `Structured`, its type's name and attributes |
| 24 | reference | `Reference`, its octets |
| 25 | JSON | `Json`, its tree checked whole, its item read as `JsonItem` |
| 26 | XML | `Xml`, its serialization |
| 27 | UUID | `Uuid`, its 16 octets and its text |

A JavaScript `Date` is not taken for a datetime: it holds milliseconds in
local time, not a precision and a displacement, and the standard API
(D2) gives that mapping in milestone M7. A value of a type the protocol
carries none of, `undefined` among them, is refused with SQLCODE -910
and SQLSTATE TB910 (D12).

A JSON value's item is the SQL/JSON item turborel stores: an exact number
a `bigint` or a `Decimal`, an approximate one a `number`, a DECFLOAT a
`DecFloat`, a datetime a `Datetime`, and an object a `JsonObject`, its
members in the order written, a key perhaps more than once. One is made
of those, or of plain objects and arrays of them; a `number` is written
as an approximate number, as D11 sends one.

#### D18. A connection is a promise of replies over Node.js's own sockets, each wait bounded as turborel-client bounds it

A connection (`src/session/connection.ts`) reads its socket's frames as
they arrive (`src/transport/frames.ts`), each `receive` a promise of the
next reply, and holds a frame's body only as its bytes arrive and only
up to the longest taken; past a megabyte buffered and unread, the socket
is paused, so a server faster than the program holds no more. Every
wait is bounded as turborel-client's `timeouts.rs` bounds it: the
connect timeout for connecting, TLS and each step of the login, then
the read timeout, none by default, for each read and write. A Windows
named pipe's reads and writes are not bounded once it is open, as
turborel-client's are not, the standard library setting no limit on a
pipe.

TLS is Node.js's own (`node:tls`). The platform's authorities are those
of the files SSL_CERT_FILE and SSL_CERT_DIR name, if either is set, as
turborel-client's rustls-native-certs reads them, else the system's
store, read by `tls.getCACertificates('system')`, or, where that reads
none, the authorities Node.js bundles.

The live tests run against a turboreld their set-up starts on port
17432 (`test/server/server.ts`), with certificates made for the run by
`openssl`, SCRAM users made by `turboreld user add`, and
SERVER.TRUST_LOCAL ON; in CI, on Linux, the nightly image run with the
host's network, so the same set-up serves both.

#### D19. Bulk data moves through Node.js's streams and iterables, a copy holding the connection until it ends

A large object's reader is a Node.js `Readable`, read a chunk a request;
a writer is an object whose `write` is awaited, as an export's `out` is,
so a program writes to a file stream or a buffer alike. A copy takes a
row at a time, or the rows an iterable or async iterable gives; an
import's `Delimited` reads chunks of octets from a stream or an array of
them. A copy is disposable (`await using`), abandoned if it has not
ended, as turborel-client's `Copying` is when dropped.

turborel-client's types keep a program from sending another request
while a copy is under way, its `Copying` borrowing the connection.
JavaScript has no such check, so the connection refuses one, but for
the copy's rows, its end and a ping, with SQLCODE -910 and SQLSTATE
TB910, before anything is sent.

An import's failure and a source's are `TurborelError`s (D12):
`ImportError` carries its SQL condition's codes, or -301 and 22000 for
an input that cannot be read or does not fit, as `SourceError` does.

A value's text, which an export writes and `textOf` gives, is turborel's
`Display` of the value, and `literalOf` its `to_literal`, so a CSV file
of a query reads the same from every driver and from turboreld's own
client.

#### D20. Settings are read as turborel-client reads them, from Node.js's own environment, home directory and resolver

Connection settings, the URI, the service file and the password file
are read by the rules of turborel-client's `settings/`, its tests'
cases among this driver's (R-TEST-9). What the platform gives, Node.js
gives: the environment is `process.env`, or a function the program
gives; the home directory, of the default service and password files,
is `os.homedir()`; a host's addresses are those `dns.lookup` gives, all
of them, in the resolver's order. A password file is read only if
`fs.statSync` finds a regular file, a link followed to one; like
turborel-client, the driver checks no owner or permissions. The SCRAM
key cache is the settings object's own, so every connection one
settings object makes shares it.

#### D21. A pool is shared by a program's tasks, its waits promises of their own; a pooled connection is released, or disposed of

turborel-client's pool is shared by threads, a mutex and a condition
variable keeping it, each wait the waiting thread's. A JavaScript
program's work is tasks of one event loop, so the pool is shared by
them, and needs no lock: a task that finds no connection waits on a
promise of its own, woken in turn as one comes back or a place frees,
and timed by a timer of its own, so the pool runs nothing of its own
between calls. A Rust `Pooled` goes back to its pool as it is dropped;
JavaScript has no such end, so a `Pooled` goes back as it is released,
by `release()` or as `await using` disposes of it. A pool's `close()`
closes its idle connections, as dropping the last of a Rust pool does,
so a program's event loop can end. Times are milliseconds, as Node.js
gives them.

A pipeline's windows are written by one write of the connection's
socket, its requests' frames joined, as turborel-client writes a
window by one `write_all`.

#### D22. The standard API is a `Client` of one operation at a time, over the low-level client, its examples run

`connect` gives a `Client` (`src/api/`), the standard API's connection,
named apart from the low-level client's `Connection`, which its
`connection` gives. A low-level connection takes one request and its
replies at a time, as turborel-client's borrows its stream; a `Client`
is shared by a program's tasks, so it runs their operations one at a
time, in the order asked, each operation's requests and replies whole.

`query` with parameters prepares its statement, executes it and
destroys it, so a program's statements of values are never spliced into
SQL text. A cursor fetches 100 rows at a time unless told. `transaction`
refuses to begin while a transaction is active (SQLSTATE 25000), as no
transaction nests in another. An `AbortSignal` cancels its statement
through a `Canceller`, the statement failing with the server's TB920; a
signal aborted before the statement is sent fails it with the same
codes, and nothing is sent. A pool's `Client` gives its connection back
as it closes.

Every JavaScript example of the manual is run by `npm run examples`
(`tools/examples.ts`), each page's against a fresh live server, and
what it prints compared with the output its last comment lines give;
CI runs it on Linux against the nightly image. So a page's examples are
written as a reader runs them, one after another, from an empty schema.

---

## 8. References

- Turborel, `doc/client/05-protocol.md`, *The Native Protocol*,
  version 1: the requirements of the codec and every message.
- Turborel, `doc/client/02-library.md`, *The Client Library*, and
  `doc/client/02-library-connections.md`, *Settings, Pipelines and
  Pools*, and the crates turborel-client and turborel-protocol: the
  features to match, and the reference where the spec is silent or
  differs.
- Turborel, `RULES.md` D89, the JSON value's binary tree, and D184, the
  UUID's tag.
- RFC 1950, *ZLIB Compressed Data Format Specification*; RFC 5802 and
  RFC 7677, SCRAM and SCRAM-SHA-256; RFC 5929 and RFC 9266, the
  `tls-server-end-point` and `tls-exporter` channel bindings.
- The standards of JavaScript and of its database interface, named in
  D2 and D3.
