# Large Objects

[Contents](README.md)

## NAME

`Connection.readLob`, `lobReader`, `createLob`, `freeLob`, `holdLob`,
`LobWriter`: large objects, read by their locators and written in
pieces.

## SYNOPSIS

```ts
const CHUNK_OCTETS = 262_144;
const LOB_INLINE_OCTETS = 65_536;

class Connection {
  readLob(lob: Lob | LobLocator, from: bigint, count: bigint, characters?: boolean): Promise<Uint8Array>;
  lobReader(lob: Lob | LobLocator): Readable;
  createLob(kind: 'character' | 'binary'): Promise<LobWriter>;
  freeLob(lob: Lob | LobLocator): Promise<Completion>;
  holdLob(lob: Lob | LobLocator): Promise<Completion>;
}

class LobWriter {
  readonly kind: 'character' | 'binary';
  write(data: Uint8Array | string): Promise<void>;
  finish(): Promise<LobLocator>;
}
```

## DESCRIPTION

A large object a result sends whole is a `Lob`; one longer than
SERVER.LOB_INLINE_BYTES comes as a `LobLocator`, its locator and its
lengths. `readLob` reads at most `CHUNK_OCTETS` of one from `from`, its
octets, or a CLOB's whole characters if `characters`; fewer only at its
end, or at a chunk's. `lobReader` gives a readable stream of its octets,
read a chunk a request. A `Lob` held whole is read from the value
itself.

A locator is valid until the transaction that read it ends, and a
statement whose reply sent one keeps its transaction, under autocommit
too. `freeLob` ends it and the value it named; `holdLob` keeps it past
its transaction's commit, until it is freed or a transaction is rolled
back.

`createLob` begins a new large object; its `LobWriter` sends what is
written in appends of at most `CHUNK_OCTETS`, a CLOB's cut where a
character ends, so a character may be split between writes. `finish`
gives its locator and lengths, to pass as a parameter, valid until its
transaction ends and used once.

## ERRORS

| SQLSTATE | SQLCODE | When |
|---|---|---|
| 0F001 | -301 | A locator no longer valid |
| 22000 | -301 | A large object sent whole freed or held, which has no locator |
| 22021 | -301 | A CLOB whose octets are not UTF-8, as `finish` sends them |
| 22001 | -301 | A value longer than its column, as it is inserted |
| 08006 | -919 | A stream given less of the large object than its length; the connection lost |

## EXAMPLES

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

## SEE ALSO

[Large Objects](../user/06-large-objects.md), [Values](23-values.md)
