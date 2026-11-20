/**
 * Tests of an import against a scripted server on loopback that keeps a
 * table of two columns: by INSERT and by copy, its batches, its skipped
 * rows and its failures (RULES.md R-TEST-1).
 */

import assert from 'node:assert/strict';
import { after, test } from 'node:test';

import { Trust } from '../../src/auth/mechanism.js';
import { type Column, writeColumn } from '../../src/codec/composite.js';
import { REQUEST } from '../../src/codec/kinds.js';
import { Reader } from '../../src/codec/reader.js';
import type { DataType } from '../../src/codec/types.js';
import { writeType } from '../../src/codec/types.js';
import { readValues } from '../../src/codec/value-codec.js';
import { Lob, type Value } from '../../src/codec/values.js';
import { TurborelError } from '../../src/error.js';
import { Delimited, Dialect } from '../../src/import/delimited.js';
import { ImportError, type Rejected, assignString } from '../../src/import/import.js';
import { importInto } from '../../src/import/run.js';
import { type Heading, type Source, SourceError, type SourceRecord } from '../../src/import/source.js';
import { COPY } from '../../src/session/capabilities.js';
import { connectTo } from '../../src/session/connect.js';
import type { Connection } from '../../src/session/connection.js';
import { type Peer, type Scripted, scripted } from '../support/fake-server.js';
import { isFailure } from '../support/failures.js';

const servers: Scripted[] = [];

after(async () => {
  await Promise.all(servers.map((s) => s.close()));
});

/** VARCHAR(4). */
const VARCHAR: DataType = { kind: 'varying', length: 4, units: 'characters' };

/** The table's columns. */
const COLUMNS: Column[] = [
  { name: 'ID', type: VARCHAR, notNull: true },
  { name: 'NAME', type: VARCHAR, notNull: false },
];

/** What the scripted server saw. */
interface Seen {
  readonly sql: string[];
  readonly rows: Value[][];
  readonly commits: number;
}

/**
 * Answers a copy's requests.
 *
 * @param peer - the peer
 * @param kind - the request's kind
 * @param r - its body
 * @param state - the rows copied, what the server saw, and how it refuses
 * @returns whether it was a copy's
 */
function copying(
  peer: Peer,
  kind: number,
  r: Reader,
  state: { copied: Value[][]; seen: { rows: Value[][]; commits: number }; refuse: (detail?: string) => void },
): boolean {
  const { copied, seen, refuse } = state;
  if (kind === REQUEST.COPY_IN) return true;
  if (kind === REQUEST.COPY_DATA) {
    for (const row of r.list((x) => readValues(x))) copied.push(row);
    return true;
  }
  if (kind !== REQUEST.COPY_END) return false;
  const abandon = r.flag();
  const bad = copied.findIndex((row) => row[0] === 'bad');
  if (abandon) peer.complete();
  else if (bad >= 0) refuse(`row ${String(bad + 1)} of the copy`);
  else {
    seen.rows.push(...copied);
    seen.commits += 1;
    peer.reply('K', (w) => w.i32(0).string('00000').flag(false).u8(6).u64(BigInt(copied.length)));
  }
  return true;
}

/**
 * Answers a peer as a server of one table would: a key of 'bad' refused (23000), the copy's failure naming its row.
 *
 * @param peer - the peer
 * @param seen - what it saw
 */
async function table(peer: Peer, seen: { sql: string[]; rows: Value[][]; commits: number }): Promise<void> {
  let active = false;
  let copied: Value[][] = [];
  const refuse = (detail?: string): void => {
    peer.error(
      new TurborelError(-201, '23000', 'a duplicate key', {
        active,
        ...(detail === undefined ? {} : { diagnostics: { detail } }),
      }),
    );
  };
  for (;;) {
    const frame = await peer.frame();
    const r = new Reader(frame.body, 'request');
    if (frame.kind === REQUEST.PREPARE) {
      const [statement, sql] = [r.u32(), r.string()];
      seen.sql.push(sql);
      const insert = sql.startsWith('INSERT');
      peer.reply('P', (w) => {
        w.u32(statement).u32(insert ? 2 : 0);
        if (insert) for (const c of COLUMNS) writeType(w.flag(false), c.type);
        w.u32(insert ? 0 : 2);
        if (!insert) for (const c of COLUMNS) writeColumn(w, c);
      });
    } else if (frame.kind === REQUEST.EXECUTE) {
      r.u32();
      const values = readValues(r);
      if (values[0] === 'bad') refuse();
      else {
        [active] = [true];
        seen.rows.push(values);
        peer.complete({ active });
      }
    } else if (frame.kind === REQUEST.QUERY) {
      const sql = r.string();
      if (sql === 'COMMIT') seen.commits += 1;
      active = false;
      peer.complete();
    } else if (!copying(peer, frame.kind, r, { copied, seen, refuse })) peer.complete();
    if (frame.kind === REQUEST.COPY_IN) copied = [];
  }
}

/**
 * A connection to a server of one table, and what it saw.
 *
 * @param granted - the capabilities it grants
 * @returns the connection, and what the server saw
 */
async function server(granted: readonly string[]): Promise<[Connection, Seen]> {
  const seen = { sql: [] as string[], rows: [] as Value[][], commits: 0 };
  const s = await scripted(async (peer) => {
    await peer.frame();
    peer.ready(granted);
    await table(peer, seen);
  });
  servers.push(s);
  return [await connectTo(s.target, 'ann', new Trust()), seen];
}

/**
 * CSV as a source.
 *
 * @param text - the text
 * @param header - whether it has a header
 * @returns the source
 */
