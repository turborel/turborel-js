/**
 * Compressed frames (`[PROTOCOL Compressed frames]`), as
 * turborel-protocol's `compress.rs` makes and reads them: a frame of kind
 * `z` whose body is the held frame's kind, its body's length, and a zlib
 * stream of its body (RFC 1950), by `node:zlib` (RULES.md D10). The
 * reader inflates no further than the length declared, itself at most the
 * longest body taken, so a stream cannot make it hold more. Internal.
 *
 * @packageDocumentation
 */

import { deflateSync, inflateSync } from 'node:zlib';

import { HEADER_BYTES, encodeFrame } from './frame.js';
import { COMPRESSED } from './kinds.js';
import { Reader } from './reader.js';
import { Writer } from './writer.js';
import { connectionFailure } from '../error.js';

/**
 * The threshold turborel-client compresses from: a frame shorter than
 * this, header included, is sent as it is, as the stream's header, its
 * trailer and the time taken outweigh what it saves.
 */
export const DEFAULT_THRESHOLD = 1024;

/** The bytes a compressed frame's body takes before its stream: the held kind and length. */
const PREFIX = 5;

/** Where a frame's length begins, after its kind. */
const LENGTH_AT = 1;

/** A frame held in a compressed frame: its kind and its body. */
export interface Inflated {
  /** The held frame's kind. */
  readonly kind: number;
  /** Its body. */
  readonly body: Uint8Array;
}

/**
 * The frames of `frames`, each of at least `threshold` bytes compressed
 * where that makes it shorter, the others as they are.
 *
 * @param frames - whole frames, one after another
 * @param threshold - the bytes, header included, from which a frame is compressed
 * @returns the frames to send
 */
export function compressFrames(frames: Uint8Array, threshold: number): Uint8Array {
  const out: Uint8Array[] = [];
  const view = new DataView(frames.buffer, frames.byteOffset, frames.byteLength);
  let at = 0;
  while (at + HEADER_BYTES <= frames.byteLength) {
    const kind = view.getUint8(at);
    const length = Math.min(view.getUint32(at + LENGTH_AT, true), frames.byteLength - at - HEADER_BYTES);
    const whole = HEADER_BYTES + length;
    const body = frames.subarray(at + HEADER_BYTES, at + whole);
    const stream = whole >= threshold ? deflateSync(body) : undefined;
    if (stream !== undefined && stream.byteLength + PREFIX < length) {
      out.push(encodeFrame(COMPRESSED, new Writer().u8(kind).u32(length).raw(stream).finish()));
    } else {
      out.push(frames.subarray(at, at + whole));
    }
    at += whole;
  }
  return concat(out);
}

/**
 * The bytes of `parts`, one after another, as a plain `Uint8Array`.
 *
 * @param parts - the parts
 * @returns them joined
 */
function concat(parts: readonly Uint8Array[]): Uint8Array {
  const joined = new Uint8Array(parts.reduce((n, part) => n + part.byteLength, 0));
  let at = 0;
  for (const part of parts) {
    joined.set(part, at);
    at += part.byteLength;
  }
  return joined;
}

/**
 * The frame a compressed frame's body holds: its length at most `max`,
 * inflated no further.
 *
 * @param body - the compressed frame's body
 * @param max - the longest body taken
 * @returns the held frame's kind and body
 * @throws {@link TurborelError} 08006 if it is malformed, holds another compressed frame, declares more than `max`, or inflates to other than it declares
 */
export function decompress(body: Uint8Array, max: number): Inflated {
  const r = new Reader(body, 'compressed frame');
  const kind = r.u8();
  const length = r.u32();
  if (kind === COMPRESSED) throw connectionFailure('a compressed frame holds another');
  if (length > max)
    throw connectionFailure(`a compressed message of ${String(length)} bytes is longer than the ${String(max)} taken`);
  const stream = r.rest();
  let inflated: Uint8Array;
  try {
    const { buffer, engine } = inflateSync(stream, { maxOutputLength: Math.max(length, 1), info: true }) as unknown as {
      buffer: Buffer;
      engine: { bytesWritten: number };
    };
    if (engine.bytesWritten !== stream.byteLength) throw new Error('bytes follow the stream');
    inflated = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  } catch (e) {
    throw connectionFailure('a compressed frame is no zlib stream inflating within its length', e);
  }
  if (inflated.byteLength !== length)
    throw connectionFailure('a compressed frame inflates to another length than it declares');
  return { kind, body: inflated };
}

/**
 * The frame a received frame of kind `kind` and body `body` is: itself,
 * or, of kind `z`, the frame it holds, inflated within `max`.
 *
 * @param frame - the received frame's kind and body
 * @param compression - whether `compression` was granted
 * @param max - the longest body taken
 * @returns the frame to read
 * @throws {@link TurborelError} 08006 for a `z` frame when compression was not granted, or one malformed
 */
export function received(frame: Inflated, compression: boolean, max: number): Inflated {
  if (frame.kind !== COMPRESSED) return frame;
  if (!compression) throw connectionFailure('a compressed frame was received, but compression was not granted');
  return decompress(frame.body, max);
}
