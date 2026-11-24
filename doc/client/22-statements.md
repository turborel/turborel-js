# Statements and Cursors

[Contents](README.md)

## NAME

`Connection.query`, `queryInto`, `queryMany`, `prepare`, `execute`,
`openCursor`, `fetch`, `close`, `describe`, `deallocate`, `Statement`:
running statements, and what the server tells of each.

## SYNOPSIS

```ts
type Outcome =
  | { kind: 'rows'; columns: readonly Column[]; rows: readonly (readonly Value[])[] }
  | { kind: 'done'; completion: Completion };
type Streamed = { kind: 'rows'; count: number } | { kind: 'done'; completion: Completion };
interface Sink {
  columns(columns: readonly Column[]): void | Promise<void>;
  rows(rows: readonly (readonly Value[])[]): void | Promise<void>;
}
interface Batch { rows: readonly (readonly Value[])[]; more: boolean }
interface CursorOptions { rows?: number; cursor?: number }
interface Ran { outcomes: readonly Outcome[]; failure?: TurborelError }

interface Column {
  name?: string; type: DataType; notNull: boolean;
  declared?: { name: string; written: string };
}
function columnType(column: Column): string;
function columnTypeName(column: Column): string;
function typeWritten(type: DataType): string;

interface DynamicParameter extends Parameter {
  mode: 'in' | 'inout' | 'out';
  ordinal?: number;
}

class Statement {
  readonly number: number;
  readonly parameters: readonly Parameter[];
  readonly columns: readonly Column[];
  readonly dynamicParameters: readonly DynamicParameter[];
  readonly procedure: { schema: string; name: string } | undefined;
}

class Connection {
  query(sql: string): Promise<Outcome>;
  queryInto(sql: string, sink: Sink): Promise<Streamed>;
  queryMany(sql: string): Promise<Ran>;
  prepare(sql: string): Promise<Statement>;
  execute(statement: Statement, values?: readonly Value[]): Promise<Outcome>;
  openCursor(statement: Statement, values?: readonly Value[], options?: CursorOptions): Promise<Batch>;
  fetch(statement: Statement, options?: CursorOptions): Promise<Batch>;
  close(statement: Statement, cursor?: number): Promise<void>;
  describe(statement: Statement): Promise<Statement>;
  describeCursor(statement: Statement, cursor?: number): Promise<readonly Column[]>;
  deallocate(statement: Statement): Promise<void>;
  readonly autocommit: boolean; setAutocommit(on: boolean): void;
  setQueryAttributes(attributes: readonly (readonly [string, string])[]): void;
  readonly inTransaction: boolean; readonly warning: string | undefined;
  readonly rowsAffected: bigint | undefined; readonly lastGenerated: readonly string[];
  readonly serverTime: { total: bigint; queued: bigint; locks: bigint } | undefined;
  readonly commitPosition: bigint | undefined;
  readonly conditions: readonly TurborelError[]; takeConditions(): TurborelError[];
}
```

## DESCRIPTION

A connection runs one statement at a time. `query` runs a statement and
gives a query's columns and all its rows, or another statement's
completion. `queryInto` gives a query's columns and rows to a sink a
batch at a time, awaiting what it returns, and gives the count of rows.
`queryMany` runs several statements in one request, once the server
granted `multi-statement`: each outcome in order, and the failure that
stopped the rest. Under autocommit each statement is its own
transaction.

`prepare` numbers a statement itself and prepares it: its parameters'
types, its inputs', and a query's columns, or a CALL's, one for each
OUT or INOUT parameter. `execute` runs it with a value for each
parameter: a query's rows, all of them; a CALL's output parameters'
values, as one row of its columns; or a completion. `openCursor`
opens a cursor of a query and takes its first `rows` rows, all if 0;
`fetch` takes the next; the cursor closes once its last row is read, or
by `close`. Under autocommit, the server granting `fetch-ends`, the
cursor's transaction ends as the cursor does. A cursor numbered other
than 0 needs `cursors`; `describe` and `describeCursor` need `describe`.
`deallocate` lets a statement go.

