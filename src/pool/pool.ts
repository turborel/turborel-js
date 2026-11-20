/**
 * A pool of connections (`[CLIENT Pools]`), as turborel-client's
 * `pool.rs` and `pool/reset.rs` keep one: a bounded set a program's tasks
 * share. `get` hands out an idle connection that answers, or makes one
 * while fewer than `max` are made, or waits for one to come back, at most
 * `wait`. A connection comes back as its `Pooled` is released, reset to
 * the session it logged in with; one lost, or whose reset fails, is closed
 * instead, so no borrower sees another's session. Idle beyond
 * `idleTimeout`, or older than `maxLifetime`, a connection is closed
 * rather than handed out, and no more than `maxIdle` are kept idle. It
 * starts nothing of its own: each wait is a promise of the waiting
 * borrower's, timed by a timer of its own.
 *
 * @packageDocumentation
 */

import { CONNECT_WITHIN } from '../session/link.js';
import type { Connection } from '../session/connection.js';
import { Settings } from '../settings/settings.js';
import { invalid } from '../settings/options.js';

/** The connections a pool makes at most by default. */
export const DEFAULT_MAX = 10;
/** How long `get` waits by default for a connection to come back: 30 seconds. */
export const DEFAULT_WAIT = CONNECT_WITHIN;
/** How long a connection may stay idle by default: ten minutes. */
export const DEFAULT_IDLE_TIMEOUT = 600_000;
/** How long a connection lives by default: an hour. */
export const DEFAULT_MAX_LIFETIME = 3_600_000;
/** How long a pooled connection's check and reset wait on its server at most: 30 seconds. */
export const RESET_WITHIN = CONNECT_WITHIN;

/** What a server that grants no Ping is checked by. */
const CHECK = 'ROLLBACK';

/** What makes a pool's connections: settings, or a function that connects. */
export type PoolSource = Settings | (() => Promise<Connection>);

/** How a pool keeps its connections; times in milliseconds. */
export interface PoolConfig {
  /** The most connections made at once, handed out and idle: 10 by default. */
  readonly max?: number;
  /** The most kept idle: 10 by default. */
  readonly maxIdle?: number;
  /** How long one may stay idle, ten minutes by default; undefined for as long as it lives. */
  readonly idleTimeout?: number | undefined;
  /** How long one lives from when it was made, an hour by default; undefined for no limit. */
  readonly maxLifetime?: number | undefined;
  /** How long `get` waits for one to come back: 30 seconds by default. */
  readonly wait?: number;
  /** Whether an idle connection is checked to answer before it is handed out: yes by default. */
  readonly check?: boolean;
  /** Statements run, after the pool's own, as each connection comes back. */
  readonly reset?: readonly string[];
}

/** A connection idle in the pool: when it was made, and since when idle. */
interface Idle {
  readonly connection: Connection;
  readonly made: number;
  readonly since: number;
}

/**
 * Runs `run` on `conn`, each of its waits at most `RESET_WITHIN`, or the connection's own limit if shorter; the limit put back after.
 *
 * @param conn - the connection
 * @param run - what to run
 */
async function bounded(conn: Connection, run: () => Promise<unknown>): Promise<void> {
  const before = conn.readTimeout;
  conn.setReadTimeout(before === undefined ? RESET_WITHIN : Math.min(before, RESET_WITHIN));
  try {
    await run();
  } finally {
    conn.setReadTimeout(before);
  }
}

/**
 * Whether `conn` answers: by Ping where the server grants it, else by ROLLBACK, which completes doing nothing outside a transaction.
 *
 * @param conn - the connection
 * @returns true if it answered
 */
async function answers(conn: Connection): Promise<boolean> {
  try {
    await bounded(conn, () => (conn.has('ping') ? conn.ping() : conn.query(CHECK)));
    return true;
  } catch {
    return false;
  }
}

/** A connection handed out by a pool, given back as it is released. */
export class Pooled {
  /** The connection. */
  readonly connection: Connection;
  readonly #made: number;
  readonly #pool: Pool;
  #released = false;

