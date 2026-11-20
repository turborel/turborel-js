/**
 * Connection settings from outside the program
 * (`[CLIENT Connecting by settings]`, `[CLIENT Where settings come from]`),
 * as turborel-client's `settings.rs` lays them: where the servers are, as
 * whom to connect, how, and what a server must be, read from layers of
 * options: the program's own, or a URI's, then a service's section of the
 * service file, then the environment, then the defaults, each setting
 * taken from the first layer that has it. A password none gives is looked
 * up in the password file. `connect` connects as they say (`failover.ts`).
 *
 * @packageDocumentation
 */

import { homedir } from 'node:os';
import { join } from 'node:path';

import { connectBy } from './failover.js';
import { password, readRegular, serviceFile } from './files.js';
import { type Key, Options, invalid } from './options.js';
import { KeyCache } from '../auth/key-cache.js';
import type { ChannelBinding } from '../auth/scram.js';
import { CONNECT_WITHIN } from '../session/link.js';
import type { TlsFiles, TlsMode } from '../tls/modes.js';
import { DEFAULT_PORT } from '../transport/target.js';
import type { Connection } from '../session/connection.js';

/** The host connected to when none is named. */
export const DEFAULT_HOST = 'localhost';
/** The service file read when none is named, in the home directory. */
export const DEFAULT_SERVICE_FILE = '.turborel_service.conf';
/** The password file read when none is named, in the home directory. */
export const DEFAULT_PASSFILE = '.turborel_pass';

/** What separates the hosts of a list, and their ports. */
const LIST = ',';
/** The largest port. */
const MAX_PORT = 65_535;
/** Milliseconds in a second. */
const SECOND = 1000;

/** What a server must be for a connection to it to be kept. */
export type TargetRole = 'any' | 'read-write' | 'read-only';
/** Whether servers are tried in the order given, or in one drawn at random for each connection. */
export type LoadBalance = 'disable' | 'random';

/** Where a server is: a host name or address and port, over TCP; or a Unix socket's path, on Windows a named pipe. */
export type Host =
  | { readonly kind: 'tcp'; readonly name: string; readonly port: number }
  | { readonly kind: 'local'; readonly path: string };

/**
 * The value of `key` the word `text` is, among `words`.
 *
 * @param key - the setting
 * @param text - its value
 * @param words - the words it may be
 * @returns the word
 * @throws {@link TurborelError} 08001 if it is none of them
 */
function word<T extends string>(key: string, text: string, words: readonly T[]): T {
  const found = words.find((w) => w === text);
  if (found === undefined) throw invalid(`${key} is ${text}, not one of ${words.join(', ')}`);
  return found;
}

/**
 * The port `text` is.
 *
 * @param key - the setting it is of
 * @param text - its text
 * @returns the port
 * @throws {@link TurborelError} 08001 if it is no port
 */
function port(key: string, text: string): number {
  const trimmed = text.trim();
  const n = /^\d+$/u.test(trimmed) ? Number(trimmed) : Number.NaN;
  if (!(n <= MAX_PORT)) throw invalid(`${key} is ${text}, no port`);
  return n;
}

/**
 * The host `name` is: a path, of a local socket; `[address]` or `[address]:port`, of IPv6; `name:port`; or a name, at `fallback`.
 *
 * @param name - the host as written
 * @param fallback - its port if it carries none
 * @returns the host
 * @throws {@link TurborelError} 08001 if it cannot be read
 */
function host(name: string, fallback: number): Host {
  if (name === '') throw invalid('a host of the list is empty');
  if (name.startsWith('/') || name.startsWith('\\')) return { kind: 'local', path: name };
  if (name.startsWith('[')) {
    const close = name.indexOf(']');
    if (close < 0) throw invalid(`${name} has no ]`);
    const after = name.slice(close + 1);
    return {
      kind: 'tcp',
      name: name.slice(1, close),
      port: after.startsWith(':') ? port('host', after.slice(1)) : fallback,
    };
  }
  const colon = name.indexOf(':');
  // A name of two colons or more is an IPv6 address unbracketed, of no port.
  if (colon >= 0 && !name.slice(colon + 1).includes(':')) {
    return { kind: 'tcp', name: name.slice(0, colon), port: port('host', name.slice(colon + 1)) };
  }
  return { kind: 'tcp', name, port: fallback };
}

/**
 * The hosts `names` names, each of its own port, or that of the same place in `ports`, or the one port it gives, or the default.
 *
 * @param names - the hosts, comma-separated
 * @param ports - the ports, comma-separated
 * @returns the hosts
 */
function hosts(names: string, ports: string): Host[] {
  const each = ports
    .split(LIST)
    .filter((p) => p.trim() !== '')
    .map((p) => port('port', p));
  const fallback = (i: number): number => each[i] ?? (each.length === 1 ? (each[0] ?? DEFAULT_PORT) : DEFAULT_PORT);
  return names.split(LIST).map((name, i) => host(name.trim(), fallback(i)));
}

/**
 * The time `text` is, in whole seconds, as milliseconds; 0 for no limit.
 *
 * @param key - the setting
 * @param text - its text
 * @returns the milliseconds, or undefined for no limit
 */
function seconds(key: string, text: string): number | undefined {
  if (!/^\d+$/u.test(text.trim())) throw invalid(`${key} is ${text}, not a whole number of seconds`);
  const n = Number(text.trim());
  return n > 0 ? n * SECOND : undefined;
}

/**
 * The file `name` in the home directory.
 *
 * @param name - the file's name
 * @returns its path
 */
function atHome(name: string): string {
  return join(homedir(), name);
}