function csv(text: string, header = true): Delimited {
  return new Delimited([Buffer.from(text)], header ? Dialect.csv().withHeader() : Dialect.csv());
}

/** Verifies: [CLIENT Importing] by the INSERT, its columns the headings', a batch committed at a time, a failing row skipped and given to the program. */
test('an import by insert', async () => {
  const [conn, seen] = await server([]);
  const rejected: Rejected[] = [];
  const done = await importInto(conn, csv('id,"""Name"""\n1,a\nbad,b\n2,c\n3,d,e\n4,\n'), {
    table: 'ann.t',
    batch: 2,
    skip: true,
    rejected: (r) => rejected.push(r),
  });
  assert.deepEqual(done, { rows: 3n, rejected: 2n });
  assert.equal(seen.sql[0], 'INSERT INTO "ANN"."T" ("ID", "Name") VALUES (?, ?)');
  assert.deepEqual(seen.rows, [
    ['1', 'a'],
    ['2', 'c'],
    ['4', null],
  ]);
  assert.equal(seen.commits, 2, 'a batch of two, then the rest');
  assert.deepEqual(
    rejected.map((r) => [r.position.line, r.cause.kind]),
    [
      [3, 'sql'],
      [5, 'input'],
    ],
  );
  conn.destroy();
});

/** Verifies: [CLIENT Importing] an import stops at a failing row, its batch rolled back, saying where, why, and the rows committed and rolled back; with no headings, the table's columns. */
test('an import stops', async () => {
  const [conn, seen] = await server([]);
  const stopped = await importInto(conn, csv('1,a\n2,b\n3,c\nbad,d\n', false), { table: 'T', batch: 2 }).catch(
    (e: unknown) => e,
  );
  assert.ok(stopped instanceof ImportError);
  assert.deepEqual([stopped.at, stopped.committed, stopped.rolledBack], [{ record: 4, line: 4 }, 2n, 1n]);
  assert.deepEqual([stopped.sqlcode, stopped.sqlstate, stopped.why.kind], [-201, '23000', 'sql']);
  assert.equal(stopped.message, 'record 4, line 4: a duplicate key; 2 rows committed, 1 rolled back');
  assert.equal(seen.sql[0], 'SELECT * FROM "T"', 'the columns described');
  const short = await importInto(conn, csv('1\n', false), { table: 'T' }).catch((e: unknown) => e);
  assert.ok(short instanceof ImportError);
  assert.deepEqual([short.why.kind, short.sqlstate], ['input', '22000']);
  assert.equal(short.message, 'record 1, line 1: 1 fields, for 2 columns; 0 rows committed, 0 rolled back');
  conn.destroy();
});

/** A source that fails at its second record, or gives a heading. */
class Failing implements Source {
  #records = 0;

  /** @returns no headings */
  headings(): Promise<readonly Heading[] | undefined> {
    return Promise.resolve(undefined);
  }

  /** @returns a record, then a failure */
  record(): Promise<SourceRecord | undefined> {
    this.#records += 1;
    if (this.#records === 1) return Promise.resolve({ values: ['1', 'a'], position: { record: 1 } });
    return Promise.reject(new SourceError({ record: 2 }, 'the disk is gone'));
  }
}

/** Verifies: [CLIENT Importing] by copy where granted, a batch to each copy; a row refused names its record, the batch undone; a source's failure stops it too. */
test('an import by copy', async () => {
  const [conn, seen] = await server([COPY]);
  assert.deepEqual(await importInto(conn, csv('ID,NAME\n1,a\n2,b\n3,c\n'), { table: 'T', batch: 2 }), {
    rows: 3n,
    rejected: 0n,
  });
  assert.deepEqual(seen.rows.length, 3);
  assert.equal(seen.commits, 2);
  const stopped = await importInto(conn, csv('ID,NAME\n4,d\n5,e\n6,f\nbad,g\n'), { table: 'T', batch: 2 }).catch(
    (e: unknown) => e,
  );
  assert.ok(stopped instanceof ImportError);
  assert.deepEqual([stopped.at, stopped.committed, stopped.rolledBack], [{ record: 4, line: 5 }, 2n, 1n]);
  const failing = await importInto(conn, new Failing(), { table: 'T' }).catch((e: unknown) => e);
  assert.ok(failing instanceof ImportError);
  assert.deepEqual([failing.at, failing.why], [{ record: 2 }, { kind: 'input', message: 'the disk is gone' }]);
  const wrong = await importInto(conn, csv('ID,NAME\n7\n'), { table: 'T' }).catch((e: unknown) => e);
  assert.ok(wrong instanceof ImportError && wrong.why.kind === 'input');
  conn.destroy();
});

/** Verifies: [CLIENT Importing] a string assigned to a character column as INSERT assigns it: CHARACTER padded, a longer one refused unless what is beyond is spaces, counted in characters or octets. */
test('strings assigned to their columns', () => {
  assert.equal(assignString('ab', { kind: 'character', length: 4, units: 'characters' }), 'ab  ');
  assert.equal(assignString('ab  ', { kind: 'varying', length: 2, units: 'characters' }), 'ab');
  assert.equal(assignString('éé', { kind: 'varying', length: 2, units: 'characters' }), 'éé');
  assert.throws(() => assignString('éé', { kind: 'varying', length: 3, units: 'octets' }), isFailure(-301, '22001'));
  assert.equal(assignString('é  ', { kind: 'character', length: 3, units: 'octets' }), 'é ');
  const clob = assignString('x', { kind: 'clob', length: 10n, units: 'characters' });
  assert.ok(clob instanceof Lob && clob.data === 'x');
  assert.equal(assignString('7', { kind: 'exact', precision: 5, scale: 0 }), '7', 'cast by the server');
});
