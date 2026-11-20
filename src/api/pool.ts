/**
 * A pool of the standard API (RULES.md D2, D22): connections a program's
 * tasks share, each handed out as a `Client` whose `close()` gives it
 * back, over the low-level pool.
 *
 * @packageDocumentation
 */

import { Client, type ConnectOptions, type Result, type RunOptions, settingsOf } from './client.js';
import type { Value } from '../codec/values.js';
import { Pool, type PoolConfig } from '../pool/pool.js';

/** A pool of clients. */
export class ClientPool {
  /** The low-level pool beneath it. */
  readonly pool: Pool;

  /**
   * A pool of the connections `settings` make.
   *
   * @param settings - a `turborel://` URI, or options
   * @param config - how it keeps them
   */
  constructor(settings: string | ConnectOptions, config: PoolConfig = {}) {
    this.pool = new Pool(settingsOf(settings), config);
  }

  /**
   * A client of a connection of the pool, its `close()` giving the connection back.
   *
   * @returns the client
   * @throws {@link TurborelError} 08001 if none comes back in time; the failure of making one
   */
  async connect(): Promise<Client> {
    const pooled = await this.pool.get();
    return new Client(pooled.connection, () => pooled.release());
  }

  /**
   * Runs `sql` on a connection of the pool, given back once it is done.
   *
   * @param sql - the statement
   * @param params - a value for each `?`
   * @param options - an `AbortSignal` that cancels it
   * @returns its result
   */
  async query(sql: string, params: readonly Value[] = [], options: RunOptions = {}): Promise<Result> {
    await using client = await this.connect();
    return await client.query(sql, params, options);
  }

  /** Closes the pool's idle connections; those handed out are closed as they come back. */
  close(): Promise<void> {
    this.pool.close();
    return Promise.resolve();
  }

  /** Closes it, as `await using` disposes of it. */
  async [Symbol.asyncDispose](): Promise<void> {
    await this.close();
  }
}

/**
 * A pool of the connections `settings` make.
 *
 * @param settings - a `turborel://` URI, or options
 * @param config - how it keeps them
 * @returns the pool
 * @throws {@link TurborelError} 08001 if a setting cannot be read
 */
export function createPool(settings: string | ConnectOptions, config: PoolConfig = {}): ClientPool {
  return new ClientPool(settings, config);
}
