/**
 * The sample frames of `[PROTOCOL Sample frames]`, copied at a pinned
 * commit of Turborel's (RULES.md D23): every line read as the page lays
 * it out, every server frame decoded to what its meaning says, every
 * client frame encoded byte for byte, and each compressed frame inflated
 * to the frame its meaning names.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { DEFAULT_THRESHOLD, compressFrames, decompress } from '../../src/codec/compress.js';
import { COMPRESSED } from '../../src/codec/kinds.js';
import { HEADER_BYTES, MAX_BODY, decodeHeader, encodeFrame } from '../../src/codec/frame.js';
import { type Reply, decodeReply } from '../../src/codec/replies.js';
import { type Request, encodeRequest } from '../../src/codec/requests.js';
import { CLIENT, SERVER } from './frames-table.js';
import { summary } from '../support/summary.js';

/** A line of the file: who sends the frame, its name, what it needs granted, its octets and its meaning. */
interface Sample {
  readonly direction: 'client' | 'server';
  readonly name: string;
  readonly needs: readonly string[];
  readonly frame: Uint8Array;
  readonly means: string;
}

/** The file, as copied into the fixtures. */
const FILE = join(import.meta.dirname, '..', '..', '..', 'test', 'fixtures', '05-protocol-frames.tsv');

/** How many samples the file holds at its pinned commit. */
const SAMPLES = 148;

/**
 * The file's samples, each line checked as the page lays it out.
 *
 * @returns them, in the file's order
 */
function samples(): Sample[] {
  const out: Sample[] = [];
  for (const line of readFileSync(FILE, 'utf8').split('\n')) {
    if (line === '' || line.startsWith('#')) continue;
    const fields = line.split('\t');
    assert.equal(fields.length, 5, line);
    const [direction, name, needs, hex, means] = fields as [string, string, string, string, string];
    assert.ok(direction === 'client' || direction === 'server', line);
    assert.match(hex, /^(?:[0-9A-F]{2})+$/u, name);
    out.push({
      direction,
      name,
      needs: needs === '-' ? [] : needs.split(','),
      frame: Uint8Array.from(Buffer.from(hex, 'hex')),
      means,
    });
  }
  return out;
}

/**
 * The frame `frame` holds, inflated if it is compressed.
 *
 * @param frame - a whole frame
 * @returns its kind and body, its header's length checked
 */
function opened(frame: Uint8Array): { kind: number; body: Uint8Array } {
  const header = decodeHeader(frame.subarray(0, HEADER_BYTES), MAX_BODY);
  const body = frame.subarray(HEADER_BYTES);
  assert.equal(body.byteLength, header.length, 'its header gives its length');
  return header.kind === COMPRESSED ? decompress(body, MAX_BODY) : { kind: header.kind, body };
}

/**
 * The request of the client frame `name`.
 *
 * @param name - the sample's name
 * @returns its request, as the table gives it
 */
function request(name: string): Request {
  const r = CLIENT[name];
  assert.ok(r !== undefined, name);
  return r;
}

/** Verifies: [PROTOCOL Sample frames] every line of the file at its pinned commit has its five fields, a name unique, a direction, its needs and its frame, whose header gives its length. */
test('the sample frames file is read as the page lays it out', () => {
  const all = samples();
  assert.equal(all.length, SAMPLES);
  assert.equal(new Set(all.map((s) => s.name)).size, all.length, 'names unique');
  for (const s of all) {
    assert.ok(s.frame.byteLength >= HEADER_BYTES, s.name);
    opened(s.frame);
  }
});

/** Verifies: [PROTOCOL Sample frames] every server frame decodes to what its meaning says. */
test('every server frame decodes as its meaning says', () => {
  const server = samples().filter((s) => s.direction === 'server');
  for (const s of server) {
    const { kind, body } = opened(s.frame);
    const reply: Reply = decodeReply(kind, body);
    assert.equal(summary(reply), SERVER[s.name], `${s.name}: ${s.means}`);
  }
  assert.deepEqual(Object.keys(SERVER).sort(), server.map((s) => s.name).sort(), 'one meaning for each');
});

/** Verifies: [PROTOCOL Sample frames] every client frame the driver sends is encoded byte for byte as the file holds it. */
test('every client frame is encoded as the file holds it', () => {
  const client = samples().filter((s) => s.direction === 'client' && s.name in CLIENT);
  for (const s of client) {
    const { kind, body } = opened(s.frame);
    assert.deepEqual(encodeRequest(request(s.name)), encodeFrame(kind, body), `${s.name}: ${s.means}`);
  }
  assert.equal(client.length, Object.keys(CLIENT).length, 'every request of the table is in the file');
  assert.equal(client.length, samples().filter((s) => s.direction === 'client').length, 'every client frame');
});

/** Verifies: [PROTOCOL Sample frames] a compressed frame's sample inflates to the frame its meaning names, its kind and length. */
test('every compressed frame inflates to the frame its meaning names', () => {
  const compressed = samples().filter((s) => s.frame[0] === COMPRESSED);
  assert.deepEqual(
    compressed.map((s) => s.name),
    ['query-compressed', 'rows-compressed'],
  );
  for (const s of compressed) {
    const { kind, body } = opened(s.frame);
    const said = /kind (\w), length (\d+)/u.exec(s.means);
    assert.ok(said !== null, s.name);
    assert.deepEqual([String.fromCharCode(kind), body.byteLength], [said[1], Number(said[2])], s.name);
  }
  // zlib streams of one frame differ by their compressor; what they inflate to does not.
  const own = compressFrames(encodeRequest(request('query-compressed')), DEFAULT_THRESHOLD);
  const sent = samples().find((s) => s.name === 'query-compressed');
  assert.ok(sent !== undefined && own[0] === COMPRESSED);
  assert.deepEqual(opened(own), opened(sent.frame), 'the driver compresses it to the same frame');
});
