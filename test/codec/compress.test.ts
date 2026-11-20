/**
 * Tests of compressed frames: made past a threshold the client chooses,
 * and inflated no further than the length they declare
 * (RULES.md R-TEST-2).
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deflateSync } from 'node:zlib';

import { DEFAULT_THRESHOLD, compressFrames, decompress } from '../../src/codec/compress.js';
import { HEADER_BYTES, MAX_BODY, decodeHeader } from '../../src/codec/frame.js';
import { encodeRequest } from '../../src/codec/requests.js';
import { isConnectionFailure } from '../support/failures.js';

/**
 * The frames of a Query of `n` copies of `text`, then a Terminate.
 *
 * @param text - the text repeated
 * @param n - how many times
 * @returns the frames, and the Terminate's frame alone
 */
function frames(text: string, n: number): [Uint8Array, Uint8Array] {
  const query = encodeRequest({ kind: 'query', sql: text.repeat(n), ends: false, attributes: [], multi: false });
  const terminate = encodeRequest({ kind: 'terminate' });
  return [Uint8Array.from(Buffer.concat([query, terminate])), terminate];
}

/**
 * The zlib stream framed as a compressed frame's body would hold it.
 *
 * @param kind - the held frame's kind
 * @param length - the length it declares
 * @param stream - the stream
 * @returns the body
 */
function framed(kind: number, length: number, stream: Uint8Array): Uint8Array {
  const head = new DataView(new ArrayBuffer(5));
  head.setUint8(0, kind);
  head.setUint32(1, length, true);
  return Buffer.concat([new Uint8Array(head.buffer), stream]);
}

/** Verifies: [PROTOCOL Compressed frames] a frame past the threshold is sent as kind z, its kind, its length and a zlib stream of its body. */
test('a frame past the threshold is compressed', () => {
  const [bytes, terminate] = frames('SELECT 1 FROM T; ', 200);
  const out = compressFrames(bytes, DEFAULT_THRESHOLD);
  assert.ok(out.byteLength * 4 < bytes.byteLength);
  assert.deepEqual(out.subarray(out.byteLength - terminate.byteLength), terminate, 'the Terminate, below it, as it is');
  const header = decodeHeader(out.subarray(0, HEADER_BYTES), MAX_BODY);
  assert.equal(header.kind, 0x7a);
  const held = decompress(out.subarray(HEADER_BYTES, HEADER_BYTES + header.length), MAX_BODY);
  assert.equal(held.kind, 0x51);
  assert.deepEqual(held.body, bytes.subarray(HEADER_BYTES, bytes.byteLength - terminate.byteLength));
});

/** Verifies: [PROTOCOL Compressed frames] a threshold of the client's own: below it a frame goes as it is, at it compressed, and never where compressing would not shorten it. */
test('the threshold and the shorter rule', () => {
  const [small] = frames('S', 1);
  assert.deepEqual(compressFrames(small, DEFAULT_THRESHOLD), small, 'below the threshold');
  const [exact, terminate] = frames('a', DEFAULT_THRESHOLD - HEADER_BYTES - 4 - 1);
  const query = exact.subarray(0, exact.byteLength - terminate.byteLength);
  assert.equal(query.byteLength, DEFAULT_THRESHOLD);
  assert.equal(compressFrames(query, DEFAULT_THRESHOLD)[0], 0x7a, 'exactly the threshold');
  assert.deepEqual(compressFrames(query, DEFAULT_THRESHOLD + 1), query, 'one below it');
  let state = 0x9e37_79b9;
  const noise = Uint8Array.from({ length: 3000 }, () => {
    state = (state * 1_103_515_245 + 12_345) >>> 0;
    return state >>> 24;
  });
  const sent = encodeRequest({ kind: 'answer', answer: noise });
  assert.deepEqual(compressFrames(sent, 1), sent, 'no shorter compressed');
});

/** Verifies: [PROTOCOL Compressed frames] a z frame is inflated to at most its length, itself at most the longest body taken; exactly the longest inflates. */
test('a compressed frame is inflated within bounds', () => {
  const body = new Uint8Array(5000).fill(0x78);
  const stream = deflateSync(body);
  assert.deepEqual(decompress(framed(0x42, 5000, stream), 5000).body, body, 'exactly the longest');
  assert.throws(() => decompress(framed(0x42, 5000, stream), 4999), isConnectionFailure, 'longer than taken');
  assert.throws(
    () => decompress(framed(0x42, 4000, stream), MAX_BODY),
    isConnectionFailure,
    'inflates past its length',
  );
  assert.deepEqual(
    decompress(framed(0x47, 0, deflateSync(new Uint8Array(0))), MAX_BODY).body.byteLength,
    0,
    'an empty body',
  );
});

/** Verifies: [PROTOCOL Compressed frames] a z frame holding a z frame, inflating to another length, or no zlib stream fails the connection. */
test('a malformed compressed frame fails the connection', () => {
  const stream = deflateSync(new Uint8Array(5000).fill(0x78));
  assert.throws(() => decompress(framed(0x42, 6000, stream), MAX_BODY), isConnectionFailure, 'inflates short of it');
  assert.throws(() => decompress(framed(0x7a, 5000, stream), MAX_BODY), isConnectionFailure, 'nested');
  assert.throws(
    () => decompress(framed(0x42, 3, Uint8Array.of(0x61, 0x62, 0x63)), MAX_BODY),
    isConnectionFailure,
    'no stream',
  );
  assert.throws(() => decompress(Uint8Array.of(0x42, 1), MAX_BODY), isConnectionFailure, 'cut short');
  assert.throws(
    () => decompress(framed(0x42, 5000, Buffer.concat([stream, Uint8Array.of(1)])), MAX_BODY),
    isConnectionFailure,
    'bytes after the stream',
  );
  assert.throws(
    () => decompress(framed(0x42, 0, deflateSync(Uint8Array.of(1))), MAX_BODY),
    isConnectionFailure,
    'a length of 0 that inflates to more',
  );
});
