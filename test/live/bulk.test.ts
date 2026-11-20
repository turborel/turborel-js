/**
 * Live tests of large objects, copies, imports and exports, against the
 * server TURBOREL_TEST_SERVER names (RULES.md R-TEST-8).
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Lob, LobLocator, type Value } from '../../src/codec/values.js';
import { MAX_BODY } from '../../src/codec/frame.js';
import { decodeReply } from '../../src/codec/replies.js';
import { type Request, encodeRequest } from '../../src/codec/requests.js';
import * as cap from '../../src/session/capabilities.js';
import type { Connection } from '../../src/session/connection.js';
import { readNative } from '../../src/session/export.js';
import type { Outcome } from '../../src/session/statements.js';
import { Offer } from '../../src/session/told.js';
import { Delimited, Dialect } from '../../src/import/delimited.js';
import { ImportError, type Rejected } from '../../src/import/import.js';
import { importInto } from '../../src/import/run.js';
import { FrameStream } from '../../src/transport/frames.js';
import { open, tcp } from '../../src/transport/target.js';
import { PORT } from '../server/server.js';
import { isConnectionFailure, isFailure } from '../support/failures.js';
import { ann, live, liveServer } from '../support/live.js';

liveServer();

/**
 * The rows of an outcome, or a failure if it has none.
 *
 * @param outcome - the outcome
 * @returns its rows
 */
function rowsOf(outcome: Outcome): readonly (readonly Value[])[] {
  if (outcome.kind !== 'rows') throw new Error(`no rows: ${outcome.completion.sqlstate}`);
  return outcome.rows;
}

/**
 * The only value of a query's only row.
 *
 * @param conn - the connection
 * @param sql - the query
 * @returns the value
 */
async function single(conn: Connection, sql: string): Promise<Value> {
  return rowsOf(await conn.query(sql))[0]?.[0] ?? null;
}

/**
 * CSV text as an import's source.
 *
 * @param text - the text
 * @param dialect - how it is written; CSV with a header by default
 * @returns the source
 */
function csv(text: string, dialect = Dialect.csv().withHeader()): Delimited {
  return new Delimited([Buffer.from(text)], dialect);
}

/** Verifies: [CLIENT Large objects] a large object of at most 64 KiB comes whole, a longer one as its locator and lengths, read by ranges of octets or characters, or as a stream. */
test('large objects read', async (t) => {
  if (live(t) === undefined) return;
  const conn = await ann();
  await conn.query('CREATE TABLE DOCS (ID INTEGER, C CLOB(1M), B BLOB(1M))');
  const insert = await conn.prepare('INSERT INTO DOCS VALUES (?, ?, ?)');
  await conn.execute(insert, [1n, 'é'.repeat(40_000), new Uint8Array(70_000).fill(7)]);
  await conn.execute(insert, [2n, 'small', Uint8Array.of(1, 2)]);
  await conn.query('COMMIT');
  const [[clob, blob] = [], [small, smallBlob] = []] = rowsOf(await conn.query('SELECT C, B FROM DOCS ORDER BY ID'));
  assert.ok(clob instanceof LobLocator && blob instanceof LobLocator);
  assert.deepEqual([clob.characters, clob.octets, blob.octets], [40_000n, 80_000n, 70_000n]);
  assert.ok(small instanceof Lob && smallBlob instanceof Lob);
  assert.deepEqual([small.data, smallBlob.data], ['small', Uint8Array.of(1, 2)]);
  assert.equal(Buffer.from(await conn.readLob(clob, 1n, 3n, true)).toString(), 'ééé');
  assert.equal((await conn.readLob(clob, 0n, 5n)).byteLength, 5);
  assert.equal((await conn.readLob(blob, 0n, 1_000_000n)).byteLength, 70_000, 'at most a chunk');
  let streamed = 0;
  for await (const chunk of conn.lobReader(blob)) streamed += (chunk as Uint8Array).byteLength;
  assert.equal(streamed, 70_000);
  await conn.query('COMMIT');
  await conn.terminate();
});

