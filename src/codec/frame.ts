/**
 * The frame header of the native protocol, version 1: a kind of one octet,
 * then the body's length, a u32 little-endian, the header not counted
 * (`doc/client/05-protocol.md`, Frames). Internal: the package's exports
 * map does not reach it.
 *
 * @packageDocumentation
 */

import { connectionFailure } from '../error.js';

/** The bytes of a frame's header: its kind, one octet, and its length, four. */
export const HEADER_BYTES = 5;

/** Where in the header its length begins, after the kind. */
const LENGTH_AT = 1;

/** The largest octet, the kind's largest value. */
const U8_MAX = 0xff;

/** The largest u32, the length's largest value. */
const U32_MAX = 0xffff_ffff;

/**
 * The longest body the driver reads unless told otherwise: 16 MiB, as
 * turborel-client's `MAX_BODY`, so a peer cannot make it hold without bound.
 */
export const MAX_BODY = 16_777_216;

/** A frame's header, read or to be written. */
export interface FrameHeader {
  /** Which message the frame is, read in the direction it travels. */
  readonly kind: number;
  /** The bytes of the body that follows the header. */
  readonly length: number;
}

/**
 * The five bytes of `header`.
 *
 * @param header - the frame's kind, an octet, and its body's length, a u32
 * @returns the header's bytes
 * @throws {@link TurborelError} SQLCODE -919, SQLSTATE 08006, if the kind is
 *   no octet or the length no u32, since no such frame can be sent
 */
export function encodeHeader(header: FrameHeader): Uint8Array {
  if (!Number.isInteger(header.kind) || header.kind < 0 || header.kind > U8_MAX) {
    throw connectionFailure(`a frame's kind is an octet, not ${String(header.kind)}`);
  }
  if (!Number.isInteger(header.length) || header.length < 0 || header.length > U32_MAX) {
    throw connectionFailure(`a frame's length is a u32, not ${String(header.length)}`);
  }
  const bytes = new Uint8Array(HEADER_BYTES);
  const view = new DataView(bytes.buffer);
  view.setUint8(0, header.kind);
  view.setUint32(LENGTH_AT, header.length, true);
  return bytes;
}

/**
 * The header whose bytes are `bytes`, its body at most `max` bytes long.
 *
 * @param bytes - exactly the header's five bytes
 * @param max - the longest body taken
 * @returns the frame's kind and its body's length
 * @throws {@link TurborelError} SQLCODE -919, SQLSTATE 08006, if `bytes`
 *   are not five, or the body would be longer than `max`
 */
export function decodeHeader(bytes: Uint8Array, max: number): FrameHeader {
  if (bytes.byteLength !== HEADER_BYTES) {
    throw connectionFailure(`a frame's header is ${String(HEADER_BYTES)} bytes, not ${String(bytes.byteLength)}`);
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const length = view.getUint32(LENGTH_AT, true);
  if (length > max) {
    throw connectionFailure(`a message of ${String(length)} bytes is longer than the ${String(max)} taken`);
  }
  return { kind: view.getUint8(0), length };
}

/**
 * The frame of kind `kind` whose body is `body`: its header, then the body.
 *
 * @param kind - the message's kind
 * @param body - its body
 * @returns the frame's bytes
 */
export function encodeFrame(kind: number, body: Uint8Array): Uint8Array {
  const frame = new Uint8Array(HEADER_BYTES + body.byteLength);
  frame.set(encodeHeader({ kind, length: body.byteLength }));
  frame.set(body, HEADER_BYTES);
  return frame;
}
