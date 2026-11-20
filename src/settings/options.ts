/**
 * Connection settings as text (`[CLIENT Where settings come from]`,
 * `[CLIENT The connection URI]`), as turborel-client's
 * `settings/options.rs` and `settings/uri.rs` read them: a layer of
 * settings, each by one of the names below, as a program, a URI, a
 * service's section or the environment gives them; laid one over
 * another, each setting taken from the first layer that has it.
 *
 * @packageDocumentation
 */

import { TurborelError } from '../error.js';

/** SQLCODE of a connection exception. */
const SQLCODE_CONNECTION = -919;
/** SQLSTATE 08001, the client unable to connect. */
const UNABLE_TO_CONNECT = '08001';

/** The octet of `%`. */
const PERCENT = 0x25;
/** The radix of hexadecimal digits. */
const HEX = 16;
/** The digits of a percent-encoded octet. */
const ENCODED_DIGITS = 2;

/**
 * A setting that cannot be read, or settings no connection can be made by (SQLSTATE 08001).
 *
 * @param message - what is wrong
 * @returns the failure, to be thrown
 */
export function invalid(message: string): TurborelError {
  return new TurborelError(SQLCODE_CONNECTION, UNABLE_TO_CONNECT, message);
}

/** The settings' names, as the program, a URI's query and a service file write them. */
export const KEYS = [
  'host',
  'port',
  'user',
  'password',
  'tls_mode',
  'channel_binding',
  'application_name',
  'connect_timeout',
  'service',
  'service_file',
  'passfile',
  'target',
  'load_balance',
  'tls_roots',
  'tls_system_roots',
  'tls_certificate',
  'tls_key',
  'server_name',
] as const;

/** A setting's name. */
export type Key = (typeof KEYS)[number];

/** The environment's variables, each the setting it gives. */
export const ENVIRONMENT: readonly (readonly [string, Key])[] = [
  ['TURBOREL_HOST', 'host'],
  ['TURBOREL_PORT', 'port'],
  ['TURBOREL_USER', 'user'],
  ['TURBOREL_PASSWORD', 'password'],
  ['TURBOREL_TLS_MODE', 'tls_mode'],
  ['TURBOREL_APPLICATION_NAME', 'application_name'],
  ['TURBOREL_CONNECT_TIMEOUT', 'connect_timeout'],
  ['TURBOREL_SERVICE', 'service'],
  ['TURBOREL_SERVICE_FILE', 'service_file'],
  ['TURBOREL_PASSFILE', 'passfile'],
];

/** The scheme a connection URI begins with. */
export const SCHEME = 'turborel://';

/**
 * Whether `key` names a setting.
 *
 * @param key - a name
 * @returns true if it is one of `KEYS`
 */
function isKey(key: string): key is Key {
  return (KEYS as readonly string[]).includes(key);
}

/**
 * `text` percent-decoded, as UTF-8 (RFC 3986 §2.1).
 *
 * @param text - the text
 * @returns it decoded
 * @throws {@link TurborelError} 08001 for a `%` not followed by two hexadecimal digits, or octets not UTF-8
 */
export function decode(text: string): string {
  const octets: number[] = [];
  const bytes = Buffer.from(text);
  for (let i = 0; i < bytes.byteLength; i += 1) {
    const b = bytes[i] ?? 0;
    if (b !== PERCENT) {
      octets.push(b);
      continue;
    }
    const digits = bytes.subarray(i + 1, i + 1 + ENCODED_DIGITS).toString();
    if (!/^[0-9A-Fa-f]{2}$/u.test(digits)) throw invalid(`${text} has a % without two hexadecimal digits`);
    octets.push(Number.parseInt(digits, HEX));
    i += ENCODED_DIGITS;
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(octets));
  } catch {
    throw invalid(`${text} is not UTF-8 once decoded`);
  }
}

/** A layer of connection settings, each by its name. */
export class Options {
  readonly #values = new Map<Key, string>();

  /**
   * Sets `key` to `value`.
   *
   * @param key - a setting's name
   * @param value - its value
   * @returns these options
   * @throws {@link TurborelError} 08001 if `key` names no setting
   */
  set(key: string, value: string): this {
    if (!isKey(key)) throw invalid(`${key} is no connection setting`);
    this.#values.set(key, value);
    return this;
  }

  /**
   * The value of `key`, if set.
   *
   * @param key - a setting's name
   * @returns its value, or undefined
   */
  get(key: Key): string | undefined {
    return this.#values.get(key);
  }

  /** @returns whether none is set */
  get isEmpty(): boolean {
    return this.#values.size === 0;
  }

  /**
   * These settings, laid over `lower`: each of `lower`'s kept where these have none.
   *
   * @param lower - the layer beneath
   * @returns the settings laid
   */
  over(lower: Options): Options {
    const laid = new Options();
    for (const [k, v] of lower.#values) laid.#values.set(k, v);
    for (const [k, v] of this.#values) laid.#values.set(k, v);
    return laid;
  }

  /**
   * The settings the environment gives, `variable` reading each variable: an empty one gives none.
   *
   * @param variable - reads a variable, as `(name) => process.env[name]`
   * @returns the settings
   */
  static environment(variable: (name: string) => string | undefined): Options {
    const options = new Options();
    for (const [name, key] of ENVIRONMENT) {
      const value = variable(name);
      if (value !== undefined && value !== '') options.#values.set(key, value);
    }
    return options;
  }

  /**
   * The settings a connection URI gives:
   * `turborel://[user[:password]@][host[:port][,host[:port]]...][/][?setting=value[&setting=value]...]`,
   * its parts percent-encoded, an IPv6 address in brackets.
   *
   * @param uri - the URI
   * @returns the settings
   * @throws {@link TurborelError} 08001 for another scheme, a path, a setting not named, a pair without `=`, or bad percent-encoding
   */
  static fromUri(uri: string): Options {
    if (!uri.startsWith(SCHEME)) throw invalid(`a connection URI begins with ${SCHEME}`);
    const rest = uri.slice(SCHEME.length);
    const [before, query = ''] = splitOnce(rest, '?');
    const [authority, path = ''] = splitOnce(before, '/');
    if (path !== '') throw invalid(`a connection URI names no database, so has no path, not /${path}`);
    const options = new Options();
    const at = authority.lastIndexOf('@');
    const [userinfo, hosts] = at < 0 ? ['', authority] : [authority.slice(0, at), authority.slice(at + 1)];
    if (userinfo !== '') {
      const [user, password] = splitOnce(userinfo, ':');
      options.set('user', decode(user));
      if (password !== undefined) options.set('password', decode(password));
    }
    if (hosts !== '') options.set('host', decode(hosts));
    for (const pair of query.split('&').filter((p) => p !== '')) {
      const [key, value] = splitOnce(pair, '=');
      if (value === undefined) throw invalid(`${pair} in a connection URI has no =`);
      options.set(decode(key), decode(value));
    }
    return options;
  }

  /** @returns the settings' names and values, never the password */
  toString(): string {
    const shown = [...this.#values].map(([k, v]) => `${k}: ${k === 'password' ? '...' : v}`);
    return `Options { ${shown.join(', ')} }`;
  }
}

/**
 * `text` split at the first `at`.
 *
 * @param text - the text
 * @param at - where to split
 * @returns the part before, and the part after if `at` was there
 */
function splitOnce(text: string, at: string): [string, string | undefined] {
  const i = text.indexOf(at);
  return i < 0 ? [text, undefined] : [text.slice(0, i), text.slice(i + at.length)];
}