/** Verifies: [CLIENT Large objects] a locator is valid until its transaction ends, which it keeps under autocommit too; freed, it is no longer; held, it outlives the commit, until a rollback. */
test('locators: kept, freed and held', async (t) => {
  if (live(t) === undefined) return;
  const conn = await ann();
  await conn.query('CREATE TABLE HELD (ID INTEGER, B BLOB(1M))');
  const insert = await conn.prepare('INSERT INTO HELD VALUES (?, ?)');
  await conn.execute(insert, [1n, new Uint8Array(70_000).fill(1)]);
  await conn.execute(insert, [2n, new Uint8Array(70_000).fill(2)]);
  await conn.query('COMMIT');
  conn.setAutocommit(true);
  const [[first] = [], [second] = []] = rowsOf(await conn.query('SELECT B FROM HELD ORDER BY ID'));
  assert.ok(first instanceof LobLocator && second instanceof LobLocator);
  assert.equal(conn.inTransaction, true, 'kept open by its locators');
  await conn.freeLob(first);
  await assert.rejects(conn.readLob(first, 0n, 1n), isFailure(-301, '0F001'));
  await conn.holdLob(second);
  await conn.query('COMMIT');
  assert.equal((await conn.readLob(second, 0n, 1n))[0], 2, 'held past the commit');
  conn.setAutocommit(false);
  await conn.query('VALUES 1');
  await conn.query('ROLLBACK');
  await assert.rejects(conn.readLob(second, 0n, 1n), isFailure(-301, '0F001'), 'a rollback ends it');
  await conn.terminate();
});

/** Verifies: [CLIENT Large objects] a value written a piece at a time, a character split between writes, passed as a parameter by its locator. */
test('large objects written', async (t) => {
  if (live(t) === undefined) return;
  const conn = await ann();
  await conn.query('CREATE TABLE MADE (C CLOB(1M), B BLOB(1M))');
  const text = await conn.createLob('character');
  await text.write('é'.repeat(40_000));
  const euro = Buffer.from('€');
  await text.write(euro.subarray(0, 1));
  await text.write(euro.subarray(1));
  const clob = await text.finish();
  const octets = await conn.createLob('binary');
  for (let i = 0; i < 4; i += 1) await octets.write(new Uint8Array(100_000).fill(i));
  const blob = await octets.finish();
  assert.deepEqual([clob.characters, clob.octets, blob.octets], [40_001n, 80_003n, 400_000n]);
  const insert = await conn.prepare('INSERT INTO MADE VALUES (?, ?)');
  await conn.execute(insert, [clob, blob]);
  const lengths = rowsOf(await conn.query('SELECT CHAR_LENGTH(C), OCTET_LENGTH(B) FROM MADE'));
  assert.deepEqual(lengths, [[40_001n, 400_000n]]);
  await conn.query('ROLLBACK');
  await conn.terminate();
});

/** Verifies: [PROTOCOL Lob 'L'] the request: a CLOB's octets are checked as UTF-8 as each Append comes: one not UTF-8 refused with 22021 by its Append, every later Append and its use refused; one ending within a character refused, 22021, where it is used. */
test('a CLOB not UTF-8 is refused as it is appended', async (t) => {
  if (live(t) === undefined) return;
  const conn = await ann();
  await conn.query('CREATE TABLE CHECKED (C CLOB(1M))');
  const bad = await conn.createLob('character');
  await bad.write(Uint8Array.of(0x61, 0xff));
  await assert.rejects(bad.finish(), isFailure(-301, '22021'), 'its Append');
  await bad.write('b');
  await assert.rejects(bad.finish(), isFailure(-301, '22021'), 'every later Append');
  const after = await conn.createLob('character');
  await after.write('a');
  const located = await after.finish();
  const insert = await conn.prepare('INSERT INTO CHECKED VALUES (?)');
  await conn.execute(insert, [located]);
  const half = await conn.createLob('character');
  await half.write(Uint8Array.of(0x61, 0xc3));
  const cut = await half.finish();
  await assert.rejects(conn.execute(insert, [cut]), isFailure(-301, '22021'), 'where it is used');
  await conn.query('ROLLBACK');
  await conn.terminate();
});

