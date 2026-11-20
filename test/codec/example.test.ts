/**
 * The spec's worked example, byte for byte: each message a client sends
 * encoded to its printed bytes, and each reply decoded from them
 * (RULES.md R-TEST-1).
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { HEADER_BYTES, MAX_BODY, decodeHeader } from '../../src/codec/frame.js';
import { decodeReply } from '../../src/codec/replies.js';
import { encodeRequest } from '../../src/codec/requests.js';

/**
 * The bytes of hexadecimal text, its spaces ignored.
 *
 * @param hex - pairs of hexadecimal digits
 * @returns the bytes
 */
function bytes(hex: string): Uint8Array {
  return Uint8Array.from(
    hex.split(/\s+/u).filter((pair) => pair !== ''),
    (pair) => Number.parseInt(pair, 16),
  );
}

/**
 * The reply a frame's bytes hold.
 *
 * @param frame - header and body
 * @returns the reply
 */
function replyOf(frame: Uint8Array): ReturnType<typeof decodeReply> {
  const header = decodeHeader(frame.subarray(0, HEADER_BYTES), MAX_BODY);
  assert.equal(header.length, frame.byteLength - HEADER_BYTES);
  return decodeReply(header.kind, frame.subarray(HEADER_BYTES));
}

/** Verifies: [PROTOCOL A worked example] Hello of trust as ANN asking for ping is 41 bytes, as printed. */
test("the example's Hello", () => {
  const hello = bytes(`48 24 00 00 00 01 00 00 00 03 00 00 00 41 4E 4E
    05 00 00 00 74 72 75 73 74 00 00 00 00 01 00 00 00 04 00 00 00 70 69 6E 67`);
  const sent = encodeRequest({
    kind: 'hello',
    version: 1,
    user: 'ANN',
    mechanism: 'trust',
    initial: new Uint8Array(0),
    capabilities: ['ping'],
    attributes: [],
  });
  assert.equal(sent.byteLength, 41);
  assert.deepEqual(sent, hello);
});

/** Verifies: [PROTOCOL A worked example] a Ping is a header alone, and so is its Pong. */
test("the example's Ping and Pong", () => {
  assert.deepEqual(encodeRequest({ kind: 'ping' }), bytes('47 00 00 00 00'));
  assert.deepEqual(replyOf(bytes('47 00 00 00 00')), { kind: 'pong' });
});

/** Verifies: [PROTOCOL A worked example] the Query of VALUES 1 with ends set is 18 bytes, as printed. */
test("the example's Query", () => {
  const query = bytes('51 0D 00 00 00 08 00 00 00 56 41 4C 55 45 53 20 31 01');
  assert.deepEqual(encodeRequest({ kind: 'query', sql: 'VALUES 1', ends: true, attributes: [], multi: false }), query);
});

/** Verifies: [PROTOCOL A worked example] the Rows reply holds one row of the exact number 1, units 1 and scale 0. */
test("the example's Rows", () => {
  const rows = bytes(`42 1D 00 00 00 01 00 00 00 01 00 00 00 02
    01 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00`);
  assert.deepEqual(replyOf(rows), { kind: 'rows', rows: [[1n]] });
});

/** Verifies: [PROTOCOL A worked example] the Complete says the statement succeeded and no transaction is active; with row-counts, tag 6 and the count follow. */
test("the example's Complete", () => {
  const complete = bytes('4B 0E 00 00 00 00 00 00 00 05 00 00 00 30 30 30 30 30 00');
  const first = { sqlcode: 0, sqlstate: '00000', active: false, more: false, generated: [], conditions: [] };
  assert.deepEqual(replyOf(complete), { kind: 'complete', completion: first });
  const counted = bytes(`4B 17 00 00 00 00 00 00 00 05 00 00 00 30 30 30 30 30 00
    06 01 00 00 00 00 00 00 00`);
  assert.deepEqual(replyOf(counted), { kind: 'complete', completion: { ...first, rows: 1n } });
});
