/**
 * Cancelling a connection's running statement (`[PROTOCOL Cancel 'Z']`,
 * `[CLIENT Running statements]`), as turborel-client's `cancel.rs` does: a
 * new connection to the same server, made as the first was, whose first
 * and only message is Cancel with the key the first's Ready gave. The
 * server closes it with no reply, and the statement fails with SQLCODE
 * -920 (SQLSTATE TB920).
 *
 * @packageDocumentation
 */

import type { Connection } from './connection.js';
import { encodeRequest } from '../codec/requests.js';
import { connectionFailure } from '../error.js';
import { FrameStream } from '../transport/frames.js';
import { type Target, open } from '../transport/target.js';

/** How long a cancel waits for the server, unless told: 10 seconds. */
export const CANCEL_WITHIN = 10_000;

/** The most bytes taken from a cancel's connection as it closes: it is told nothing. */
const NOTHING = 0;

/** What cancels the statement a connection runs, from elsewhere. */
export class Canceller {
  readonly #target: Target;
  readonly #key: Uint8Array;

  /**
   * A canceller of the session whose Ready gave `key`.
   *
   * @param target - where its server is
   * @param key - the session's cancel key
   */
  constructor(target: Target, key: Uint8Array) {
    this.#target = target;
    this.#key = key;
  }

  /**
   * The canceller of `connection`'s statements.
   *
   * @param connection - a connection reached at a target
   * @returns it, or undefined of a connection made over a stream of the program's, whose server it cannot reach again
   */
  static of(connection: Connection): Canceller | undefined {
    const [target, key] = [connection.target, connection.cancelKey()];
    return target === undefined || key === undefined ? undefined : new Canceller(target, key);
  }

  /**
   * Cancels the statement the session runs, giving up after `ms`; one as nothing runs does nothing.
   *
   * @param ms - the milliseconds it may take, 10 seconds unless told
   * @throws {@link TurborelError} 08006 if the server cannot be reached, in time
   */
  async cancel(ms: number = CANCEL_WITHIN): Promise<void> {
    const opened = await open(this.#target, ms);
    const stream = new FrameStream(opened.socket);
    try {
      await stream.write(encodeRequest({ kind: 'cancel', key: this.#key }), ms);
      await stream.closed(NOTHING, ms);
    } catch (e) {
      stream.destroy();
      throw connectionFailure('cannot cancel: the server did not take the cancel', e);
    }
  }

  /** @returns never the key */
  toString(): string {
    return 'Canceller(..)';
  }
}