/** Verifies: [PROTOCOL Conversations] [CLIENT Copying and exporting] rows copied into the columns named or all, many to a message, the rows inserted counted whatever was granted; ping as it goes. */
test('a copy', async (t) => {
  if (live(t) === undefined) return;
  const conn = await ann(new Offer([cap.COPY, cap.PING, cap.NOTICES]));
  await conn.query('CREATE TABLE T (ID INTEGER PRIMARY KEY, NAME VARCHAR(5))');
  await conn.query('COMMIT');
  const copy = await conn.copyIn('T', ['ID', 'NAME']);
  for (let i = 1; i <= 3000; i += 1) await copy.send([BigInt(i), `n${String(i % 100)}`]);
  await copy.ping();
  assert.equal(await copy.finish(), 3000n, 'counted without row-counts');
  assert.equal(conn.inTransaction, true, 'within the transaction');
  await conn.query('COMMIT');
  /** @returns rows, as an async iterator gives them */
  async function* more(): AsyncGenerator<readonly Value[]> {
    for (let i = 3001; i <= 3010; i += 1) {
      await Promise.resolve();
      yield [BigInt(i), 'x'];
    }
  }
  assert.equal(await conn.copyRows('T', [], more()), 10n, 'all columns');
  await conn.query('COMMIT');
  assert.equal(await single(conn, 'SELECT COUNT(*) FROM T'), 3010n);
  await conn.terminate();
});

/** Verifies: [PROTOCOL Conversations] [PROTOCOL CopyEnd 'N'] all or nothing: a row refused undoes every row, the failure's detail naming it; abandoned, none is kept; under autocommit the copy commits; else a failing copy leaves the transaction's statements before it. */
test('a copy all or nothing', async (t) => {
  if (live(t) === undefined) return;
  const conn = await ann();
  await conn.query('CREATE TABLE U (ID INTEGER PRIMARY KEY, NAME VARCHAR(5))');
  await conn.query("INSERT INTO U VALUES (1, 'one')");
  const failing = await conn.copyIn('U');
  await failing.send([2n, 'two']);
  await failing.send([1n, 'dup']);
  await assert.rejects(failing.finish(), (e: unknown) => {
    assert.ok(isFailure(-201, '23000')(e));
    return (e as { diagnostics?: { detail?: string } }).diagnostics?.detail === 'row 2 of the copy';
  });
  assert.equal(conn.inTransaction, true);
  assert.deepEqual(
    rowsOf(await conn.query('SELECT ID FROM U')),
    [[1n]],
    'the INSERT before it kept, no row of the copy',
  );
  const abandoned = await conn.copyIn('U');
  await abandoned.send([3n, 'three']);
  await abandoned.abandon();
  assert.equal(await single(conn, 'SELECT COUNT(*) FROM U'), 1n);
  await conn.query('COMMIT');
  conn.setAutocommit(true);
  assert.equal(await conn.copyRows('U', [], [[4n, 'four']]), 1n);
  assert.equal(conn.inTransaction, false, 'committed as it succeeded');
  await assert.rejects(conn.copyRows('U', [], [[5n, 'toolong']]), isFailure(-301, '22001'));
  assert.equal(conn.inTransaction, false, 'rolled back as it failed');
  await assert.rejects(conn.copyRows('NOPE', [], [[1n]]), isFailure(-103, '37000'));
  await conn.terminate();
  const ungranted = await ann(Offer.none());
  await assert.rejects(ungranted.copyIn('U'), isConnectionFailure, '`copy` not granted');
  await ungranted.terminate();
});

