/**
 * Connecting as settings say, to one of several servers
 * (`[CLIENT Several servers]`, `[CLIENT TLS by mode]`), as
 * turborel-client's `failover.rs` and `role.rs` connect: each host tried in
 * the order given, or in an order drawn at random for each connection
 * under `load_balance=random`, and each address a host's name resolves to
 * in turn, every step within the connect timeout. A server reached,
 * logged in to and of the role asked is kept; another is left and the
 * next tried. No server kept, the failure says why each was not.
 *
 * @packageDocumentation
 */

import { randomBytes } from 'node:crypto';
import { lookup } from 'node:dns/promises';

import type { Host, Settings } from './settings.js';
import { textOf } from '../codec/text.js';
import { invalid } from './options.js';
import { Certificate, type Mechanism, Trust } from '../auth/mechanism.js';
import { Scram } from '../auth/scram.js';
import { SQLSTATE_INVALID_AUTHORIZATION } from '../auth/scram-exchange.js';
import { TurborelError, connectionFailure } from '../error.js';
import { SERVER_READ_ONLY } from '../session/capabilities.js';
import { logIn, refuseInTheClear } from '../session/connect.js';
import type { Connection } from '../session/connection.js';
import { APPLICATION, Offer } from '../session/told.js';
import { type TlsConfig } from '../tls/config.js';
import { modeConfig } from '../tls/modes.js';
import { type Target, isPlainTcp, local, open, openPreferring, overTls, tcp } from '../transport/target.js';

/** SQLCODE of a connection exception. */
const SQLCODE_CONNECTION = -919;
/** SQLSTATE 08001, the client unable to connect. */
const UNABLE_TO_CONNECT = '08001';
/** The SQLSTATE class of a user refused. */
const REFUSED_CLASS = '28';

/** The multiplier and increment of the generator that orders hosts at random (Knuth's MMIX). */
const MULTIPLIER = 6_364_136_223_846_793_005n;
const INCREMENT = 1_442_695_040_888_963_407n;
/** The high bits of its state taken for each draw. */
const DRAW_SHIFT = 33n;
/** The bits of its state. */
const STATE_BITS = 64;
/** The octets of a seed. */
const SEED_OCTETS = 8;

/** The query of a server's own role in its group. */
export const ROLE_QUERY = "SELECT ROLE FROM INFORMATION_SCHEMA.REPLICAS WHERE IS_SELF = 'YES'";
/** The role REPLICAS shows of the group's primary. */
const PRIMARY = 'PRIMARY';
/** The SQLSTATE classes of a table that does not exist, as a server alone answers the query. */
const NO_SUCH_TABLE = ['2A', '42'];

/** What a server is, to a connection's session. */
export type Role = 'read-write' | 'read-only' | 'unknown';

/**
 * `items` in an order drawn from `seed` (Fisher and Yates, as Durstenfeld gives it).
 *
 * @param items - the items, reordered in place
 * @param seed - the seed, a u64
 */
