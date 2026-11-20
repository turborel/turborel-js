# Guide for coding agents

How to work on turborel-js as a coding agent, with any tool. If this file
disagrees with [RULES.md](RULES.md) or [CONTRIBUTING.md](CONTRIBUTING.md),
follow those.

turborel-js is the JavaScript driver for turborel, a relational database
system: turborel's native protocol, version 1, spoken in TypeScript for
Node.js 22.12 and later, with no runtime dependency. Its scope is
everything turborel-client does, under a Promise-based API. See
[README.md](README.md).

## Before you change anything

Read RULES.md §3 (code), §4 (tests), §7 (process) and the §1 decisions
for your area. Read CONTRIBUTING.md for how a change is made and the extra
checks for changes to what goes over the wire.

The spec is `doc/client/05-protocol.md` in turborel's repository, and the
reference is turborel-client (`client/src/`) and turborel-protocol
(`protocol/src/`) there. Where the spec and the code differ, the code is
right. `doc/client/02-library.md` and `02-library-connections.md`
describe every feature to match.

## Build and check

Every change must pass `npm run verify` and `npm run coverage` before it
is handed back.

```
npm ci                    # the development dependencies the lock file pins
npm run verify            # every check a change must pass
npm run coverage          # the tests under coverage, against its floor
npm run install-hooks     # run verify before every commit (once per clone)
npm run format            # format the code with Prettier
npm run lint              # ESLint alone
npm run typecheck         # tsc alone, emitting nothing
npm run build             # the package, src/ to dist/
npm test                  # the tests alone, compiled to build/ and run by node --test
```

`verify` stops at the first failure. CI runs it on Linux, macOS and
Windows, on Node.js 22, 24 and 26, and coverage on Linux (D13). The
coverage floor is in `.c8rc.json` and only rises (R-COV-2).

Project automation is npm scripts and Node.js, never shell scripts (D12,
R-PROC-5).

## Where things are

| Path | What |
|---|---|
| `src/index.ts` | the package's one entry: everything it exports |
| `src/error.ts` | `TurborelError`, the one error type (D7) |
| `src/codec/` | the protocol's encoding, without I/O: frames so far |
| `test/` | the tests, one `*.test.ts` beside the path of what it tests |
| `doc/` | the manual, as turborel.com's documentation site reads it: `user/`, `client/`, `appendix/` |
| `dist/`, `build/`, `coverage/` | made by the build, the tests and coverage; ignored |

The layers still to come each get a directory of `src/`, named in RULES.md
§2, and so do their tests in `test/`.

## Rules that are broken most often

`npm run lint` treats every warning as an error. RULES.md §3 and §4 have
the full list.

- Every failure is a `TurborelError`: never `throw new Error`, `TypeError`
  or `RangeError`, and never reject with anything else. Wrap an error of
  Node.js's as the `cause` (R-ERR-1).
- No floating promises. Await, return or handle each one, and listen to
  every socket's and stream's `'error'` (R-ERR-3).
- A failure never holds a password, a SCRAM key or a cancel key (R-ERR-4).
- An integer the protocol writes as `u64`, `i64` or `i128` is a `bigint`,
  never a `number`; an exact number never passes through a `number`
  (R-NUM-1, R-NUM-4, D6).
- Check a count or length from the peer against what follows and the
  limit before allocating by it (R-NUM-3).
- Read bytes through `DataView` or `Buffer`, little-endian said (R-NUM-2).
- No `any`, no `!` non-null assertion, no `==` (R-STYLE-6).
- Named exports only; relative imports end in `.js`; `import type` for
  types (R-STYLE-4).
- No `enum` or `namespace`: `const`s, or an object `as const` (R-STYLE-5).
- No top-level `await`: `require` could not load the package (D4,
  R-SAFE-3).
- No `console`, no `process.exit`, no module-level mutable state
  (R-STYLE-7, R-ERR-1, R-SAFE-2).
- Keep functions to 50 lines and 5 parameters, and files to 600 lines
  (R-SIZE).
- No magic numbers or strings; every protocol tag a named constant
  (R-CONST).
- Every exported item has a TSDoc comment, and every file starts with one
  (R-DOC-1, R-DOC-6). Comments say why (R-DOC-2). No `TODO` comments or
  commented-out code (R-DOC-5).
- No runtime dependency, and no development dependency without a row in
  D14 (R-DEP).
- A closed connection leaves no socket, timer or listener behind
  (R-SAFE-4).

## Tests

Every test has a doc comment starting `Verifies:` and a tag
(R-TRACE-1): `[PROTOCOL <heading>]` for a section of `05-protocol.md`,
`[CLIENT <heading>]` for one of `02-library.md` or
`02-library-connections.md`, `[RFC <n> §<section>]`, or `[DESIGN] D<n>`.
For example:

```ts
/** Verifies: [PROTOCOL Frames] the header is five bytes, a u8 kind then a u32 length, least significant first. */
test('a header is its kind, then its length little-endian', () => { ... });
```

Tests are deterministic, with no clock, randomness or network beyond
loopback (R-TEST-4). Fixtures shared by test files go in `test/support/`
(R-TEST-6). A fixed defect gets a regression test that fails without the
fix (R-TEST-5).

## Citing the spec

Check every citation against the document before writing it: the heading
must exist as printed in `05-protocol.md`, `02-library.md` or
`02-library-connections.md`. Never cite from memory.

Code never cites TODO.md.

## Documents

A finished feature updates these in the same change:

- RULES.md, if it made a decision, including the row in §1's table
- CONFORMANCE.md, its row marked done (R-TRACE-3)
- TODO.md, which only holds open work
- [doc/](doc/README.md), for anything a program sees (R-DOC-7), its
  examples run: a chapter of `doc/user/`, a page of `doc/client/`, or an
  appendix of `doc/appendix/`
- README.md, if what the driver does changes

Committed documents carry no benchmarks or timings, and every claim in
them is checked against the code. The manual keeps turborel's layout,
which the documentation site depends on: each page opens with its
`# Title` and a line holding only `[Contents](README.md)`, links between
pages are relative `.md` links that resolve, and each folder's
`README.md` lists its pages.

## Commits

- Commit only when the maintainer asks, and never push without approval.
- Follow CONTRIBUTING.md's form, with one logical change per commit.
- Add no AI or agent attribution to a commit or pull request. That means
  no `Co-Authored-By` for an agent, no "Generated with" and no
  `Signed-off-by`.
- Stage with an explicit path list, `git add -- <path> ...`. Never use
  `git add -A` or `git add .` on the whole tree.
- Never stage `LICENSE`, which the owner commits, or scratch files.
- Never change git's configuration: `npm run install-hooks` is for a
  person setting up a clone of their own.
- Code that behaves differently on one platform can't be verified locally
  on another. Say so when handing it back.