/** Verifies: [PROTOCOL Reset 'W'] a Reset ends a copy under way, its rows undone. */
test('a reset ends a copy', async (t) => {
  if (live(t) === undefined) return;
  const setup = await ann();
  await setup.query('CREATE TABLE R (ID INTEGER)');
  await setup.query('COMMIT');
  await setup.terminate();
  const { socket } = await open(tcp('127.0.0.1', PORT), 5000);
  const frames = new FrameStream(socket);
  const send = (request: Request): Promise<void> => frames.write(encodeRequest(request), 5000);
  const until = async (kind: string): Promise<string[]> => {
    const seen: string[] = [];
    for (;;) {
      const frame = await frames.next(MAX_BODY, 5000);
      const reply = decodeReply(frame.kind, frame.body);
      seen.push(reply.kind === 'notice' ? `notice ${reply.sqlstate}` : reply.kind);
      if (reply.kind === kind || reply.kind === 'error') return seen;
    }
  };
  const hello = { kind: 'hello', version: 1, user: 'ann', mechanism: 'trust', initial: new Uint8Array(0) } as const;
  await send({ ...hello, capabilities: Offer.default().capabilities, attributes: [] });
  await until('ready');
  await send({ kind: 'copyIn', table: 'R', columns: [], ends: false });
  await send({ kind: 'copyData', rows: [[1n], [2n]] });
  await send({ kind: 'reset' });
  const seen = await until('complete');
  assert.equal(seen.at(-1), 'complete');
  await send({ kind: 'query', sql: 'SELECT COUNT(*) FROM R', ends: true, attributes: [], multi: false });
  const counted = await until('complete');
  assert.ok(counted.includes('rows'), 'the session takes statements again');
  frames.destroy();
  const check = await ann();
  assert.equal(await single(check, 'SELECT COUNT(*) FROM R'), 0n);
  await check.terminate();
});

/** Verifies: [CLIENT Copying and exporting] an export as CSV, a header then a record for each row; as native rows, read back with every value as it was. */
test('exports', async (t) => {
  if (live(t) === undefined) return;
  const conn = await ann();
  await conn.query('CREATE TABLE E (ID INTEGER, NAME VARCHAR(20), D DATE, X DOUBLE PRECISION)');
  await conn.query(
    "INSERT INTO E VALUES (1, 'plain', DATE '2026-11-19', 1.5), (2, 'a,\"b\"', NULL, NULL), (3, '', NULL, 100)",
  );
  const parts: Uint8Array[] = [];
  const out = { write: (bytes: Uint8Array): void => void parts.push(bytes) };
  assert.equal(await conn.export('SELECT * FROM E ORDER BY ID', out, 'csv'), 3);
  assert.equal(
    Buffer.concat(parts).toString(),
    'ID,NAME,D,X\r\n1,plain,2026-11-19,1.5E0\r\n2,"a,""b""",,\r\n3,"",,1E2\r\n',
  );
  const text = rowsOf(await conn.query('SELECT CAST(D AS VARCHAR(20)) FROM E WHERE ID = 1'));
  assert.deepEqual(text, [['2026-11-19']], "the server's own text of the date");
  parts.length = 0;
  assert.equal(await conn.export('SELECT * FROM E ORDER BY ID', out, 'native'), 3);
  const native = await readNative(parts);
  assert.deepEqual(native.rows, rowsOf(await conn.query('SELECT * FROM E ORDER BY ID')));
  await assert.rejects(conn.export('DELETE FROM E WHERE ID = 9', out, 'csv'), isConnectionFailure);
  await conn.query('ROLLBACK');
  await conn.terminate();
});

