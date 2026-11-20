# The turborel-js Documentation Set

turborel-js is the JavaScript driver for turborel, a relational database
system. It connects a program on Node.js to `turboreld`, turborel's
server, over turborel's native protocol, which it speaks itself, with no
native code and no runtime dependency. This set of manuals describes it
for those who write such programs. The SQL a program sends, and the
server, are described in turborel's own manuals ([The Turborel
Documentation Set](https://github.com/turborel/turborel/blob/main/doc/README.md)).

turborel-js is in alpha: what these manuals describe may change in any
release until 1.0.0 ([Versions](appendix/d-versions.md)). Each change
updates the pages it touches, so the manuals describe the release they
come with. The driver is built in milestones, and a chapter says which
milestone fills it until it does.

## The volumes

| Volume | For | |
|---|---|---|
| [I. User's Guide](user/README.md) | Anyone who writes a program that uses turborel-js | Installing, connecting, statements, transactions, large objects, copying, pipelines and pools, settings, errors, chapter by chapter |
| [II. API Reference](client/README.md) | The same, looking something up | The standard API and the low-level client, a page for each main interface or module |
| [Appendices](appendix/README.md) | Everyone | Types, errors, settings, versions |

Read the User's Guide from the start to learn turborel-js; turn to the
API Reference and the appendices to look a thing up.

## Conventions

**Examples** of JavaScript and of SQL are set in a fixed-width font. Key
words of SQL are in upper case, names in upper case unless delimited, as
the standard folds them:

```js
const { rows } = await conn.query('SELECT NAME, SALARY FROM STAFF WHERE SALARY > ?', [50000n]);
```

**Results** of examples follow them in comments, as the program prints
them.

**Citations** name the section of a document a rule comes from:
[PROTOCOL Frames] is the section *Frames* of turborel's native protocol
(`doc/client/05-protocol.md` in turborel), and [CLIENT Pipelines] the
section *Pipelines* of turborel's client library
(`doc/client/02-library-connections.md`).

**Errors** are given by SQLSTATE, the code the SQL standard defines, and
SQLCODE, the older number, as turborel gives them;
[Appendix B](appendix/b-errors.md) lists them by class.

## Pages of reference

A page of the API Reference has these sections, in this order:

- **NAME**: the function or class, and what it does in a line.
- **SYNOPSIS**: its signature, in TypeScript.
- **DESCRIPTION**: what it does.
- **ERRORS**: each way it fails, by SQLSTATE.
- **EXAMPLES**: programs, and what they print.
- **SEE ALSO**: related pages.
