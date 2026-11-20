/**
 * Tests of the frame header: its kind, then its body's length, a u32
 * little-endian, five bytes in all; a header cut short or of a body past
 * the limit fails the connection (RULES.md R-TEST-2).
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { HEADER_BYTES, MAX_BODY, decodeHeader, encodeHeader } from '../../src/codec/frame.js';
import { isConnectionFailure } from '../support/failures.js';

/** Verifies: [PROTOCOL Frames] the header is five bytes, a u8 kind then a u32 length, least significant first. */
test('a header is its kind, then its length little-endian', () => {
  assert.equal(HEADER_BYTES, 5);
  assert.deepEqual(encodeHeader({ kind: 0x51, length: 0x0403_0201 }), Uint8Array.of(0x51, 0x01, 0x02, 0x03, 0x04));
  assert.deepEqual(decodeHeader(Uint8Array.of(0x51, 0x01, 0x02, 0x03, 0x04), 0xffff_ffff), {
    kind: 0x51,
    length: 0x0403_0201,
  });
});

/** Verifies: [PROTOCOL A worked example] the Hello's header of a 36-byte body, and Ping's and Pong's of none. */
test('the worked example reads back byte for byte', () => {
  const hello = Uint8Array.of(0x48, 0x24, 0x00, 0x00, 0x00);
  assert.deepEqual(encodeHeader({ kind: 0x48, length: 36 }), hello);
  assert.deepEqual(decodeHeader(hello, MAX_BODY), { kind: 0x48, length: 36 });
  const ping = Uint8Array.of(0x47, 0x00, 0x00, 0x00, 0x00);
  assert.deepEqual(encodeHeader({ kind: 0x47, length: 0 }), ping);
  assert.deepEqual(decodeHeader(ping, MAX_BODY), { kind: 0x47, length: 0 });
});

/** Verifies: [PROTOCOL Frames] every octet is a kind and every u32 a length, at their edges. */
test('a header reads back at the edges of its fields', () => {
  for (const header of [
    { kind: 0, length: 0 },
    { kind: 0xff, length: 0xffff_ffff },
  ]) {
    assert.deepEqual(decodeHeader(encodeHeader(header), 0xffff_ffff), header);
  }
});

/** Verifies: [PROTOCOL Frames] a header read from within a larger buffer is read from its own first byte. */
test('a header is read where it lies in its buffer', () => {
  const buffer = Uint8Array.of(0xaa, 0x4b, 0x0e, 0x00, 0x00, 0x00, 0xbb);
  assert.deepEqual(decodeHeader(buffer.subarray(1, 6), MAX_BODY), { kind: 0x4b, length: 14 });
});

/** Verifies: [PROTOCOL Frames] a body longer than the reader takes fails the connection from its header; one as long is taken. */
test('a body past the limit is refused from its header', () => {
  const header = encodeHeader({ kind: 0x51, length: 7 });
  assert.deepEqual(decodeHeader(header, 7), { kind: 0x51, length: 7 });
  assert.throws(() => decodeHeader(header, 6), isConnectionFailure);
  assert.throws(() => decodeHeader(Uint8Array.of(0x51, 0xff, 0xff, 0xff, 0xff), MAX_BODY), isConnectionFailure);
  assert.equal(MAX_BODY, 16 * 1024 * 1024);
});

/** Verifies: [PROTOCOL Frames] a header cut short, or with bytes after it, fails the connection (SQLCODE -919, SQLSTATE 08006). */
test('a header of other than five bytes is refused', () => {
  assert.throws(() => decodeHeader(Uint8Array.of(0x47, 0x00, 0x00, 0x00), MAX_BODY), isConnectionFailure);
  assert.throws(() => decodeHeader(new Uint8Array(0), MAX_BODY), isConnectionFailure);
  assert.throws(() => decodeHeader(new Uint8Array(6), MAX_BODY), isConnectionFailure);
});

/** Verifies: [PROTOCOL Frames] a kind that is no octet, or a length that is no u32, is never written. */
test('a header of no octet kind or no u32 length is refused', () => {
  for (const header of [
    { kind: -1, length: 0 },
    { kind: 0x100, length: 0 },
    { kind: 0.5, length: 0 },
    { kind: 0x51, length: -1 },
    { kind: 0x51, length: 0x1_0000_0000 },
    { kind: 0x51, length: Number.NaN },
  ]) {
    assert.throws(() => encodeHeader(header), isConnectionFailure);
  }
});