/** How to connect, as the settings say. */
export class Settings {
  /** The servers, tried in turn. */
  readonly hosts: readonly Host[];
  /** The user to connect as. */
  readonly user: string;
  readonly #password: string | undefined;
  /** How TLS is used. */
  readonly tlsMode: TlsMode;
  /** Whether SCRAM binds its channel. */
  readonly channelBinding: ChannelBinding;
  /** The program's name, as it tells the server. */
  readonly applicationName: string | undefined;
  /** How long each step of connecting waits, in milliseconds; undefined for no limit. */
  readonly connectTimeout: number | undefined;
  /** The password file. */
  readonly passfile: string;
  /** What a server must be. */
  readonly target: TargetRole;
  /** Whether the servers are tried in order. */
  readonly loadBalance: LoadBalance;
  /** The files TLS is made of. */
  readonly tls: TlsFiles;
  /** The SCRAM keys of its connections, so a reconnection skips their derivation. */
  readonly keyCache = new KeyCache();

  /**
   * The settings `options` give, laid already, the defaults for the rest.
   *
   * @param options - the settings laid
   */
  private constructor(options: Options) {
    const get = (key: Key): string | undefined => options.get(key);
    const user = get('user');
    if (user === undefined) throw invalid('no user is named: by the program, a service, or TURBOREL_USER');
    this.hosts = hosts(get('host') ?? DEFAULT_HOST, get('port') ?? '');
    this.user = user;
    this.#password = get('password');
    const read = <T>(key: Key, parse: (key: string, text: string) => T, fallback: T): T => {
      const text = get(key);
      return text === undefined ? fallback : parse(key, text);
    };
    this.tlsMode = read(
      'tls_mode',
      (k, t) => word(k, t, ['disable', 'prefer', 'require', 'verify-ca', 'verify-full'] as const),
      'prefer',
    );
    this.channelBinding = read(
      'channel_binding',
      (k, t) => word(k, t, ['disable', 'prefer', 'require'] as const),
      'prefer',
    );
    this.applicationName = get('application_name');
    this.connectTimeout = read('connect_timeout', seconds, CONNECT_WITHIN);
    this.passfile = get('passfile') ?? atHome(DEFAULT_PASSFILE);
    this.target = read('target', (k, t) => word(k, t, ['any', 'read-write', 'read-only'] as const), 'any');
    this.loadBalance = read('load_balance', (k, t) => word(k, t, ['disable', 'random'] as const), 'disable');
    const roots = get('tls_roots');
    const certificate = get('tls_certificate');
    const key = get('tls_key');
    const serverName = get('server_name');
    this.tls = {
      systemRoots: read('tls_system_roots', (k, t) => word(k, t, ['true', 'false'] as const) === 'true', false),
      ...(roots === undefined ? {} : { roots }),
      ...(certificate === undefined ? {} : { certificate }),
      ...(key === undefined ? {} : { key }),
      ...(serverName === undefined ? {} : { serverName }),
    };
  }

  /**
   * The settings `explicit` gives, then the service it or the process's environment names, then the environment, then the defaults.
   *
   * @param explicit - the program's settings
   * @returns the settings
   * @throws {@link TurborelError} 08001 if a setting cannot be read, a service named cannot be read, or no user is named
   */
  static resolve(explicit: Options = new Options()): Settings {
    return Settings.resolveIn(explicit, (name) => process.env[name]);
  }

  /**
   * The settings of a connection URI, as `resolve` lays them.
   *
   * @param uri - the URI
   * @returns the settings
   * @throws {@link TurborelError} 08001 as `Options.fromUri` and `resolve`
   */
  static fromUri(uri: string): Settings {
    return Settings.resolve(Options.fromUri(uri));
  }

  /**
   * The settings as `resolve` lays them, `variable` reading the environment.
   *
   * @param explicit - the program's settings
   * @param variable - reads a variable of the environment
   * @returns the settings
   * @throws {@link TurborelError} 08001 as `resolve`
   */
  static resolveIn(explicit: Options, variable: (name: string) => string | undefined): Settings {
    const environment = Options.environment(variable);
    const named = explicit.over(environment);
    const name = named.get('service');
    const section =
      name === undefined ? new Options() : serviceFile(named.get('service_file') ?? atHome(DEFAULT_SERVICE_FILE), name);
    return new Settings(explicit.over(section).over(environment));
  }

  /**
   * The password to prove at `at`: the settings', else the password file's for it, its port and the user, if the file can be read.
   *
   * @param at - the server
   * @returns the password, or undefined
   */
  passwordFor(at: Host): string | undefined {
    if (this.#password !== undefined) return this.#password;
    const text = readRegular(this.passfile);
    if (text === undefined) return undefined;
    const [name, at_port] = at.kind === 'tcp' ? [at.name, String(at.port)] : [at.path, String(DEFAULT_PORT)];
    return password(text, name, at_port, this.user);
  }

  /**
   * Connects as the settings say: to the first server that can be reached, logs the user in and is of the role asked.
   *
   * @returns the connection
   * @throws {@link TurborelError} the one server's failure; else 08001 naming each and why, or 28000 where the last refused the user; 28000 before any connection for a channel binding required that cannot be
   */
  connect(): Promise<Connection> {
    return connectBy(this);
  }

  /** @returns where it connects, as whom and how: never the password */
  toString(): string {
    const shown = this.hosts.map((h) => (h.kind === 'tcp' ? `${h.name}:${String(h.port)}` : h.path));
    return `Settings { hosts: ${shown.join(', ')}, user: ${this.user}, tls_mode: ${this.tlsMode}, target: ${this.target} }`;
  }
}
