# Guide for coding agents

How to work on turborel-js as a coding agent, with any tool. If this file
disagrees with [RULES.md](RULES.md) or [CONTRIBUTING.md](CONTRIBUTING.md),
follow those.

turborel-js is the JavaScript driver for Turborel, a relational
database system. It speaks Turborel's native protocol, version 1,
itself, in TypeScript compiled to JavaScript, with no native code and no runtime dependency beyond Node.js's own modules, and is built to do all turborel-client does. See
[README.md](README.md).

## Before you change anything

Read RULES.md §3 (code), §4 (tests), §6 (process) and the decisions for
your area. Read CONTRIBUTING.md for how a change is made and the extra
checks for changes that touch the protocol. Read the section of the
protocol, or of the client documents, that your change implements, and
the rows of CONFORMANCE.md it marks done.

## Build and check

Every change must pass `npm run verify` and `npm run coverage`
before it is handed back.

```
npm ci                    # the development dependencies the lock file pins
npm run install-hooks     # run verify before every commit (once per clone)
npm run verify            # every check a change must pass
npm run coverage          # the tests under coverage, against its floor
npm test                  # the tests alone, compiled to build/ and run by node --test
npm run check             # the checks tool alone: citations, the manual, open-work markers
npm run build             # the package, src/ to dist/
npm run format            # format the code with Prettier
```

`npm run verify` stops at the first failure (RULES.md D4). CI runs it
on Linux, macOS and Windows, on each supported runtime, and coverage on
Linux. The coverage floor only rises (D7, R-COV-2).

Project automation is the language's own tooling, never shell scripts
(R-PROC-5).

## Where things are

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

The protocol is Turborel's `doc/client/05-protocol.md`, the client's
features `doc/client/02-library.md` and `02-library-connections.md`, and
the reference code `protocol/src/` and `client/src/`, all in
[turborel](https://github.com/turborel/turborel). Where the page and the
code differ, the code is right; CONFORMANCE.md names each such place.

## Rules that are broken most often

`npm run verify` treats every warning as an error (R-LINT-1). RULES.md
§3 and §4 have the full list.

- Every failure is the driver's error, with its SQLCODE and SQLSTATE
  (R-ERR-1, R-ERR-2). No error of the language or a library beneath it
  reaches a program; catch it, and give the driver's, keeping the cause
  (R-ERR-3).
- No printing, and no ending the process, in library code (R-STYLE-3,
  R-ERR-1).
- Check every length or count a server sends against its bound before
  reading or reserving for it (R-SAFE-1).
- No secret in a log, a failure's message or an object's display form
  (R-SAFE-4).
- Integers of the protocol are read and written at their width,
  little-endian; exact numbers never pass through a float (R-NUM).
- Keep functions to 50 lines of code and 5 parameters, and files to 600
  lines (R-SIZE).
- No magic numbers or strings: protocol tags, kinds, capability, status
  and mechanism names are named constants, defined once (R-CONST).
- Every public item has a doc comment (R-DOC-1). Comments say why
  (R-DOC-2). No `TODO` comments or commented-out code (R-DOC-5).
- A silenced warning names its rule and says why (R-LINT-3).
- No dependency without a decision in RULES.md (R-DEP-1).
- Code of one platform is chosen by the platform and refused elsewhere
  with the driver's error (R-PLAT-2).
- No floating promise: await, return or handle each one, and listen to
  every socket's and stream's `'error'` (R-ASYNC-1, R-ASYNC-2).
- No `any`, no `!` non-null assertion, no `==` (R-TYPE-1).
- Named exports only; relative imports end in `.js`; `import type` for
  types (R-TYPE-2).
- No `enum` or `namespace`, and no top-level `await`, which would stop
  `require` loading the package (R-TYPE-3, R-ASYNC-3).
- An integer the protocol writes as `u64`, `i64` or `i128` is a
  `bigint`, never a `number` (R-TYPE-4).

## Tests

Every test cites what it verifies, by its doc comment, beginning `Verifies:`, beginning with a
tag (R-TRACE-1, D6):

- `[PROTOCOL <heading>]`, a section of 05-protocol.md, as
  `[PROTOCOL Frames]`;
- `[CLIENT <heading>]`, a section of 02-library.md or
  02-library-connections.md, as `[CLIENT Pipelines]`;
- `[DESIGN] D<n>`, a decision of RULES.md;
- `[TOOL] R-<id>`, a rule the checks tool holds.

The checks tool refuses a heading, decision or rule that is not there
(R-TRACE-2). Tests are deterministic, with no clock, randomness or
network beyond loopback (R-TEST-5). A shared fixture is written once
(R-TEST-7). A fixed defect gets a regression test that fails without the
fix (R-TEST-6). A live test runs its own server on its own port and data
directory, and stops it.

## Citing the spec

Check every citation against the document before writing it, by its
heading as printed. Never cite from memory. Code never cites TODO.md.

## Documents

A finished feature updates these in the same change:

- RULES.md, if it made a decision, including the row in §1's table;
- CONFORMANCE.md, each row it implements (R-TRACE-4), marked done only
  where its code exists and its tests pass;
- TODO.md, which only holds open work;
- [doc/](doc/README.md), for anything a program sees (R-DOC-7), every
  example run: each page keeps its `# Title` and its
  `[Contents](README.md)` line, links to this repository's files are
  relative (the docs site points those outside `doc/` at GitHub, at the
  same tag), links to Turborel's manual are GitHub addresses,
  `user/01-installing.md` keeps its name, and `doc/` holds no images;
- README.md, if what the driver is or needs changes.

No document gives timings or speedups; numbers go in a commit message.

## Commits

- Commit only when the maintainer asks, and never push without approval.
- Follow CONTRIBUTING.md's form, with one logical change per commit.
- Add no AI or agent attribution to a commit, a pull request, a file or
  the package's metadata. That means no `Co-Authored-By` for an agent,
  no "Generated with" and no `Signed-off-by`.
- Stage with an explicit path list, `git add -- <path> ...`. Never use
  `git add -A` or `git add .` on the whole tree.
- Never stage scratch files, or a live test's data directory.
- Code compiled for one platform only can't be verified locally on
  another. Say so when handing it back (R-PLAT-4).
