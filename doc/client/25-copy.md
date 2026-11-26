# Copy, Import and Export

[Contents](README.md)

## NAME

`Connection.copyIn`, `copyRows`, `Copying`, `importInto`, `Delimited`,
`Dialect`, `Connection.export`, `readNative`: rows in bulk, in and out.

## SYNOPSIS

```ts
class Connection {
  copyIn(table: string, columns?: readonly string[]): Promise<Copying>;
  copyRows(table: string, columns: readonly string[],
    rows: Iterable<readonly Value[]> | AsyncIterable<readonly Value[]>): Promise<bigint>;
  export(sql: string, out: { write(bytes: Uint8Array): void | Promise<void> }, format: 'csv' | 'native'): Promise<number>;
}

class Copying {
  send(row: readonly Value[]): Promise<void>;
  sendText(row: readonly (string | null)[]): Promise<void>;
  ping(): Promise<void>;
  finish(): Promise<bigint>;
  abandon(): Promise<void>;
  readonly ended: boolean;
  [Symbol.asyncDispose](): Promise<void>;
}

function importInto(conn: Connection, source: Source, options: ImportOptions): Promise<Imported>;
interface ImportOptions { table: string; batch?: number; skip?: boolean; rejected?: (row: Rejected) => void }
interface Imported { rows: bigint; rejected: bigint }
interface Source { headings(): Promise<readonly Heading[] | undefined>; record(): Promise<SourceRecord | undefined> }
class ImportError extends TurborelError { at?: Position; why: Cause; committed: bigint; rolledBack: bigint }
class SourceError extends TurborelError { at: Position; why: string }

class Delimited implements Source {
  constructor(input: AsyncIterable<Uint8Array> | Iterable<Uint8Array>, dialect: Dialect);
}
class Dialect {
  static csv(): Dialect; static tsv(): Dialect;
  withDelimiter(c: string): Dialect; withHeader(): Dialect; withNull(text: string): Dialect; withMaxRecord(bytes: number): Dialect;
}

function readNative(input: AsyncIterable<Uint8Array> | Iterable<Uint8Array>): Promise<{ columns: readonly Column[]; rows: (readonly Value[])[] }>;
```

## DESCRIPTION

`copyIn` begins a copy into a table's columns, all of them if none, its
own transaction under autocommit, once the server granted `copy`. A
`Copying` sends rows about 256 KiB to a message with no reply;
`finish` gives the rows inserted, or the copy's failure, every row
undone, its detail naming the row; `abandon` undoes them; disposing of
it before it ends abandons it. Until it ends, the connection sends
nothing but its rows, its end and a ping. `copyRows` copies an
iterable's rows, abandoning the copy if they fail to come.

`sendText` sends a row of text, a cell for each column, the text a
field of a file holds, or null, once the server granted `columns`,
which a connection asks for by default. Its rows go by column, in
CopyColumns, about 256 KiB to a message, and keep their order among
those `send` sends in the same copy. The server takes each cell as the
character string of its text, cast to its column's type and assigned
as INSERT assigns it, so a null and an empty string stay apart and a
cell too long fails at `finish`, its row named, rather than being cut.

`importInto` inserts a source's records into a table through one
prepared INSERT, its columns the source's headings or else the table's,
a batch committed at a time, 1000 by default, 0 for all at once; or by
copy, where the server grants it, no row is to be skipped and no column
is a large object's: by column, each field its text as the source read
it, where the server grants `columns`; by row otherwise. The session must have no transaction active. A
string for a character string column is assigned as INSERT assigns it;
a field longer than 64 KiB for a CLOB or BLOB column goes as a large
object it creates. `Delimited` reads CSV (RFC 4180) or tab-separated
text a record at a time, each at most 16 MiB unless `withMaxRecord`
says.

`export` runs a query and writes its rows to `out` as they come: CSV, a
header then a record for each row, each ended by CR LF; or native rows,
a Description, Rows and a Complete, which `readNative` reads back.

## ERRORS

| SQLSTATE | SQLCODE | When |
|---|---|---|
| 08006 | -919 | `sendText` on a connection not granted `columns`, refused before it is sent, the connection kept |
| TB910 | -910 | Another request while a copy is under way; a delimiter that is not one ASCII character, nor a quote or a line break |
| 22000 | -301 | A source that cannot be read, or a record of too many or too few fields: a `SourceError`, or an `ImportError` of the input's |
| 22001 | -301 | A string too long for its column, which an import refuses, not cuts |
| 08006 | -919 | `copy` not granted; native rows that are not, or cut short; an export of a statement that is no query |

An `ImportError` of an SQL condition carries its SQLCODE, SQLSTATE and
diagnostics, and the failure itself as its `cause`.

## EXAMPLES

```js
import { Trust, connectTo, tcp } from 'turborel';

const conn = await connectTo(tcp('127.0.0.1', 7422), 'ann', new Trust());
await conn.query('CREATE TABLE T (ID INTEGER PRIMARY KEY, NAME VARCHAR(10))');
const copy = await conn.copyIn('T', ['ID', 'NAME']);
for (let i = 1; i <= 1000; i += 1) await copy.send([BigInt(i), `name ${i}`]);
console.log(await copy.finish());
try {
  await conn.copyRows('T', [], [[1001n, 'new'], [1n, 'again']]);
} catch (e) {
  console.log(e.sqlstate, e.diagnostics.detail);
}
await conn.query('COMMIT');
await conn.terminate();
// 1000n
// 23000 row 2 of the copy
```

## SEE ALSO

[Copying, Importing and Exporting](../user/07-copying.md),
[Large Objects](24-large-objects.md)