  /**
   * A connection handed out.
   *
   * @param connection - the connection
   * @param made - when it was made
   * @param pool - its pool
   */
  constructor(connection: Connection, made: number, pool: Pool) {
    [this.connection, this.#made, this.#pool] = [connection, made, pool];
  }

  /** Gives the connection back, reset; or closes it, if it is lost, its reset fails, it has lived its time, or enough are idle. Once only. */
  async release(): Promise<void> {
    if (this.#released) return;
    this.#released = true;
    await this.#pool.giveBack(this.connection, this.#made);
  }

  /** Releases it, as `await using` disposes of it. */
  async [Symbol.asyncDispose](): Promise<void> {
    await this.release();
  }
}

/** A pool of connections. */
export class Pool {
  readonly #source: () => Promise<Connection>;
  readonly #config: Required<Omit<PoolConfig, 'idleTimeout' | 'maxLifetime'>> & {
    idleTimeout: number | undefined;
    maxLifetime: number | undefined;
  };
  readonly #idle: Idle[] = [];
  #made = 0;
  readonly #waiting: (() => void)[] = [];

  /**
   * A pool of the connections `source` makes, kept as `config` says.
   *
   * @param source - settings, or a function that connects
   * @param config - how it keeps them
   */
  constructor(source: PoolSource, config: PoolConfig = {}) {
    this.#source = source instanceof Settings ? () => source.connect() : source;
    this.#config = {
      max: config.max ?? DEFAULT_MAX,
      maxIdle: config.maxIdle ?? DEFAULT_MAX,
      idleTimeout: 'idleTimeout' in config ? config.idleTimeout : DEFAULT_IDLE_TIMEOUT,
      maxLifetime: 'maxLifetime' in config ? config.maxLifetime : DEFAULT_MAX_LIFETIME,
      wait: config.wait ?? DEFAULT_WAIT,
      check: config.check ?? true,
      reset: config.reset ?? [],
    };
  }

  /** @returns how many connections are made, handed out and idle, and how many of them are idle */
  get counts(): { readonly made: number; readonly idle: number } {
    return { made: this.#made, idle: this.#idle.length };
  }

  /**
   * Whether `idle` may still be handed out at `now`.
   *
   * @param idle - the connection idle
   * @param now - the time
   * @returns true if it may
   */
  #fresh(idle: Idle, now: number): boolean {
    const { maxLifetime, idleTimeout } = this.#config;
    const lived = maxLifetime === undefined || now - idle.made < maxLifetime;
    const rested = idleTimeout === undefined || now - idle.since < idleTimeout;
    return lived && rested && !idle.connection.isLost;
  }

  /** Wakes the first waiter, a connection come back or a place freed. */
  #wake(): void {
    this.#waiting.shift()?.();
  }

  /**
   * A connection: an idle one that answers, else a new one while the pool has room, else the first to come back within `wait`.
   *
   * @returns it, to release
   * @throws {@link TurborelError} 08001 if none comes back in time; the failure of making one
   */
  async get(): Promise<Pooled> {
    const deadline = Date.now() + this.#config.wait;
    for (;;) {
      const now = Date.now();
      const idle = this.#idle.pop();
      if (idle !== undefined) {
        if (!this.#fresh(idle, now) || (this.#config.check && !(await answers(idle.connection)))) {
          idle.connection.destroy();
          this.#made -= 1;
          continue;
        }
        return new Pooled(idle.connection, idle.made, this);
      }
      if (this.#made < this.#config.max) return this.#make();
      if (!(await this.#waitFor(deadline - now))) {
        throw invalid(
          `no connection of the pool's ${String(this.#config.max)} came back within ${String(this.#config.wait)} ms`,
        );
      }
    }
  }

  /**
   * Waits for a connection to come back, or a place to free, at most `ms`.
   *
   * @param ms - the milliseconds left
   * @returns whether one did
   */
  #waitFor(ms: number): Promise<boolean> {
    if (ms <= 0) return Promise.resolve(false);
    return new Promise((resolve) => {
      const woken = (): void => {
        clearTimeout(timer);
        resolve(true);
      };
      const timer = setTimeout(() => {
        const at = this.#waiting.indexOf(woken);
        if (at >= 0) this.#waiting.splice(at, 1);
        resolve(false);
      }, ms);
      this.#waiting.push(woken);
    });
  }

  /** @returns a new connection, in a place taken for it */
  async #make(): Promise<Pooled> {
    this.#made += 1;
    try {
      return new Pooled(await this.#source(), Date.now(), this);
    } catch (e) {
      this.#made -= 1;
      this.#wake();
      throw e;
    }
  }

  /**
   * Takes a connection back, reset; or closes it.
   *
   * @param conn - the connection
   * @param made - when it was made
   */
  async giveBack(conn: Connection, made: number): Promise<void> {
    const { maxLifetime, maxIdle, reset } = this.#config;
    const lived = maxLifetime !== undefined && Date.now() - made >= maxLifetime;
    let kept = !lived;
    if (kept) {
      try {
        await bounded(conn, () => conn.giveBack(reset));
      } catch {
        kept = false;
      }
    }
    if (kept && this.#idle.length < maxIdle) this.#idle.push({ connection: conn, made, since: Date.now() });
    else {
      conn.destroy();
      this.#made -= 1;
    }
    this.#wake();
  }

  /** Closes every idle connection; those handed out are closed as they come back once the pool is no longer used. */
  close(): void {
    for (const idle of this.#idle.splice(0)) {
      idle.connection.destroy();
      this.#made -= 1;
    }
  }
}