export function shuffle(items: unknown[], seed: bigint): void {
  let state = BigInt.asUintN(STATE_BITS, seed);
  for (let i = items.length - 1; i >= 1; i -= 1) {
    state = BigInt.asUintN(STATE_BITS, state * MULTIPLIER + INCREMENT);
    const j = Number((state >> DRAW_SHIFT) % BigInt(i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
}

/** @returns a seed of the system's randomness */
function seed(): bigint {
  return randomBytes(SEED_OCTETS).readBigUInt64LE();
}

/**
 * The role a SERVER_READ_ONLY status shows.
 *
 * @param told - YES or NO
 * @returns the role
 */
export function roleTold(told: string): Role {
  return told === 'YES' ? 'read-only' : 'read-write';
}

/**
 * The role of a connection's server, as its session sees it: as its
 * SERVER_READ_ONLY status last told it, if the server tells it; else
 * asked of INFORMATION_SCHEMA.REPLICAS as a statement that is its own
 * transaction, so it leaves none open.
 *
 * @param conn - the connection
 * @returns its role
 * @throws {@link TurborelError} 08006 if the connection is lost; the query's failure, but of a server alone
 */
export async function role(conn: Connection): Promise<Role> {
  const told = conn.setting(SERVER_READ_ONLY);
  if (told !== undefined) return roleTold(told);
  const autocommit = conn.autocommit;
  conn.setAutocommit(true);
  try {
    const answer = await conn.query(ROLE_QUERY);
    const [row] = answer.kind === 'rows' ? answer.rows : [];
    if (row === undefined) return 'unknown';
    return textOf(row[0] ?? null).trimEnd() === PRIMARY ? 'read-write' : 'read-only';
  } catch (e) {
    if (e instanceof TurborelError && NO_SUCH_TABLE.some((c) => e.sqlstate.startsWith(c))) return 'read-write';
    throw e;
  } finally {
    conn.setAutocommit(autocommit);
  }
}

/**
 * A role in words.
 *
 * @param r - the role
 * @returns as `read-only`
 */
function described(r: Role): string {
  return r === 'unknown' ? 'of a role this session cannot see' : r;
}

/**
 * Each target of `host`, named: its local socket, or each address its name resolves to, over TLS as `tls` says.
 *
 * @param host - the host
 * @param tls - the TLS of the settings' mode, if any
 * @param serverName - the name its certificate is checked against, if not the host's
 * @returns each target and its name, or why none
 */
async function targets(
  host: Host,
  tls: TlsConfig | undefined,
  serverName: string | undefined,
): Promise<[string, Target | TurborelError][]> {
  if (host.kind === 'local') return [[host.path, local(host.path)]];
  let found: { address: string }[];
  try {
    found = await lookup(host.name, { all: true, order: 'verbatim' });
  } catch (e) {
    return [
      [`${host.name}:${String(host.port)}`, connectionFailure(`cannot resolve the name: ${(e as Error).message}`, e)],
    ];
  }
  const secured = tls === undefined ? undefined : { ...tls, serverName: serverName ?? host.name };
  return found.map(({ address }) => [
    `${host.name} (${address}:${String(host.port)})`,
    secured === undefined ? tcp(address, host.port) : overTls(address, secured, host.port),
  ]);
}

/**
 * What proves the user at `host` over `target`.
 *
 * @param settings - the settings
 * @param host - the server
 * @param target - how it is reached
 * @returns the mechanism
 * @throws {@link TurborelError} 28000 for a channel binding required that cannot be
 */
function proof(settings: Settings, host: Host, target: Target): Mechanism {
  const password = settings.passwordFor(host);
  const mechanism: Mechanism =
    password !== undefined
      ? new Scram(password, { channelBinding: settings.channelBinding, cache: settings.keyCache })
      : settings.tls.certificate === undefined
        ? new Trust()
        : new Certificate();
  if (settings.channelBinding === 'require' && !(mechanism instanceof Scram && target.kind === 'tls')) {
    throw new TurborelError(
      SQLCODE_CONNECTION,
      SQLSTATE_INVALID_AUTHORIZATION,
      'channel binding is required: SCRAM over TLS alone binds one',
    );
  }
  return mechanism;
}

/**
 * A connection to `host` over `target`, logged in and of the role asked; under `prefer`, over plain TCP if TLS cannot be begun.
 *
 * @param settings - the settings
 * @param host - the server
 * @param target - how it is reached
 * @returns the connection
 */
async function attempt(settings: Settings, host: Host, target: Target): Promise<Connection> {
  const ms = settings.connectTimeout;
  const { target: reached, opened } =
    settings.tlsMode === 'prefer' ? await openPreferring(target, ms) : { target, opened: await open(target, ms) };
  let conn: Connection;
  try {
    const mechanism = proof(settings, host, reached);
    if (isPlainTcp(reached)) refuseInTheClear(reached, mechanism);
    const offer =
      settings.applicationName === undefined
        ? Offer.default()
        : Offer.default().attribute(APPLICATION, settings.applicationName);
    conn = await logIn(reached, opened, settings.user, mechanism, {
      offer,
      timeouts: { connect: ms, read: undefined },
    });
  } catch (e) {
    opened.socket.destroy();
    throw e;
  }
  if (settings.target === 'any') return conn;
  const found = await role(conn).catch((e: unknown) => {
    conn.destroy();
    throw e;
  });
  if (found === settings.target) return conn;
  conn.destroy();
  throw invalid(`the server is ${described(found)}, and ${settings.target} is asked`);
}

/**
 * The failure of a connection none of `tried` gave: the one's own, of one; else 08001 naming each and why, 28000 if the last refused the user.
 *
 * @param tried - each address, and why it was not kept
 * @returns the failure
 */
export function noneKept(tried: readonly [string, TurborelError][]): TurborelError {
  const [only] = tried;
  if (tried.length === 1 && only !== undefined) return only[1];
  const refused = tried[tried.length - 1]?.[1].sqlstate.startsWith(REFUSED_CLASS) === true;
  const reasons = tried.map(([at, f]) => `${at}: ${f.message}`);
  const message = reasons.length === 0 ? 'no server is named' : `no server was kept: ${reasons.join('; ')}`;
  return new TurborelError(SQLCODE_CONNECTION, refused ? SQLSTATE_INVALID_AUTHORIZATION : UNABLE_TO_CONNECT, message);
}

/**
 * A connection to the first server, of the hosts in the order the settings say, that can be reached, logs the user in and is of the role asked.
 *
 * @param settings - the settings
 * @returns the connection
 * @throws {@link TurborelError} the one server's failure, if there was one; else 08001, or 28000 where the last refused the user
 */
export async function connectBy(settings: Settings): Promise<Connection> {
  const hosts = [...settings.hosts];
  if (settings.loadBalance === 'random') shuffle(hosts, seed());
  const tls = modeConfig(settings.tlsMode, settings.tls);
  const tried: [string, TurborelError][] = [];
  for (const host of hosts) {
    const usedTls = host.kind === 'tcp' ? tls : undefined;
    for (const [at, target] of await targets(host, usedTls, settings.tls.serverName)) {
      if (target instanceof TurborelError) {
        tried.push([at, target]);
        continue;
      }
      try {
        return await attempt(settings, host, target);
      } catch (e) {
        tried.push([at, e instanceof TurborelError ? e : connectionFailure(String(e), e)]);
      }
    }
  }
  throw noneKept(tried);
}
