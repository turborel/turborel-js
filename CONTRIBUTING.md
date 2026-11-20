# Contributing to turborel-js

turborel-js carries data between programs and a database people depend
on. A value read or sent wrongly, a password let out, or a connection
that hangs a program is worse than a feature missing. So a change is
judged first on whether it keeps values exact, secrets secret and
connections sound, and then on what it adds. The process follows the
Linux kernel's, adapted to pull requests and to a driver.

[Before you start](#before-you-start) · [Setting up](#setting-up) ·
[Making a change](#making-a-change) ·
[Changes to what goes over the wire](#changes-to-what-goes-over-the-wire) ·
[Commit messages](#commit-messages) · [Pull requests](#pull-requests) ·
[Review](#review) · [Reporting issues](#reporting-issues) ·
[Security](#security) · [License](#license)

---

## Before you start

Read [RULES.md](RULES.md) §3 (code), §4 (tests), §7 (process) and the
decisions for your area. Every rule applies to every change, and
`npm run verify` checks those a tool can.
[CONFORMANCE.md](CONFORMANCE.md) says what is implemented of the protocol
and of turborel-client's features, and [TODO.md](TODO.md) lists open work.

Open an issue first for anything larger than a fix. That covers new
features, changes to a decision in RULES.md, new dependencies (R-DEP) and
changes to the public API. Agreeing on the design first saves everyone a
rewrite.

The driver follows turborel's native protocol, version 1
([doc/client/05-protocol.md](https://github.com/turborel/turborel/blob/main/doc/client/05-protocol.md)
in turborel), and matches turborel-client
([02-library.md](https://github.com/turborel/turborel/blob/main/doc/client/02-library.md)
and
[02-library-connections.md](https://github.com/turborel/turborel/blob/main/doc/client/02-library-connections.md)).
Where the spec and turborel-client's code differ, the code is right.
Read the section before writing code, and cite it by its heading, as in
`[PROTOCOL Frames]`. Never cite from memory.

## Setting up

You need Node.js 22.12 or later and npm.

```
npm ci                       # the development dependencies the lock file pins
npm run install-hooks        # run verify before each commit (once per clone)
npm run verify               # every check a change must pass
npm run coverage             # the tests under coverage, against its floor, as CI runs it
```

`verify` checks the format (Prettier), lints (ESLint), type-checks
(`tsc`), builds the package and runs the tests (`node:test`). Each step
runs alone as `npm run format:check`, `lint`, `typecheck`, `build` and
`test`; `npm run format` formats.

CI runs `verify` on Linux, macOS and Windows, on Node.js 22, 24 and 26,
and coverage on Linux (D13). A change that passes on one platform or
release and fails on another isn't done.

## Making a change

Keep one logical change per commit, and make each commit pass
`npm run verify` on its own, because anyone bisecting may land on it.
Move code in one commit and change it in another. Don't mix a reformat or
rename with a change of behaviour.

Tests come with the change, at the lowest level that shows it (R-TEST-1).
Cover normal cases, boundaries, and robustness cases with the exact
SQLCODE and SQLSTATE expected (R-TEST-2). Each test's doc comment starts
with `Verifies:` and what it cites (R-TRACE-1). A fixed defect gets a test
that fails without the fix (R-TEST-7).

Documents change in the same commit. Update CONFORMANCE.md for a row
implemented or changed (R-TRACE-3), RULES.md for a decision made or
changed, and TODO.md for open work done or found. Code never cites
TODO.md. The manual, `doc/`, changes in the same commit too, its examples
run again (R-DOC-7).

The manual is laid out as turborel's, since turborel.com's documentation
site builds its pages from every repository's `doc/`: the User's Guide's
chapters in `doc/user/`, the API Reference's pages in `doc/client/`, and
the appendices in `doc/appendix/`, each folder with a `README.md` listing
its pages. A page opens with its `# Title`, then a line holding only
`[Contents](README.md)`, and links to other pages by relative `.md`
links, each of which must resolve. A new page is listed in its folder's
`README.md`.

Some rules deserve a reminder.

- Every failure is a `TurborelError` (R-ERR), and no dependency comes
  without a decision in RULES.md (R-DEP).
- Performance claims cite measurements, before and after, with the costs
  in memory, latency and code size.
- The coverage floor only rises (R-COV-2).

## Changes to what goes over the wire

These need more than passing tests. Say in the commit message what was
done for each that applies.

A change to how a message, a field or a value is written or read cites
its section of the spec, and is checked byte for byte against what
turborel-client writes or reads, and against a server.

A change to TLS, authentication or settings says what a program that set
nothing sees, and shows that a secret is never sent where it should not
go (SECURITY.md).

A change to how a connection is read says what a malformed, short or
overlong frame does: it fails the connection (SQLCODE -919, SQLSTATE
08006), and the driver never holds more than the limit it was given.

## Commit messages

The form is Linux's.

```
area: summary in the imperative, at most 75 characters

The problem: what goes wrong, or is missing, and who it affects. A
wrong value, a crash, a hang or a secret let out is said first, with
the program that shows it.

Why this change, and how it solves the problem. Mention the choices
made and the alternatives rejected, the rules and sections applied
(RULES.md D4, R-ERR-2, [PROTOCOL Frames]), and what was measured,
with numbers.

Fixes: 54a4f0239f2e ("codec: refuse a tail tag out of order")
Closes: <link to the issue>
Reported-by: A Reporter <reporter@example.org>
```

The subject is `area: summary`, at most 75 characters, in the imperative
("refuse a frame...", not "refused"), with no full stop. It says what
changes, isn't a file name, and isn't reused within a series.

The body is wrapped at 75 columns and written for someone reading `git log`
years later with no context. Say what the change does in plain prose, since
the diff shows how. Don't write "as discussed" or "v2".

Pick the area where most of the change is.

| Area | Covers |
|---|---|
| `codec` | `src/codec/`: frames, fields, types and values, the tail, JSON, compression |
| `transport` | `src/transport/`: TCP, Unix sockets, named pipes, timeouts |
| `auth` | `src/auth/`: mechanisms, SCRAM and its key cache |
| `tls` | `src/tls/`: TLS, its modes and channel binding |
| `session` | `src/session/`: Hello, Ready, status, notices, cancel, terminate, ping, reset |
| `statements` | `src/statements/`: queries, prepared statements, cursors, describe |
| `lobs` | `src/lobs/`: large objects by locator, and their streams |
| `copy` | `src/copy/`: copy, import and export |
| `settings` | `src/settings/`: the URI, options, environment, service and password files, hosts and roles |
| `pipeline` | `src/pipeline/` |
| `pool` | `src/pool/`: pools and the SQL-agent |
| `api` | `src/index.ts`, `src/error.ts`, `src/api/`: the package's exports and the standard API |
| `test` | `test/server/`, `test/support/`: the live tests' server and shared fixtures |
| `doc` | `doc/`, README.md, RULES.md, CONFORMANCE.md, TODO.md, AGENTS.md, CLAUDE.md, this file |
| `ci` | `.github/`: workflows, issue forms, labels |
| `build` | `package.json`, the lock file, the compiler, lint, format and coverage configuration, `.githooks/` |
| `treewide` | a mechanical change across many areas |

A module's tests are in the same area as the module, under `test/`.

Trailers go at the end, one per line, never wrapped.

| Trailer | Meaning |
|---|---|
| `Fixes: <12+ hex digits> ("<subject>")` | the commit that introduced the defect fixed |
| `Closes: <link>` | the issue this commit resolves |
| `Link: <link>` | background, such as a discussion or an issue fixed only in part |
| `Reported-by:` | who reported the defect fixed, with `Closes:` |
| `Suggested-by:` | who suggested the idea |
| `Co-authored-by:` | a co-author, as GitHub credits one |
| `Reviewed-by:` | a reviewer who checked the change and is satisfied with it |
| `Acked-by:` | a maintainer of the area who approves it without a full review |
| `Tested-by:` | someone who tested it, saying where if that matters |

`Reported-by:` and `Suggested-by:` may be added without asking. The others
name someone who said so on the record. `git log -1 --abbrev=12
--pretty='Fixes: %h ("%s")' <commit>` writes the `Fixes:` line.

No commit or pull request carries AI or agent attribution: no
`Co-authored-by:` of an agent, no "Generated with" line, and no
`Signed-off-by:`. Whoever submits a change answers for it.

Stage with an explicit list of paths, `git add -- <path> ...`, never
`git add -A` or `git add .` on the whole tree, so nothing unmeant is
committed.

## Pull requests

A pull request is a patch series, and its description is the cover letter.
The template asks for what and why, the series commit by commit, testing,
compatibility and performance. Each commit message still stands alone.

Base it on `main` and keep it rebased, without merging `main` into it. When
revising, rewrite the commits so the series is again what should be merged,
with no "fix review comments" commits. Force-push, and say in a comment what
changed since the last version.

Trailers given in review go into the commits they cover. Drop them from a
commit that later changes substantially, and say so.

Keep a series to about 15 commits. Split a larger one into series that each
stand alone.

## Review

Reviewers check each commit against RULES.md §7's checklist, and that the
manual is updated (R-DOC-8). For
[changes to what goes over the wire](#changes-to-what-goes-over-the-wire),
they also check the bytes against the spec and turborel-client. Review
comments are about the change, never the person. A reviewer who is
satisfied gives `Reviewed-by:`.

## Reporting issues

Use the issue forms, **Bug**, **Conformance**, **Performance** or
**Feature**. A conformance issue is one where the driver departs from the
protocol spec or from turborel-client. Try the latest `main` first, and
add to an existing issue that matches rather than opening another.

Reproduce with the smallest program that shows it, and the SQL it runs
from an empty database.

State the impact first. Put it in the title's first word when it is severe.

| Tag | Meaning |
|---|---|
| `[WRONG RESULT]` | a value read or sent wrongly |
| `[CRASH]` | an uncaught exception, an unhandled rejection or a process that dies |
| `[HANG]` | a promise that never settles, or a connection never released |
| `[REGRESSION]` | worked in an earlier commit (give the last good commit and, if you can, the first bad one) |

Give the driver's commit (`git rev-parse --short=12 HEAD`), the server's
version, the Node.js version, and the platform and architecture.

## Security

Don't open a public issue for a vulnerability. Report it privately, as
[SECURITY.md](SECURITY.md) says.

## License

turborel-js is under the BSD-2-Clause Plus Patent License in
[LICENSE](LICENSE), and a contribution is made under that license.
Contributors keep their copyright and own their changes. Whoever
submits a change answers for all of it, however it was written.
