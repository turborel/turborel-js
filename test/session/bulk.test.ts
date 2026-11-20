/**
 * Tests of large objects, copies and exports against a scripted server
 * on loopback, and of their parts that need none (RULES.md R-TEST-1).
 */

import assert from 'node:assert/strict';
import { after, test } from 'node:test';

import { Trust } from '../../src/auth/mechanism.js';
import { REQUEST } from '../../src/codec/kinds.js';
import { Reader } from '../../src/codec/reader.js';
import { Lob, LobLocator, type Value } from '../../src/codec/values.js';
import { COPY } from '../../src/session/capabilities.js';
import { connectTo } from '../../src/session/connect.js';
import type { Connection } from '../../src/session/connection.js';
import { csvField, csvValue, exportSink, nativeEnd, readNative } from '../../src/session/export.js';
import { CHUNK_OCTETS, charCut, heldRange, lobStream } from '../../src/session/lobs.js';
import { type Peer, type Scripted, scripted } from '../support/fake-server.js';
import { isConnectionFailure, isFailure } from '../support/failures.js';

const servers: Scripted[] = [];

after(async () => {
  await Promise.all(servers.map((s) => s.close()));
});

/** A column of a VARCHAR. */
const NAME = {
  name: 'NAME',
  type: { kind: 'varying' as const, length: 10, units: 'characters' as const },
  notNull: false,
};

/**
 * A connection to a server that grants `granted`, then runs `then`.
 *
 * @param granted - the capabilities it grants
 * @param then - what follows the login
 * @returns the connection
 */
async function connect(granted: readonly string[], then: (peer: Peer) => Promise<void>): Promise<Connection> {
  const s = await scripted(async (peer) => {
    await peer.frame();
    peer.ready(granted);
    await then(peer);
  });
  servers.push(s);
  return connectTo(s.target, 'ann', new Trust());
}

/** Verifies: [CLIENT Large objects] a CLOB's chunk is cut where a character ends, a character the end splits left out, as turborel's `char_cut` cuts it. */
test('a chunk ends where a character does', () => {
  const e = Buffer.from('aé€😀');
  assert.equal(charCut(e, 2), 1, 'é split: before it');
  assert.equal(charCut(e, 3), 3);
  assert.equal(charCut(e, 4), 3, '€ split');
  assert.equal(charCut(e, 100), e.byteLength, 'all');
  assert.equal(charCut(Buffer.from('é').subarray(0, 1), 1), 0, 'its end splits the one character');
  assert.equal(charCut(Buffer.from('ab'), 2), 2);
  assert.equal(charCut(Uint8Array.of(0x80, 0x80, 0x80, 0x80), 4), 4, 'no lead at all');
});

/** Verifies: [CLIENT Large objects] a large object held whole is read by ranges of its octets or of a CLOB's characters, a range past its end cut. */
test('ranges of a large object held whole', () => {
  const clob = new Lob('aéb');
  assert.deepEqual([...heldRange(clob, 1n, 2n, false)], [...Buffer.from('é')]);
  assert.equal(Buffer.from(heldRange(clob, 1n, 9n, true)).toString(), 'éb');
  assert.equal(heldRange(clob, 9n, 1n, true).byteLength, 0);
  assert.deepEqual([...heldRange(new Lob(Uint8Array.of(1, 2, 3)), 1n, 9n, true)], [2, 3]);
  assert.equal(heldRange(new Lob(Uint8Array.of(1)), 5n, 1n, false).byteLength, 0);
});

/** Verifies: [CLIENT Large objects] a stream of a large object reads a chunk at a time, and fails if the server sends less than its length. */
test('a large object as a stream', async () => {
  const reads: bigint[] = [];
  const stream = lobStream((from) => {
    reads.push(from);
    return Promise.resolve(from < 4n ? Uint8Array.of(1, 2) : new Uint8Array(0));
  }, 4n);
  let read = 0;
  for await (const chunk of stream) read += (chunk as Uint8Array).byteLength;
  assert.deepEqual([read, reads], [4, [0n, 2n]]);
  const short = lobStream(() => Promise.resolve(new Uint8Array(0)), 1n);
  await assert.rejects(
    (async () => {
      for await (const chunk of short) assert.ok(chunk !== undefined);
    })(),
    isConnectionFailure,
  );
});

/** Verifies: [CLIENT Large objects] a writer appends at most a chunk at a time, a CLOB's cut where a character ends; finish gives its locator and lengths; one held whole has no locator to free or hold. */
test('a large object written in pieces', async () => {
  const appended: number[] = [];
  const conn = await connect([], async (peer) => {
    const create = new Reader((await peer.frame()).body, 'request');
    assert.deepEqual([create.u8(), create.u8()], [1, 0], 'create, character');
    peer.reply('L', (w) => w.u8(1).u32(9));
    for (;;) {
      const frame = await peer.frame();
      if (frame.kind !== REQUEST.LOB) break;
      const r = new Reader(frame.body, 'request');
      r.u8();
      r.u32();
      appended.push(r.bytesField().byteLength);
      peer.complete({ active: true });
    }
  });
  const writer = await conn.createLob('character');
  await writer.write('é'.repeat(CHUNK_OCTETS));
  await writer.write(Buffer.from('€').subarray(0, 2));
  await writer.write(Buffer.from('€').subarray(2));
  const lob = await writer.finish();
  assert.deepEqual(
    [lob.locator, lob.octets, lob.characters],
    [9, BigInt(CHUNK_OCTETS * 2 + 3), BigInt(CHUNK_OCTETS + 1)],
  );
  assert.deepEqual(appended, [CHUNK_OCTETS, CHUNK_OCTETS, 3], 'no append longer than a chunk');
  await assert.rejects(conn.freeLob(new Lob('x')), isFailure(-301, '22000'));
  await assert.rejects(conn.holdLob(new Lob('x')), isFailure(-301, '22000'));
  assert.equal(Buffer.from(await conn.readLob(new Lob('xyz'), 1n, 1n)).toString(), 'y');
  conn.destroy();
});

