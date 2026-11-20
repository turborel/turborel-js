/**
 * The SCRAM key cache (`[CLIENT The SCRAM key cache]`), as
 * turborel-client's `scram/cache.rs` keeps it: after an exchange the
 * server proved, the keys a password derived under the server's salt and
 * iterations are kept in the process's memory alone, so a later login
 * meeting the same salt and iterations skips PBKDF2, the slow step.
 *
 * @packageDocumentation
 */

import { randomBytes } from 'node:crypto';

import { type Derived, deriveKeys, hmac } from './scram-exchange.js';

/** The most entries a cache holds, the oldest dropped first. */
export const KEY_CACHE_ENTRIES = 64;

/** The bytes of a cache's own secret, as turborel's nonce. */
const SECRET_BYTES = 18;

/** An entry: what finds it, and the keys. */
interface Entry {
  readonly tag: string;
  readonly salt: string;
  readonly iterations: number;
  readonly keys: Derived;
}

/** How often a cache found the keys asked for, and how often not. */
export interface Lookups {
  /** Lookups that found the keys. */
  readonly hits: number;
  /** Lookups that derived them. */
  readonly misses: number;
}

/**
 * Keys a password derived, found by the salt, the iterations and a tag of
 * the password under a random secret of the cache's own, so a wrong
 * password finds nothing and the cache holds neither a password nor what
 * one could be guessed from offline.
 */
export class KeyCache {
  readonly #secret = randomBytes(SECRET_BYTES).toString('base64');
  readonly #held: Entry[] = [];
  #hits = 0;
  #misses = 0;

  /**
   * The index of a password's keys.
   *
   * @param password - the password
   * @param salt - the salt
   * @param iterations - the iterations
   * @returns what finds them
   */
  #index(password: string, salt: Uint8Array, iterations: number): Omit<Entry, 'keys'> {
    return {
      tag: Buffer.from(hmac(this.#secret, password)).toString('hex'),
      salt: Buffer.from(salt).toString('hex'),
      iterations,
    };
  }

  /**
   * Whether `entry` is found by `index`.
   *
   * @param entry - an entry
   * @param index - what is looked for
   * @returns true if it is the same
   */
  static #matches(entry: Omit<Entry, 'keys'>, index: Omit<Entry, 'keys'>): boolean {
    return entry.tag === index.tag && entry.salt === index.salt && entry.iterations === index.iterations;
  }

  /**
   * The keys `password` derives under `salt` and `iterations`: those held, or derived and held.
   *
   * @param password - the password
   * @param salt - the salt
   * @param iterations - the iterations
   * @returns the keys
   */
  async derived(password: string, salt: Uint8Array, iterations: number): Promise<Derived> {
    const index = this.#index(password, salt, iterations);
    const found = this.#held.find((e) => KeyCache.#matches(e, index));
    if (found !== undefined) {
      this.#hits += 1;
      return found.keys;
    }
    this.#misses += 1;
    const keys = await deriveKeys(password, salt, iterations);
    if (!this.#held.some((e) => KeyCache.#matches(e, index))) {
      if (this.#held.length >= KEY_CACHE_ENTRIES) this.#held.shift();
      this.#held.push({ ...index, keys });
    }
    return keys;
  }

  /**
   * Drops the keys of a login that failed.
   *
   * @param password - the password
   * @param salt - the salt
   * @param iterations - the iterations
   */
  forget(password: string, salt: Uint8Array, iterations: number): void {
    const index = this.#index(password, salt, iterations);
    const at = this.#held.findIndex((e) => KeyCache.#matches(e, index));
    if (at >= 0) this.#held.splice(at, 1);
  }

  /** @returns the entries held */
  get size(): number {
    return this.#held.length;
  }

  /** @returns how often the keys were found, and how often derived */
  lookups(): Lookups {
    return { hits: this.#hits, misses: this.#misses };
  }

  /** Drops every entry. */
  clear(): void {
    this.#held.length = 0;
  }

  /** @returns its size alone, never its keys */
  toString(): string {
    return `KeyCache(${String(this.size)} entries)`;
  }
}
