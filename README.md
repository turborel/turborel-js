<p align="center">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="artwork/turborel-logo-white.svg">
      <img src="artwork/turborel-logo.svg" alt="turborel" width="360">
    </picture>
</p>

> turborel-js is in alpha, meaning, version 0.0.0. Anything may change
> from one build to the next, its API above all. Its version is the
> number of the turborel release it is made for, and the alpha speaks
> turborel's native protocol, version 1. See
> [VERSIONING.md](VERSIONING.md).

turborel-js is the JavaScript driver for
[turborel](https://github.com/turborel/turborel), a relational database
system. It connects a Node.js program to `turboreld`, turborel's server,
over turborel's [native
protocol](https://github.com/turborel/turborel/blob/main/doc/client/05-protocol.md),
which it speaks itself, in TypeScript compiled to JavaScript, with no
native code and no runtime dependency beyond Node.js's own modules.

It is built to do everything turborel's own client library,
turborel-client, does: TLS and SCRAM, prepared statements and cursors,
large objects, bulk copy, settings from a URI, the environment and
service files, several servers, pipelines and pools. What it does so far
is in [CONFORMANCE.md](CONFORMANCE.md), and what it does not yet in
[TODO.md](TODO.md). Today it holds its repository's kit, its frame codec
and its error type; nothing that connects.

## What it needs

- Node.js 22.12 or later: 22, 24 and 26 are tested, on Linux, macOS and
  Windows.
- A turborel server of the same release.

It runs in Node.js and in what embeds it, such as Electron. A browser
cannot open a TCP connection, so the driver does not run in one.

## Install

The package is not yet published to npm: nothing is published until
every turborel driver is done. Build it from source:

```
git clone https://github.com/turborel/turborel-js.git
cd turborel-js
npm ci
npm run build          # the package, in dist/
npm run verify         # every check a change must pass
```

A program then installs it from the clone, as
`npm install ../turborel-js`. The package is an ES module, which a
CommonJS program loads with `require` as well.

## A first query

This is what the API will be, built in milestone M7 and checked in M8;
none of it runs yet (RULES.md D2).

```js
import { connect } from 'turborel';

const conn = await connect('turborel://ann@db.example/?tls_mode=verify-full&tls_roots=/etc/turborel/ca.pem');
try {
  const { rows } = await conn.query('SELECT ID, NAME FROM STAFF WHERE ID < ? ORDER BY ID', [3n]);
  for (const [id, name] of rows) {
    console.log(id, name); // 1n 'Ada', then 2n 'Grace'
  }
} finally {
  await conn.close();
}
```

## Documents

- [doc/](doc/README.md): the manuals, a User's Guide, an API Reference
  and appendices, which turborel.com's documentation site publishes.
- [VERSIONING.md](VERSIONING.md): its version, the alpha, and publishing.
- [CONFORMANCE.md](CONFORMANCE.md): what is implemented of the protocol
  and of turborel-client's features.
- [RULES.md](RULES.md): how the driver is designed, written and verified.
- [TODO.md](TODO.md): open work.
- [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md):
  contributing, and reporting an issue or a vulnerability.
- [LICENSE](LICENSE) and [TRADEMARK.md](TRADEMARK.md): the code is
  under the BSD-2-Clause Plus Patent License; the name Turborel and its
  logos are not, and TRADEMARK.md says how they may be used.