/** Verifies: [PROTOCOL CopyIn 'I'] until CopyEnd only CopyData, CopyEnd and Ping are sent; another request is refused (TB910), and the copy goes on. */
test('a copy is the only request under way', async () => {
  const kinds: number[] = [];
  const conn = await connect([COPY, 'ping'], async (peer) => {
    for (;;) {
      const frame = await peer.frame();
      kinds.push(frame.kind);
      if (frame.kind === REQUEST.PING) peer.reply('G');
      else if (frame.kind === REQUEST.COPY_END) peer.complete({ sqlcode: 0 });
    }
  });
  const copy = await conn.copyIn('T', ['NAME']);
  await assert.rejects(conn.query('VALUES 1'), isFailure(-910, 'TB910'));
  await copy.send(['a']);
  await copy.ping();
  assert.equal(await copy.finish(), 0n);
  assert.equal(copy.ended, true);
  assert.deepEqual(kinds, [REQUEST.COPY_IN, REQUEST.COPY_DATA, REQUEST.PING, REQUEST.COPY_END]);
  await copy[Symbol.asyncDispose]();
  assert.equal(kinds.length, 4, 'an ended copy is not abandoned again');
  conn.destroy();
});

/** Verifies: [CLIENT Copying and exporting] a copy disposed of, or whose rows fail to come, before it finishes is abandoned. */
test('a copy dropped is abandoned', async () => {
  const ends: boolean[] = [];
  const conn = await connect([COPY], async (peer) => {
    for (;;) {
      const frame = await peer.frame();
      if (frame.kind === REQUEST.COPY_END) {
        ends.push(frame.body[0] === 1);
        peer.complete();
      }
    }
  });
  {
    await using copy = await conn.copyIn('T');
    await copy.send(['a']);
  }
  /** @returns a row, then a failure */
  async function* failing(): AsyncGenerator<readonly Value[]> {
    yield ['b'];
    await Promise.resolve();
    throw new Error('no more rows');
  }
  await assert.rejects(conn.copyRows('T', [], failing()), /no more rows/u);
  assert.equal(await conn.copyRows('T', ['NAME'], [['c'], ['d']]), 0n);
  assert.deepEqual(ends, [true, true, false], 'abandoned twice, then finished');
  conn.destroy();
});

/** Verifies: [CLIENT Copying and exporting] a CSV field is quoted where it holds a comma, a quote, a line break or spaces at either end, its quotes doubled; an empty string quoted, a null empty. */
test('CSV fields', () => {
  assert.equal(csvField('plain'), 'plain');
  assert.equal(csvField('a,b'), '"a,b"');
  assert.equal(csvField('say "hi"'), '"say ""hi"""');
  assert.equal(csvField(' pad'), '" pad"');
  assert.equal(csvField('pad　'), '"pad　"', 'any white space');
  assert.equal(csvField('two\nlines'), '"two\nlines"');
  assert.equal(csvValue(''), '""');
  assert.equal(csvValue(null), '');
  assert.equal(csvValue(1.5), '1.5E0');
});

/** Verifies: [CLIENT Copying and exporting] native rows are a Description, Rows and a Complete, read back with every value as it was; anything else is refused. */
test('native rows read back', async () => {
  const parts: Uint8Array[] = [];
  const sink = exportSink({ write: (bytes) => void parts.push(bytes) }, 'native');
  await sink.columns([NAME]);
  await sink.rows([['a'], [null]]);
  await sink.rows([[new LobLocator('binary', 1, { octets: 2n, characters: 0n })]]);
  parts.push(nativeEnd());
  const back = await readNative(parts);
  assert.deepEqual(back.columns, [NAME]);
  assert.deepEqual(back.rows.slice(0, 2), [['a'], [null]]);
  assert.ok(back.rows[2]?.[0] instanceof LobLocator);
  await assert.rejects(readNative([]), isConnectionFailure, 'nothing');
  await assert.rejects(readNative([nativeEnd()]), isConnectionFailure, 'no Description first');
  await assert.rejects(
    readNative([parts[0] ?? new Uint8Array(0), Uint8Array.of(0x42, 9, 0, 0, 0)]),
    isConnectionFailure,
    'cut short',
  );
  await assert.rejects(
    readNative([parts[0] ?? new Uint8Array(0), parts[0] ?? new Uint8Array(0)]),
    isConnectionFailure,
    'two Descriptions',
  );
});
