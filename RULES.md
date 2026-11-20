# turborel-js rules

How turborel-js is designed, written and verified. Every change follows
these rules; `npm run verify` checks those a tool can check, and review
checks the rest.

Rules (R-…) say how code and tests are written. **shall** is mandatory,
and a departure needs a decision recorded here. **should** is expected,
and a reviewer may accept a reasoned exception.

Decisions (D1…) record how the driver is built and why. Change one only
by changing this file in a reviewed commit. A decision says what was
chosen and why, and the module it names holds the mechanism.

Cite both by ID in code, tests, reviews and commit messages, as in
`RULES.md D4` or `R-ERR-2`.

Before changing code, read §3 (code rules), §4 (test rules) and the
decisions covering your area. What the driver implements is in
[CONFORMANCE.md](CONFORMANCE.md), and open work is in [TODO.md](TODO.md).

[1 Decisions](#1-decisions) · [2 Layout](#2-project-layout) ·
[3 Code](#3-code-rules) · [4 Tests](#4-test-rules) ·
[5 Coverage](#5-coverage) · [6 Platforms](#6-platforms) ·
[7 Process](#7-process-and-tools) ·
[8 Node.js convention](#8-where-these-rules-depart-from-nodejs-convention) ·
[9 References](#9-references)

---

## 1. Decisions

| # | Decision |
|---|---|
| **The driver** | |
| D1 | Protocol version 1, spoken natively in TypeScript, with no native core |
| D2 | The standard API is a Promise-based Node.js API; browsers are not served |
| D3 | Node.js 22.12 or later, each release until its end of life |
| D4 | One ES module, with an exports map, which CommonJS loads by `require` |
| D5 | No runtime dependencies: Node.js's own modules |
| D6 | Exact numbers are BigInt, and a Decimal of the driver's own |
| D7 | One error type, `TurborelError` |
| D8 | The version is the turborel release's; the owner publishes, once every driver is done |
| **Tooling and process** | |
| D9 | TypeScript 6.0, strict, compiled to JavaScript and declarations |
| D10 | ESLint with typescript-eslint, and Prettier, rather than Biome |
| D11 | Tests on `node:test` against the compiled code; coverage by c8 |
| D12 | The checks are npm scripts, run by a pre-commit hook |
| D13 | CI on Linux, macOS and Windows, on every supported Node.js |
| D14 | The development dependencies |

### The driver

#### D1. Protocol version 1, spoken natively in TypeScript, with no native core

The driver speaks turborel's native protocol, version 1
(`doc/client/05-protocol.md` in turborel), itself, in TypeScript compiled
to JavaScript. It has no native addon and wraps no other driver, neither
turborel-c nor turborel-client by WebAssembly, so it installs from npm
with no build step, on every platform Node.js runs on, and a reviewer
reads every line of it in one language.

Its layers are turborel-client's, so one is checked against the other:
the codec (`src/codec/`, turborel-protocol), the transport, authentication
and TLS, the session, statements, large objects, copy, settings,
pipelines and pools, and over them the standard API (D2). Where the spec
and turborel-client's code differ, the code is right.

#### D2. The standard API is a Promise-based Node.js API; browsers are not served

Node.js has no standard database interface of its own, so the driver
gives what its programs expect of one: a Promise-based API, every
operation that waits on the server an `async` call.

- `connect(settings)` gives a connection, of a turborel URI or options,
  as turborel-client's `Settings` reads them.
- A connection's `query(sql, params)` runs a statement, and `prepare(sql)`
  a prepared statement that is executed many times.
- A cursor is an async iterator of rows, read by `for await`, a batch at a
  time.
- A pool hands out connections and takes them back.
- A connection, a cursor and a pool close by `close()`, and by
  `Symbol.asyncDispose`, so `await using` closes them where the runtime
  has it.

It is built in milestone M7, over the low-level client that milestones
M1 to M6 build to turborel-client's features, which stays public for a
program that needs what the standard API does not say, and is checked
with the rest in M8, the parity audit. Until then, the README's first
query shows the API as it is meant to be.

A browser cannot open a TCP connection, which the protocol needs, so the
driver does not run in one, and no bridge for one is planned. Electron
and other programs on Node.js are served.

#### D3. Node.js 22.12 or later, each release until its end of life

The driver supports each release of Node.js its project still supports,
and drops each at its end of life: in November 2026, 22, 24 and 26, of
which 22 ends in April 2027. CI tests those three (D13); an odd-numbered
release, never a long-term one, is not tested.

The floor within 22 is 22.12, the first release that loads an ES module by
`require` without a flag (D4). `package.json` says so in `engines`. The
types the code is checked against are those of Node.js 22 (D9), so an API
only a later release has fails the type check.

#### D4. One ES module, with an exports map, which CommonJS loads by `require`

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
its top level, so no module does: ESLint refuses it.

#### D5. No runtime dependencies: Node.js's own modules

The package depends on nothing at run time. Node.js has all it needs:

- `node:net` for TCP, Unix sockets and Windows named pipes;
- `node:tls` for TLS, with `exportKeyingMaterial` for SCRAM's
  `tls-exporter` binding and the peer's certificate for
  `tls-server-end-point`;
- `node:crypto` for SCRAM-SHA-256's PBKDF2, HMAC, SHA-256 and random
  nonces, and the key cache's secret;
- `node:zlib` for compressed frames, inflated within the longest body
  taken;
- `node:fs`, `node:os` and `node:path` for the service and password files.

The driver uses only APIs Node.js marks stable. A runtime dependency
would need a decision here, and a reason the platform cannot serve (R-DEP).

#### D6. Exact numbers are BigInt, and a Decimal of the driver's own

The protocol carries an exact number as units, an i128, and a scale, a u32
(`[PROTOCOL Values]`). JavaScript's `number` holds integers exactly only
to 2^53, so an exact number is never read as one. One of scale 0 is a
`bigint`. One of another scale is a `Decimal`, a small immutable type of
the driver's own of its units, a `bigint`, and its scale, which reads and
writes its text exactly and turns into a `number` only when asked. A
library of decimal arithmetic would be a dependency (D5), and a driver
needs to carry exact numbers, not to compute with them.

A `bigint` or a `Decimal` parameter is sent as an exact number and a
`number` as an approximate one, so no value changes kind silently. The
codec's mapping of every other value is decided with it, in milestone M1.

#### D7. One error type, `TurborelError`

Every failure, of a statement or of the connection, the server's or the
driver's own, is a `TurborelError` (`src/error.ts`), a subclass of `Error`.
It carries the failure as turborel-client's `Failure` does: its SQLCODE,
SQLSTATE, message, the rule it cites, and whether the session's
transaction is active after it, and, as the codec comes to read them, its
position and diagnostics. An error of Node.js's beneath it, such as a
socket's, is its `cause`. A program catches one type and reads the
standard's codes from it, whatever went wrong.

#### D8. The version is the turborel release's; the owner publishes, once every driver is done

The driver has no version scheme of its own. Its version is the number of
the turborel release it is made for, the server's number, so a program
pairs a driver and a server by one number. The alpha is 0.0.0, as
turborel's is, and speaks protocol version 1 (VERSIONING.md).

Nothing goes to npm until every turborel driver is done, and then the
owner publishes them together. The release workflow runs only by hand,
builds and checks the package, and has its publish step written but
disabled.

### Tooling and process

#### D9. TypeScript 6.0, strict, compiled to JavaScript and declarations

The code is TypeScript, checked with `strict`,
`exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`,
`noPropertyAccessFromIndexSignature`, `noImplicitOverride`,
`noImplicitReturns` and the checks of unused code on
(`tsconfig.json`). `verbatimModuleSyntax` and `erasableSyntaxOnly` keep
it to syntax whose types erase, so no enum and no namespace. `tsc`
compiles `src/` to `dist/` as ES2024 JavaScript with its `.d.ts`
declarations beside it (`tsconfig.build.json`), which is what the package
ships.

TypeScript is held at 6.0. Its latest release, 7, is not yet one
typescript-eslint takes, and the type-aware lint (D10) is worth more than
a faster compiler; the driver moves once typescript-eslint takes it.
`@types/node` is held at Node.js 22's (D3).

#### D10. ESLint with typescript-eslint, and Prettier, rather than Biome

ESLint lints with its recommended rules and typescript-eslint's
`strict-type-checked` and `stylistic-type-checked`, which ask the
TypeScript compiler for types, so a floating promise, a condition that is
not a boolean or an unsafe `any` is found. `eslint.config.js` adds the
rules that hold §3 where a tool can: the sizes, magic numbers, doc
comments (eslint-plugin-jsdoc) and their TSDoc syntax (eslint-plugin-tsdoc),
TODO comments, top-level await and `process.exit`. `npm run lint` fails on
any warning.

Prettier formats the code and its configuration, 120 columns wide, with
single quotes. The documents and the files in `.github/` are written by
hand, in the form turborel's repository keeps them, so Prettier leaves
them.

Biome would do both with one tool, but it infers types itself rather than
asking the TypeScript compiler, and its rules that need types are fewer
than `strict-type-checked`'s.

#### D11. Tests on `node:test` against the compiled code; coverage by c8

The tests are in `test/`, a file `*.test.ts` beside the path of what it
tests, on Node.js's own runner, `node:test`, with `node:assert/strict`, so
no test framework is a dependency. `tsc` compiles them, and the library
with them, to `build/` (`tsconfig.test.json`), and `node --test` runs the
JavaScript, so the tests run the code as it is compiled. Running
TypeScript directly is not stable on every release supported (D3).

c8 measures coverage from V8's own counts, mapped back to the TypeScript
by source maps, over every file of `src/`, and fails below the floor in
`.c8rc.json` (R-COV).

#### D12. The checks are npm scripts, run by a pre-commit hook

Every check is a script of `package.json`, made only of Node.js and the
tools, so it runs alike on Linux, macOS and Windows:

| Script | Runs |
|---|---|
| `verify` | `format:check`, `lint`, `typecheck`, `build` and `test`, stopping at the first failure |
| `coverage` | the tests under c8, against the floor |
| `format` | Prettier, writing |
| `install-hooks` | points git at `.githooks/`, once per clone |

`.githooks/pre-commit` runs `npm run verify` before each commit. It is
the one file not in JavaScript, since git runs a hook as a script, and it
only hands over to npm. There are no shell scripts (R-PROC-5).

#### D13. CI on Linux, macOS and Windows, on every supported Node.js

`verify.yml` runs `npm run verify` on Linux, macOS and Windows, on Node.js
22, 24 and 26, for every push to main and every pull request, and
coverage on Linux. A hook can be skipped and checks one platform, so both
are needed. Each action is pinned by its full commit digest, its version
in a comment, and Dependabot proposes their updates and the development
dependencies' each week. `release.yml` runs only by hand (D8). `docs-site.yml` tells turborel.com's documentation
site, as turborel's does, when `doc/` changes on main or a release is
made, naming this repository, by the secret `SITE_DISPATCH_TOKEN`.

The live tests against a server come with the transport, milestone M2, on
the image `ghcr.io/turborel/turborel:nightly`.

#### D14. The development dependencies

The package has no runtime dependency (D5). These are what its checks
run on, each pinned by the lock file, each a stable major release by its
own account, and each under a license that lets it be used so.

| Package | Version | License | For |
|---|---|---|---|
| `typescript` | 6.0 | Apache-2.0 | the compiler and the type check (D9) |
| `@types/node` | 22 | MIT | Node.js's types, of the oldest release supported (D3) |
| `eslint`, `@eslint/js` | 10 | MIT | the lint (D10) |
| `typescript-eslint` | 8 | MIT | the type-aware lint rules (D10) |
| `eslint-plugin-jsdoc` | 65 | BSD-3-Clause | every public item documented (R-DOC-1) |
| `eslint-plugin-tsdoc` | 0.5 | MIT | doc comments in TSDoc's syntax (R-DOC-3) |
| `prettier` | 3 | MIT | the format (D10) |
| `c8` | 12 | ISC | coverage (D11) |

`eslint-plugin-tsdoc` is at 0.5, below 1.0, as it has always been. It is
TSDoc's own linter, made by the project that defines the syntax, and runs
only in the lint.

---

## 2. Project layout

```
package.json            the package: name, version, exports (D4), engines
                        (D3), the scripts (D12), development dependencies
package-lock.json       their pinned versions
tsconfig.json           the type check (D9)
tsconfig.build.json     the package's build, src/ to dist/
tsconfig.test.json      the tests' build, to build/
eslint.config.js        the lint (D10)
.prettierrc.json        the format (D10)
.c8rc.json              coverage and its floor (D11, R-COV)
.githooks/pre-commit    verify before each commit (D12)
README.md               what the driver is; how to build and use it
RULES.md                this file
CONFORMANCE.md          the parity matrix: the protocol and turborel-client
TODO.md                 open work, by milestone
VERSIONING.md           the version, the alpha, publishing (D8)
CONTRIBUTING.md         changes, commit messages, pull requests, issues
SECURITY.md             how to report a vulnerability
AGENTS.md               the guide for coding agents
CLAUDE.md               points Claude Code to AGENTS.md
.github/                CI (workflows/), issue forms, labels, pull
                        request template, Dependabot
doc/                    the manual (R-DOC-7), laid out as turborel's
  README.md             the documentation set
  user/                 Volume I, the User's Guide, chapters in order
  client/               Volume II, the API Reference
  appendix/             the appendices
src/                    the library
  index.ts              the package's one entry, its exports
  error.ts              TurborelError (D7)
  codec/                the protocol's encoding, without I/O
test/                   the tests (D11), mirroring src/
  codec/
```

The layers of D1 each get a directory of `src/` as they are built:
`transport/`, `auth/`, `tls/`, `session/`, `statements/`, `lobs/`,
`copy/`, `settings/`, `pipeline/`, `pool/` and `api/`. The live tests'
server setup goes in `test/server/`, and fixtures the tests share in
`test/support/`. `dist/`, `build/` and `coverage/` are made and ignored.

---

## 3. Code rules

### R-STYLE: formatting and idiom

| ID | Rule | Checked by |
|---|---|---|
| R-STYLE-1 | Code and its configuration **shall** be formatted by Prettier. | `npm run format:check` |
| R-STYLE-2 | Code **shall** pass ESLint with no warning and `tsc` with the checks of D9. | `npm run lint`, `npm run typecheck` |
| R-STYLE-3 | Names **shall** follow TypeScript's casing: `camelCase` functions and variables, `PascalCase` types and classes, `UPPER_SNAKE_CASE` constants; code implementing a message or field is named after it, as the spec names it. | review |
| R-STYLE-4 | Exports **shall** be named, never default; a relative import names its file with `.js`; an import of types alone is `import type`. | `no-restricted-exports`, `consistent-type-imports`, `tsc` |
| R-STYLE-5 | No `enum` or `namespace`; a set of constants is `const`s, or an object `as const`. | `erasableSyntaxOnly` |
| R-STYLE-6 | No `any`, no non-null assertion `!`, and no `==`. | `strict-type-checked`, `eqeqeq` |
| R-STYLE-7 | Library code **shall not** print: no `console`. | `no-console` |

### R-SIZE: short functions and files

| ID | Rule | Checked by |
|---|---|---|
| R-SIZE-1 | A function **shall** have at most 50 lines of code, blank lines and comments not counted. | `max-lines-per-function` |
| R-SIZE-2 | A source file **shall** have at most 600 lines; split by the spec's sections or by layer. | `max-lines` |
| R-SIZE-3 | A function **shall** take at most 5 parameters; else an options object. | `max-params` |
| R-SIZE-4 | A module **should** hold one concept, stated in its file's doc comment. | review |
| R-SIZE-5 | A function's complexity **shall** be at most 15, and its blocks nested at most 5 deep. | `complexity`, `max-depth` |

### R-DOC: comments and documentation

| ID | Rule | Checked by |
|---|---|---|
| R-DOC-1 | Every exported item **shall** have a doc comment in TSDoc, with `@param`, `@returns` and `@throws` where they apply. | `jsdoc/require-jsdoc` |
| R-DOC-2 | Comments **shall** say *why*: the section implemented, the choice made, the invariant relied on. | review |
| R-DOC-3 | Doc comments **shall** be valid TSDoc. | `tsdoc/syntax` |
| R-DOC-4 | Behaviour the spec governs **shall** cite it by its heading: `[PROTOCOL Frames]` for a section of `doc/client/05-protocol.md`, `[CLIENT Pipelines]` for one of `doc/client/02-library.md` or `02-library-connections.md`, whose headings differ, an RFC by its section, as `[RFC 5802 §3]`, and a choice of the driver's own `[DESIGN] D<n>`. Each heading is checked against the document before it is cited. | review |
| R-DOC-5 | No commented-out code, and no `TODO`, `FIXME`, `XXX` or `HACK` comments: open work goes in TODO.md, and code never cites TODO.md. | `no-warning-comments`; review |
| R-DOC-6 | Every file **shall** start with a doc comment giving its responsibility; a module of `src/` marks it `@packageDocumentation`. | review |
| R-DOC-7 | A change a program can see **shall** update the manual, `doc/`, in the same commit, its examples run again. The manual keeps turborel's layout, which turborel.com's documentation site reads: each page opens with its `# Title` and a line holding only `[Contents](README.md)`, each folder's `README.md` lists its pages, and every relative link resolves. | review |

### R-CONST: no magic numbers or strings

| ID | Rule | Checked by |
|---|---|---|
| R-CONST-1 | Numeric literals in `src/` other than `0` or `1` **shall** be named `const`s, documenting the value's source. | `no-magic-numbers` |
| R-CONST-2 | Every protocol tag **shall** be a named constant, defined once: a message's kind, a data type's and a value's tag, a tail tag, a capability's name, a status name, a mechanism's name, and each SQLSTATE the driver raises. So **shall** strings matched or looked up, such as settings' names. Messages for people are not. | review |
| R-CONST-3 | Related constants **shall** live together in their layer's module, under a comment naming the section of the spec they come from. | review |
| R-CONST-4 | Tests may use literal fixtures, such as a frame's bytes; an expected value restating a constant **should** use it. | review |

### R-ERR: errors, not crashes

| ID | Rule | Checked by |
|---|---|---|
| R-ERR-1 | Library code **shall** throw nothing but a `TurborelError`, and reject no promise with anything else (D7): an error of Node.js's beneath it is its `cause`. It **shall not** end the process. | `no-restricted-properties`; review |
| R-ERR-2 | A failure **shall** carry the SQLCODE, SQLSTATE, message, rule, position, active flag and diagnostics the server gave; one the driver raises itself, the SQLCODE and SQLSTATE turborel-client gives for the same failure, and a message in plain words. | review; tests |
| R-ERR-3 | No promise **shall** float: each is awaited, returned, or handed to what handles its rejection. Every `'error'` event of a socket or stream **shall** be listened to, so nothing goes unhandled. | `no-floating-promises`, `no-misused-promises`; review |
| R-ERR-4 | A failure, a log or a stack **shall** never hold a secret: a password, a SCRAM key or proof, or a cancel key. | review; tests |
| R-ERR-5 | A connection that fails **shall** close, and every request waiting on it **shall** be rejected with that failure; none is left pending. | review; tests |

### R-NUM: integers and bytes

| ID | Rule | Checked by |
|---|---|---|
| R-NUM-1 | An integer the protocol writes as `u64`, `i64` or `i128` **shall** be read as a `bigint`, and written from one; a `u32`, a `u8` or an `i32` may be a `number`. A `bigint` turned into a `number` **shall** be shown to be a safe integer first. | review |
| R-NUM-2 | Bytes **shall** be read and written by `DataView` or `Buffer`'s methods, little-endian said explicitly, never by bitwise operators on numbers wider than 32 bits. | review |
| R-NUM-3 | A count or length read from a peer **shall** be checked against what follows and the limit taken before anything is allocated by it. | review; tests |
| R-NUM-4 | An exact number **shall** never pass through a `number` (D6). | review; tests |

### R-SAFE: language subset and resources

| ID | Rule | Checked by |
|---|---|---|
| R-SAFE-1 | No `eval`, `new Function` or other code made at run time. | `no-eval`, `no-new-func`, `no-implied-eval` |
| R-SAFE-2 | No module-level mutable state: what lasts belongs to an object a program made, such as a connection, a pool or a key cache. | review |
| R-SAFE-3 | No top-level `await` (D4). | `no-restricted-syntax` |
| R-SAFE-4 | A closed connection, cursor or pool **shall** leave nothing running: no socket, timer or listener. | review; tests |

### R-DEP: dependencies

| ID | Rule | Checked by |
|---|---|---|
| R-DEP-1 | The package **shall** have no runtime dependency (D5). A development dependency **shall** have a row in D14, with its version, license and use. | review |
| R-DEP-2 | Node.js's own modules come first; a dependency **shall** be production-grade by its own claims, a stable release its makers support. | review |
| R-DEP-3 | `package-lock.json` **shall** be under version control, and CI installs by `npm ci`. | review |

---

## 4. Test rules

### R-TEST: levels and layout

| ID | Rule | Checked by |
|---|---|---|
| R-TEST-1 | A test **shall** sit at the lowest level that shows its requirement: a codec test of bytes, a test of a layer over a stream the test controls, or a live test against a server. | review |
| R-TEST-2 | Tests **shall** derive from the spec and turborel-client, not from the code: normal cases, boundaries included, and robustness cases, the exact SQLCODE and SQLSTATE expected. | review |
| R-TEST-3 | A test's name **shall** say the behaviour checked. | review |
| R-TEST-4 | Tests **shall** be deterministic and independent: no clock, randomness, network beyond loopback, or order between them. A live test runs against a server on 127.0.0.1 that its setup starts. | review |
| R-TEST-5 | Every fixed defect **shall** get a regression test that fails without the fix, its doc comment saying so. | review |
| R-TEST-6 | A fixture or helper shared by test files **shall** be written once, in `test/support/`. Tests use `node:test` and `node:assert/strict`, no other framework. | review |

### R-TRACE: traceability

| ID | Rule | Checked by |
|---|---|---|
| R-TRACE-1 | Every test **shall** have a doc comment starting `Verifies:` and a tag: `[PROTOCOL <heading>]`, `[CLIENT <heading>]`, `[RFC <n> §<section>]` or `[DESIGN] D<n>` (R-DOC-4). | review |
| R-TRACE-2 | Code implementing a requirement **shall** cite it (R-DOC-4). | review |
| R-TRACE-3 | CONFORMANCE.md **shall** change with the change that implements or changes a row. | review |

---

## 5. Coverage

| ID | Rule | Checked by |
|---|---|---|
| R-COV-1 | Coverage **shall** be measured by `npm run coverage`, over every file of `src/`. | c8 |
| R-COV-2 | Coverage **shall not** fall below the floor in `.c8rc.json`: 95 % of lines, statements and functions, and 90 % of branches. The floor only rises, and a change that raises coverage **should** raise it. | c8, in CI |
| R-COV-3 | A gap is closed by a test of a requirement, or by removing dead code; never by a test of no requirement. | review |

---

## 6. Platforms

| ID | Rule | Checked by |
|---|---|---|
| R-PLAT-1 | The driver **shall** run on Linux, macOS and Windows, on each Node.js release D3 supports, and CI **shall** check each (D13). | CI |
| R-PLAT-2 | Code of one platform, such as a Unix socket or a named pipe, **shall** be chosen at run time, and **shall** fail clearly elsewhere, never silently do something else. | review; tests |
| R-PLAT-3 | Paths **shall** be made by `node:path`, and files read and written with LF line endings (`.gitattributes`). | review |

---

## 7. Process and tools

| ID | Rule | Checked by |
|---|---|---|
| R-PROC-1 | `npm run verify` **shall** pass before every commit: format, lint, type check, build and every test. CI adds coverage. | pre-commit hook; CI |
| R-PROC-2 | Every change **shall** be reviewed against the checklist below. | review |
| R-PROC-3 | Commits **should** be small and single-purpose, in CONTRIBUTING.md's form (`area: summary`, then why), citing rules applied or changed. | review |
| R-PROC-4 | A change of a threshold **shall** change RULES.md and the configuration holding it together. | review |
| R-PROC-5 | Project automation **shall** be npm scripts and Node.js, never shell scripts (D12). | review |
| R-PROC-6 | Nothing **shall** be published to npm but by the owner, as VERSIONING.md says (D8). | review |

The review checklist:

- requirement cited in code (R-DOC-4) and tests (R-TRACE-1);
- normal and robustness tests (R-TEST-2), a failing-first test for a fix
  (R-TEST-5);
- every failure a `TurborelError`, no promise floating, no secret in a
  failure (R-ERR);
- no magic numbers or strings, protocol tags named (R-CONST);
- integers past 32 bits as `bigint`, counts checked before allocation
  (R-NUM);
- comments explain why (R-DOC-2);
- CONFORMANCE.md updated (R-TRACE-3), and TODO.md where open work
  changed.

---

## 8. Where these rules depart from Node.js convention

The driver follows the conventions of Node.js libraries, but where one
conflicts with a rule above, the rule is kept:

- Node.js's own APIs throw a `TypeError` or `RangeError` for an argument
  of the wrong type or range. The driver throws a `TurborelError` for
  every failure, an argument's too, with the SQLCODE and SQLSTATE
  turborel-client gives for it (R-ERR-1), so a program catches one type.
- Libraries commonly leave function and file length to taste. These are
  bounded (R-SIZE).
- Libraries commonly read 64-bit integers as `number` where they expect
  them small. The driver reads every one as a `bigint` (R-NUM-1).

---

## 9. References

- turborel, `doc/client/05-protocol.md`, *The Native Protocol*, version
  1: the requirements of the codec and every message.
- turborel, `doc/client/02-library.md` and `02-library-connections.md`,
  and the crates turborel-client and turborel-protocol: the features to
  match, and the reference where the spec is silent.
- RFC 5802 and RFC 7677, SCRAM and SCRAM-SHA-256; RFC 5929 and RFC 9266,
  the `tls-server-end-point` and `tls-exporter` channel bindings; RFC 1950,
  the zlib stream.
- Node.js's documentation of its release schedule, of modules and
  `require(esm)`, and of `node:net`, `node:tls`, `node:crypto`,
  `node:zlib` and `node:test`.
- The TypeScript handbook and its compiler options; typescript-eslint's
  shared configurations; TSDoc.
