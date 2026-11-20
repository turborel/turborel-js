# Installing

[Contents](README.md)

This chapter will tell what the driver needs, Node.js 22.12 or later on Linux,
macOS or Windows, and how a program takes `turborel` in from
npm. No package is published until every Turborel driver is
done; until then the driver is built from its source, as the
repository's
[README](../../README.md)
says. The chapter is written with the standard API, at milestone M7, and
again when the packages are published.

## Building from source

Until the package is published, a program takes the driver from a clone
of its repository. It needs Node.js 22.12 or later and npm:

```
git clone https://github.com/turborel/turborel-js.git
cd turborel-js
npm ci
npm run build          # the package, in dist/
```

A program then installs it from the clone, as
`npm install ../turborel-js`. The package is an ES module, which a
CommonJS program loads with `require` as well:

```js
import { TurborelError } from 'turborel';
```

```js
const { TurborelError } = require('turborel');
```

Today the package exports its error type, `TurborelError`, and the
types its exact numbers are read as, `Decimal` and `DecFloat`; it does
not connect to a server yet.