/** Verifies: [CLIENT Importing] CSV imported into a table by copy where granted: its header naming the columns, a batch committed at a time; a row refused stops it, saying where and what was kept. */
test('an import by copy', async (t) => {
  if (live(t) === undefined) return;
  const conn = await ann();
  await conn.query('CREATE TABLE STAFF (ID INTEGER PRIMARY KEY, NAME VARCHAR(10), NOTE VARCHAR(10))');
  await conn.query('COMMIT');
  const rows = Array.from({ length: 5 }, (_, i) => `${String(i + 1)},n${String(i + 1)},`).join('\n');
  assert.deepEqual(await importInto(conn, csv(`id,name,note\n${rows}\n`), { table: 'staff', batch: 2 }), {
    rows: 5n,
    rejected: 0n,
  });
  assert.equal(await single(conn, 'SELECT COUNT(*) FROM STAFF WHERE NOTE IS NULL'), 5n);
  await conn.query('COMMIT');
  const failing = csv('id,name\n6,a\n7,b\n8,c\n1,dup\n9,d\n');
  const stopped = await importInto(conn, failing, { table: 'staff', batch: 2 }).catch((e: unknown) => e);
  assert.ok(stopped instanceof ImportError);
  assert.deepEqual([stopped.at, stopped.committed, stopped.rolledBack], [{ record: 4, line: 5 }, 2n, 1n]);
  assert.deepEqual([stopped.sqlcode, stopped.sqlstate], [-201, '23000']);
  assert.match(stopped.message, /^record 4, line 5: PRIMARY KEY/u);
  assert.equal(await single(conn, 'SELECT COUNT(*) FROM STAFF'), 7n, 'the first batch kept');
  await conn.terminate();
});

/** Verifies: [CLIENT Importing] by the INSERT where rows are skipped: a failing row skipped and given to the program; a record of too many fields; a string too long refused, not cut; the input's failure; a transaction active refused. */
test('an import by insert', async (t) => {
  if (live(t) === undefined) return;
  const conn = await ann();
  await conn.query('CREATE TABLE PEOPLE (ID INTEGER PRIMARY KEY, NAME CHARACTER(4))');
  await conn.query('COMMIT');
  const rejected: Rejected[] = [];
  const text = 'ID,NAME\n1,ab\n2,toolong\n3,c,x\n1,dup\n4,"d  "\n';
  const done = await importInto(conn, csv(text), { table: 'PEOPLE', skip: true, rejected: (r) => rejected.push(r) });
  assert.deepEqual(done, { rows: 2n, rejected: 3n });
  assert.deepEqual(
    rejected.map((r) => [r.position.record, r.cause.kind]),
    [
      [2, 'sql'],
      [3, 'input'],
      [4, 'sql'],
    ],
  );
  assert.deepEqual(rowsOf(await conn.query('SELECT NAME FROM PEOPLE ORDER BY ID')), [['ab  '], ['d   ']]);
  const broken = await importInto(conn, csv('ID,NAME\n5,"e\n'), { table: 'PEOPLE' }).catch((e: unknown) => e);
  assert.ok(broken instanceof ImportError);
  assert.deepEqual([broken.why.kind, broken.sqlstate, broken.committed], ['input', '22000', 0n]);
  await conn.query("INSERT INTO PEOPLE VALUES (9, 'z')");
  const active = await importInto(conn, csv('ID\n1\n'), { table: 'PEOPLE' }).catch((e: unknown) => e);
  assert.ok(active instanceof ImportError && active.why.kind === 'input');
  await conn.query('ROLLBACK');
  const unnamed = await importInto(conn, csv('ID\n1\n'), { table: 'a b' }).catch((e: unknown) => e);
  assert.ok(unnamed instanceof ImportError);
  await conn.terminate();
});

/** Verifies: [CLIENT Large objects] an import's field longer than 64 KiB for a CLOB or BLOB column goes ahead as a large object it creates. */
test('an import of a long CLOB field', async (t) => {
  if (live(t) === undefined) return;
  const conn = await ann();
  await conn.query('CREATE TABLE NOTES (ID INTEGER, BODY CLOB(1M))');
  await conn.query('COMMIT');
  const long = 'é'.repeat(50_000);
  const text = `${['1', 'short'].join(',')}\n2,${long}\n`;
  const done = await importInto(conn, csv(text, Dialect.csv()), { table: 'NOTES' });
  assert.equal(done.rows, 2n);
  assert.deepEqual(rowsOf(await conn.query('SELECT CHAR_LENGTH(BODY) FROM NOTES ORDER BY ID')), [[5n], [50_000n]]);
  await conn.query('COMMIT');
  await conn.terminate();
});
