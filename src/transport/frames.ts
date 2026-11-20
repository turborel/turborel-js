/**
 * Frames over a socket (`[PROTOCOL Frames]`): each frame read whole, its
 * header first, its body held only as its bytes arrive and only up to the
 * longest taken, and each write sent; every wait bounded as the caller
 * says (`[CLIENT Timeouts]`). A socket's error, its close, or a wait that
 * runs out loses the connection (SQLCODE -919, SQLSTATE 08006).
 *
 * @packageDocumentation
 */

import type { Socket } from 'node:net';

import { HEADER_BYTES, decodeHeader } from '../codec/frame.js';
import { type TurborelError, connectionFailure } from '../error.js';

/** A frame read: its kind and its body. */
export interface Frame {
  /** The frame's kind. */
  readonly kind: number;
  /** Its body. */
  readonly body: Uint8Array;
}

/**
 * The bytes buffered from the socket beyond which it is paused until they
 * are read, unless a frame being read needs more, so a server sending
 * faster than the program reads holds no more than this.
 */
const HIGH_WATER = 1_048_576;

/** A read waiting for bytes. */
interface Waiter {
  readonly need: number;
  readonly resolve: (bytes: Uint8Array) => void;
  readonly reject: (e: TurborelError) => void;
}

/**
 * A wait bounded by `ms`, or unbounded if none: the failure of a wait that
 * runs out says the server did not answer in time.
 *
 * @param wait - what is waited for
 * @param ms - the milliseconds it may take, or undefined for no limit
 * @param what - what it is, for the failure
 * @param onTimeout - what is done as it runs out, before it fails
 * @returns what it gives
 */
export async function within<T>(
  wait: Promise<T>,
  ms: number | undefined,
  what: string,
  onTimeout: () => void,
): Promise<T> {
  if (ms === undefined) return wait;
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      // Rejected first, so the race fails as having run out, not as the closing it causes.
      reject(connectionFailure(`cannot ${what}: the server did not answer in time`));
      onTimeout();
    }, ms);
  });
  try {
    return await Promise.race([wait, late]);
  } finally {
    clearTimeout(timer);
  }
}

/** A connection's socket, read a frame at a time and written a request at a time. */
export class FrameStream {
  /** The socket. */
  readonly socket: Socket;
  private readonly chunks: Buffer[] = [];
  private buffered = 0;
  private waiter: Waiter | undefined;
  private failure: TurborelError | undefined;

  /** @param socket - a connected socket, plain or TLS */
  constructor(socket: Socket) {
    this.socket = socket;
    socket.on('data', (chunk: Buffer) => {
      this.chunks.push(chunk);
      this.buffered += chunk.byteLength;
      this.serve();
    });
    socket.on('error', (e: Error) => {
      this.fail(connectionFailure(`the connection failed: ${e.message}`, e));
    });
    socket.on('close', () => {
      this.fail(connectionFailure('the server closed the connection'));
    });
  }

  /**
   * Fails every read from now on with `e`, the first failure kept.
   *
   * @param e - the failure
   */
  private fail(e: TurborelError): void {
    this.failure ??= e;
    const waiter = this.waiter;
    this.waiter = undefined;
    waiter?.reject(this.failure);
  }

  /** Gives the waiting read its bytes once they are all here, and pauses the socket past the high water. */
  private serve(): void {
    const waiter = this.waiter;
    if (waiter !== undefined && this.buffered >= waiter.need) {
      this.waiter = undefined;
      waiter.resolve(this.take(waiter.need));
    }
    const need = this.waiter?.need ?? 0;
    if (this.buffered >= Math.max(need, HIGH_WATER)) this.socket.pause();
    else this.socket.resume();
  }

  /**
   * The first `n` bytes buffered, taken.
   *
   * @param n - how many, at most those buffered
   * @returns them
   */
  private take(n: number): Uint8Array {
    const joined = this.chunks.length === 1 ? (this.chunks[0] ?? Buffer.alloc(0)) : Buffer.concat(this.chunks);
    this.chunks.length = 0;
    if (joined.byteLength > n) this.chunks.push(joined.subarray(n));
    this.buffered -= n;
    return new Uint8Array(joined.buffer, joined.byteOffset, n).slice();
  }

  /**
   * The next `n` bytes, as they arrive.
   *
   * @param n - how many
   * @returns them
   */
  private read(n: number): Promise<Uint8Array> {
    if (this.buffered >= n) {
      const bytes = this.take(n);
      this.serve();
      return Promise.resolve(bytes);
    }
    if (this.failure !== undefined) return Promise.reject(this.failure);
    return new Promise((resolve, reject) => {
      this.waiter = { need: n, resolve, reject };
      this.serve();
    });
  }

  /**
   * The next frame, its body at most `max` bytes.
   *
   * @param max - the longest body taken
   * @param ms - the milliseconds each wait may take, or undefined for none
   * @returns the frame
   * @throws {@link TurborelError} 08006 if the connection is lost, a body is longer than `max`, or a wait runs out
   */
  async next(max: number, ms: number | undefined): Promise<Frame> {
    const lose = (): void => {
      this.destroy();
    };
    const head = await within(this.read(HEADER_BYTES), ms, 'receive', lose);
    const { kind, length } = decodeHeader(head, max);
    const body = length === 0 ? new Uint8Array(0) : await within(this.read(length), ms, 'receive', lose);
    return { kind, body };
  }

  /**
   * Writes `bytes`, and waits for the socket to take them.
   *
   * @param bytes - frames, encoded
   * @param ms - the milliseconds the write may take, or undefined for none
   * @throws {@link TurborelError} 08006 if the connection is lost or the write runs out of time
   */
  async write(bytes: Uint8Array, ms: number | undefined): Promise<void> {
    if (this.failure !== undefined) throw this.failure;
    const written = new Promise<void>((resolve, reject) => {
      this.socket.write(bytes, (e) => {
        if (e === undefined || e === null) resolve();
        else reject(connectionFailure(`cannot send: ${e.message}`, e));
      });
    });
    await within(written, ms, 'send', () => {
      this.destroy();
    });
  }

  /**
   * Waits for the server to close the connection, taking what it sends
   * before, at most `max` bytes.
   *
   * @param max - the most bytes taken
   * @param ms - the milliseconds it may take, or undefined for none
   * @returns the bytes it sent before closing
   */
  async closed(max: number, ms: number | undefined): Promise<Uint8Array> {
    const ended = new Promise<Uint8Array>((resolve) => {
      const done = (): void => {
        resolve(this.take(Math.min(this.buffered, max)));
      };
      if (this.socket.destroyed || this.failure !== undefined) done();
      else this.socket.once('close', done);
      this.socket.resume();
    });
    return within(ended, ms, 'receive', () => {
      this.destroy();
    });
  }

  /** Ends the connection at once: the socket destroyed, every read from now on failed. */
  destroy(): void {
    this.fail(connectionFailure('the connection was closed'));
    this.socket.destroy();
  }
}
