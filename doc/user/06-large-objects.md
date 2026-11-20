# Large Objects

[Contents](README.md)

A CLOB or BLOB value of at most SERVER.LOB_INLINE_BYTES, 64 KiB unless
the operator sets otherwise, comes in its row whole, as a `Lob`: `data`
is a CLOB's text or a BLOB's octets. A longer one comes as a
`LobLocator`, which holds its locator and its lengths, `octets` and
`characters`, not its value; the program reads it by its locator.

## Reading

`readLob(lob, from, count, characters)` reads a range of a large
object, by octets from `from`, or by a CLOB's characters if
`characters`, at most a chunk of 256 KiB at a time. `lobReader(lob)`
gives a Node.js readable stream of its octets, read a chunk at a time.
Either takes a `Lob` held whole too, read from the value itself.

## How long a locator lasts

A locator is valid until the transaction that read it ends. A statement
whose reply sent one keeps its transaction open, under autocommit too,
so commit once the value is read. `freeLob` ends the locator sooner, and
`holdLob` keeps it past the commit, until it is freed or a rollback ends
it. A locator no longer valid fails with SQLSTATE 0F001; a value sent
whole has no locator to free or hold (SQLSTATE 22000).

## Writing

`createLob(kind)` begins a new large object, `'character'` or
`'binary'`, and gives a writer. Each `write` takes octets, or text
written as UTF-8, sent a chunk at a time; a CLOB's octets must be UTF-8,
and a character may be split between writes. `finish` gives the value
as a `LobLocator`, to pass as a parameter of a CLOB or BLOB, valid until
its transaction ends.

```js
import { Trust, connectTo, tcp } from 'turborel';

const conn = await connectTo(tcp('127.0.0.1', 7422), 'ann', new Trust());
await conn.query('CREATE TABLE SCANS (ID INTEGER, IMAGE BLOB(10M))');
const writer = await conn.createLob('binary');
for (let i = 0; i < 1024; i += 1) await writer.write(new Uint8Array(4096).fill(7));
const scan = await writer.finish();
const insert = await conn.prepare('INSERT INTO SCANS VALUES (1, ?)');
await conn.execute(insert, [scan]);
await conn.query('COMMIT');
const { rows } = await conn.query('SELECT IMAGE FROM SCANS');
const image = rows[0][0];
console.log(String(image), conn.inTransaction);
let octets = 0;
for await (const chunk of conn.lobReader(image)) octets += chunk.length;
console.log(octets, (await conn.readLob(image, 0n, 4n)).join(','));
await conn.query('COMMIT');
await conn.terminate();
// <BINARY LARGE OBJECT of 4194304 octets> true
// 4194304 7,7,7,7
```

An import sends a field longer than 64 KiB for a CLOB or BLOB column as
a large object it creates, so no message carries more.