A statement's `parameters` are the ones `execute` takes values for, of a
CALL not those of OUT parameters. `dynamicParameters` gives every `?` in
the order written, OUT ones too: its type and, of a CALL, the mode, IN,
INOUT or OUT, and the ordinal position of the procedure's parameter
whose argument holds it, several `?` of one IN argument each the same;
`procedure` gives the procedure's specific name. The server tells them
to a connection granted `parameter-modes`, which a connection asks for
by default. A `?` of another statement, or of any statement on a
connection not granted it, is `in`, of no position.

A `Column`, of a statement's `columns` or of a query's outcome, has its
name, its `type` and whether it is NOT NULL. A type's tag can stand for
several declared types, so an INTEGER column's `type` is an exact
numeric type of precision 10 and scale 0. Granted `declared-types`,
which a connection asks for by default, its `declared` holds the type
it was declared with: its `name` as the Information Schema's DATA_TYPE
gives it, and the type as SQL `written`. `columnType` gives the declared
type where the server told it, else the type its tag says, as
`typeWritten` writes it, so INTEGER is `NUMERIC(10,0)`; `columnTypeName`
gives its name the same way.

Each statement's completion leaves `rowsAffected`, `lastGenerated`,
`serverTime`, `commitPosition`, `warning` and `conditions`, as far as
the server granted `row-counts`, `generated-values`, `commit-position`
and `conditions`. `setQueryAttributes` sets attributes each later Query
and Execute carries, once the server granted `query-attributes`. A
parameter's value cut to its type, as a string longer than its
column's, completes with the warning 01004, which `warning` gives.

## ERRORS

| SQLSTATE | SQLCODE | When |
|---|---|---|
| 07001 | -921 | Values not one for each parameter |
| 24000 | -501 | A cursor opened again, fetched or closed when not open; a statement deallocated while its cursor is open |
| 26000 | -921 | A statement deallocated, or never prepared |
| 08006 | -919 | A request of a capability not granted, refused before it is sent; a reply out of turn, which loses the connection |
| 2200W | -301 | An XML value with no serialization, as the fetch that sends it fails |
| TB916 | -916 | A reply holding a value the driver cannot take: the statement fails, the rest of its replies read past first, and the connection goes on ([Values](23-values.md)) |

The statement's own failures are the server's, as it reports them.

## EXAMPLES

```js
import { Trust, connectTo, tcp } from 'turborel';

const conn = await connectTo(tcp('127.0.0.1', 7422), 'ann', new Trust());
await conn.query('CREATE TABLE STAFF (ID INTEGER PRIMARY KEY, NAME VARCHAR(20))');
await conn.query("INSERT INTO STAFF VALUES (1, 'Ada'), (2, 'Grace')");
await conn.query('COMMIT');
const all = await conn.prepare('SELECT ID, NAME FROM STAFF ORDER BY ID');
let batch = await conn.openCursor(all, [], { rows: 1 });
console.log(batch);
while (batch.more) {
  batch = await conn.fetch(all, { rows: 1 });
  console.log(batch);
}
await conn.query('COMMIT');
await conn.terminate();
// { rows: [ [ 1n, 'Ada' ] ], more: true }
// { rows: [ [ 2n, 'Grace' ] ], more: false }
```

A column's declared type, beside the type its tag says:

```js
import { Trust, columnType, connectTo, tcp, typeWritten } from 'turborel';

const conn = await connectTo(tcp('127.0.0.1', 7422), 'ann', new Trust());
const typed = await conn.prepare('VALUES (CAST(1 AS INTEGER), CAST(2.5 AS DECIMAL(9,2)))');
for (const c of typed.columns) console.log(columnType(c), typeWritten(c.type), c.declared?.name);
await conn.terminate();
// INTEGER NUMERIC(10,0) INTEGER
// DECIMAL(9,2) NUMERIC(9,2) DECIMAL
```

## SEE ALSO

[Running Queries](../user/03-queries.md),
[Prepared Statements](../user/04-prepared-statements.md),
[Transactions](../user/05-transactions.md), [Values](23-values.md)
