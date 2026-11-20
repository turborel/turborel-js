/**
 * Tests of connection settings: the URI, the service file, the password
 * file, the environment and the order the layers are laid in, the cases
 * of turborel-client's `settings/tests.rs` (RULES.md R-TEST-9).
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

import { password, service } from '../../src/settings/files.js';
import { noneKept, roleTold, shuffle } from '../../src/settings/failover.js';
import { ENVIRONMENT, Options } from '../../src/settings/options.js';
import { DEFAULT_HOST, Settings } from '../../src/settings/settings.js';
import { TurborelError, connectionFailure } from '../../src/error.js';
import { DEFAULT_PORT } from '../../src/transport/target.js';
import { isFailure } from '../support/failures.js';

const dir = mkdtempSync(join(tmpdir(), 'turborel-js-settings-'));
after(() => {
  rmSync(dir, { recursive: true, force: true });
});

/**
 * An environment of `pairs`, as `Settings.resolveIn` reads one.
 *
 * @param pairs - each variable and its value
 * @returns what reads a variable
 */
function environment(pairs: readonly (readonly [string, string])[] = []): (name: string) => string | undefined {
  const map = new Map(pairs);
  return (name) => map.get(name);
}

/**
 * A scratch file of `text`.
 *
 * @param name - its name
 * @param text - its text
 * @returns its path
 */
function scratch(name: string, text: string): string {
  const path = join(dir, name);
  writeFileSync(path, text);
  return path;
}

/** A failure of SQLSTATE 08001. */
const unable = isFailure(-919, '08001');

/** Verifies: [CLIENT The connection URI] a URI gives its user, password, hosts each of its port, an IPv6 address in brackets, a local socket percent-encoded, and its query's settings. */
test('a URI gives its user, hosts and settings', () => {
  const uri =
    'turborel://ann:p%40ss@db1:7000,[::1]:7001,db3,%2Frun%2Fs.sock/?tls_mode=verify-full&target=read-write&connect_timeout=5';
  const options = Options.fromUri(uri);
  assert.deepEqual([options.get('user'), options.get('password')], ['ann', 'p@ss']);
  const settings = Settings.resolveIn(options, environment());
  assert.deepEqual(settings.hosts, [
    { kind: 'tcp', name: 'db1', port: 7000 },
    { kind: 'tcp', name: '::1', port: 7001 },
    { kind: 'tcp', name: 'db3', port: DEFAULT_PORT },
    { kind: 'local', path: '/run/s.sock' },
  ]);
  assert.deepEqual([settings.tlsMode, settings.target, settings.connectTimeout], ['verify-full', 'read-write', 5000]);
  assert.ok(!`${String(options)} ${String(settings)}`.includes('p@ss'), 'the password is never shown');
  const bare = Settings.resolveIn(Options.fromUri('turborel://ann@/'), environment());
  assert.deepEqual(bare.hosts, [{ kind: 'tcp', name: DEFAULT_HOST, port: DEFAULT_PORT }]);
  assert.equal(
    Settings.resolveIn(Options.fromUri('turborel://ann@h/?connect_timeout=0'), environment()).connectTimeout,
    undefined,
  );
});

/** Verifies: [CLIENT The connection URI] a URI of another scheme, a path, a setting not named, a pair without `=`, or a bad `%` is refused (08001); so is a word no setting takes, a port no number, and no user. */
test('a malformed URI or setting is refused', () => {
  for (const uri of [
    'other://a@b',
    'turborel://a@b/db',
    'turborel://a@b/?colour=red',
    'turborel://a@b/?tls_mode',
    'turborel://a%4@b',
    'turborel://a%FF@b',
  ]) {
    assert.throws(() => Options.fromUri(uri), unable, uri);
  }
  for (const uri of [
    'turborel://a@b/?tls_mode=always',
    'turborel://a@b:port',
    'turborel://a@b/?connect_timeout=-1',
    'turborel://b',
  ]) {
    assert.throws(() => Settings.resolveIn(Options.fromUri(uri), environment()), unable, uri);
  }
});

/** Verifies: [CLIENT Where settings come from] the program's setting prevails over the service's, the service's over the environment's, the environment's over the default; the environment names the service and its file; an empty variable gives nothing. */
test('settings are laid program, service, environment, default', () => {
  const file = scratch(
    'precedence',
    '# servers\n[prod]\nhost = prod-db\nport = 7500\ntls_mode = require\n\n[test]\nhost = test-db\n',
  );
  const env = environment([
    ['TURBOREL_SERVICE', 'prod'],
    ['TURBOREL_SERVICE_FILE', file],
    ['TURBOREL_USER', 'env-user'],
    ['TURBOREL_PORT', '7600'],
    ['TURBOREL_TLS_MODE', 'disable'],
    ['TURBOREL_APPLICATION_NAME', ''],
  ]);
  const explicit = new Options().set('tls_mode', 'verify-ca');
  const settings = Settings.resolveIn(explicit, env);
  assert.deepEqual(settings.hosts, [{ kind: 'tcp', name: 'prod-db', port: 7500 }], 'the service over the environment');
  assert.equal(settings.tlsMode, 'verify-ca', 'the program over the service');
  assert.equal(settings.user, 'env-user', 'the environment where the service says nothing');
  assert.equal(settings.applicationName, undefined);
  assert.equal(settings.channelBinding, 'prefer', 'the default');
  explicit.set('service', 'test');
  assert.deepEqual(
    Settings.resolveIn(explicit, env).hosts,
    [{ kind: 'tcp', name: 'test-db', port: 7600 }],
    'the program names the service',
  );
});

/** Verifies: [CLIENT The service file] a section's settings; a section not there, a setting before any section, a line without `=`, a key no setting, and a service or service file set by a service are refused, naming the line. */
test('a service file is read by section', () => {
  const options = service('[a]\nuser=ann\n[b]\nuser = bob\n  host =  h  \n', 'b', 'services.conf');
  assert.deepEqual([options.get('user'), options.get('host')], ['bob', 'h']);
  assert.throws(() => service('[a]\nuser=ann\n', 'b', 'services.conf'), /has no service b/u);
  const refused: [string, string][] = [
    ['user=ann\n', 'line 1: a setting comes before any section'],
    ['[a]\nuser\n', 'line 2: a setting is <key> = <value>'],
    ['[a]\ncolour=red\n', 'line 2: colour is no connection setting'],
    ['[a]\nservice=b\n', 'line 2: a service cannot set service'],
    ['[a\n', "line 1: a section's name ends with ]"],
  ];
  for (const [text, why] of refused) {
    assert.throws(
      () => service(text, 'a', 'services.conf'),
      (e: unknown) => unable(e) && (e as Error).message.includes(why),
      text,
    );
  }
});

/** Verifies: [CLIENT The password file] the password of the first line matching host, port and user, `*` any, `\` escaping; comments and short lines skipped; the settings' own password prevails; read only if a regular file. */
test('a password file matches by host, port and user', () => {
  const text =
    '# passwords\nshort:line\ndb1:7422:ann:first\n*:*:ann:any\\:host\ndb\\:2:*:bob:c:\\\\d\n\\*:1:carl:star\n';
  assert.equal(password(text, 'db1', '7422', 'ann'), 'first');
  assert.equal(password(text, 'db9', '1', 'ann'), 'any:host');
  assert.equal(password(text, 'db:2', '7', 'bob'), 'c:\\d');
  assert.equal(password(text, 'x', '1', 'carl'), undefined, 'an escaped * is a star');
  assert.equal(password(text, '*', '1', 'carl'), 'star');
  assert.equal(password(text, 'db1', '7422', 'nobody'), undefined);
  const file = scratch('passfile', text);
  const explicit = new Options().set('user', 'ann').set('passfile', file).set('host', 'db1');
  const settings = Settings.resolveIn(explicit, environment());
  assert.equal(settings.passwordFor({ kind: 'tcp', name: 'db1', port: 7422 }), 'first');
  const linked = join(dir, 'linked');
  // Windows makes a link only with a privilege a test runner may lack.
  if (process.platform === 'win32') writeFileSync(linked, text);
  else symlinkSync(file, linked);
  assert.equal(
    Settings.resolveIn(new Options().set('user', 'ann').set('passfile', linked), environment()).passwordFor({
      kind: 'tcp',
      name: 'db1',
      port: 7422,
    }),
    'first',
    'a link to a regular file',
  );
  assert.equal(
    Settings.resolveIn(new Options().set('user', 'ann').set('passfile', dir), environment()).passwordFor({
      kind: 'tcp',
      name: 'db1',
      port: 7422,
    }),
    undefined,
    'a directory is not read',
  );
  explicit.set('password', 'given');
  assert.equal(
    Settings.resolveIn(explicit, environment()).passwordFor({ kind: 'tcp', name: 'db1', port: 7422 }),
    'given',
  );
  rmSync(linked, { force: true });
  rmSync(file);
  assert.equal(
    settings.passwordFor({ kind: 'tcp', name: 'db1', port: 7422 }),
    undefined,
    'a file that cannot be read gives none',
  );
});

/** Verifies: [CLIENT Where settings come from] every variable of the environment gives its setting, and the words of each kind are read as named. */
test('the environment and words are read', () => {
  const options = Options.environment(environment(ENVIRONMENT.map(([name]) => [name, 'v'] as const)));
  assert.ok(ENVIRONMENT.every(([, key]) => options.get(key) === 'v'));
  assert.throws(
    () => Settings.resolveIn(new Options().set('user', 'u').set('target', 'primary'), environment()),
    (e: unknown) => unable(e) && (e as Error).message.includes('any, read-write, read-only'),
  );
  const both = new Options().set('host', 'a,b').set('port', '1,2').set('user', 'u').set('tls_system_roots', 'true');
  const settings = Settings.resolveIn(both, environment());
  assert.deepEqual(settings.hosts, [
    { kind: 'tcp', name: 'a', port: 1 },
    { kind: 'tcp', name: 'b', port: 2 },
  ]);
  assert.equal(settings.tls.systemRoots, true);
  const random = Settings.resolveIn(
    new Options().set('user', 'u').set('load_balance', 'random').set('channel_binding', 'require'),
    environment(),
  );
  assert.deepEqual([random.loadBalance, random.channelBinding], ['random', 'require']);
  assert.ok(new Options().isEmpty);
});

/** Verifies: [CLIENT Where settings come from] hosts with an empty one, a bracket not closed or a port no number, ports with one no number, and a word no setting takes are refused (08001); several hosts of one port each take it; a service file unread is refused. */
test('malformed hosts and words are refused', () => {
  const resolved = (pairs: readonly (readonly [string, string])[]): unknown => {
    const options = new Options().set('user', 'u');
    for (const [key, value] of pairs) options.set(key, value);
    return Settings.resolveIn(options, environment()).hosts;
  };
  for (const host of ['a,,b', '[::1', '[::1]:x', 'a:70000'])
    assert.throws(() => resolved([['host', host]]), unable, host);
  assert.throws(
    () =>
      resolved([
        ['host', 'a'],
        ['port', '1,x'],
      ]),
    unable,
  );
  for (const key of ['channel_binding', 'target', 'load_balance', 'tls_system_roots']) {
    assert.throws(() => resolved([[key, 'sometimes']]), unable, key);
  }
  assert.deepEqual(
    resolved([
      ['host', 'a,b,[::1]'],
      ['port', '9'],
    ]),
    [
      { kind: 'tcp', name: 'a', port: 9 },
      { kind: 'tcp', name: 'b', port: 9 },
      { kind: 'tcp', name: '::1', port: 9 },
    ],
  );
  assert.deepEqual(
    resolved([['host', 'fe80::1']]),
    [{ kind: 'tcp', name: 'fe80::1', port: DEFAULT_PORT }],
    'unbracketed IPv6',
  );
  assert.throws(
    () =>
      Settings.resolveIn(
        new Options().set('service', 's'),
        environment([['TURBOREL_SERVICE_FILE', join(dir, 'none')]]),
      ),
    unable,
  );
});

/** Verifies: [CLIENT The password file] a Unix socket is matched by its path and the default port. */
test('a password file matches a local socket by its path', () => {
  const file = scratch('passfile-local', `/run/s.sock:${String(DEFAULT_PORT)}:ann:local\n`);
  const settings = Settings.resolveIn(new Options().set('user', 'ann').set('passfile', file), environment());
  assert.equal(settings.passwordFor({ kind: 'local', path: '/run/s.sock' }), 'local');
});

/** Verifies: [CLIENT Several servers] hosts ordered at random are each once, in an order the seed decides; of one server tried its own failure is given; of several 08001 names each and why, 28000 where the last refused the user. */
test('hosts shuffled, and no server kept', () => {
  const order = (seed: bigint): number[] => {
    const hosts = [0, 1, 2, 3, 4, 5, 6, 7];
    shuffle(hosts, seed);
    return hosts;
  };
  assert.deepEqual([...order(7n)].sort(), [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(order(7n), order(7n));
  assert.ok(new Set(Array.from({ length: 16 }, (_, i) => order(BigInt(i)).join())).size > 8);
  const lost = connectionFailure('cannot connect');
  const refused = new TurborelError(-919, '28000', 'no');
  assert.equal(noneKept([['a', refused]]).sqlstate, '28000');
  const both = noneKept([
    ['a', refused],
    ['b', lost],
  ]);
  assert.equal(both.sqlstate, '08001');
  assert.ok(both.message.includes('a: no') && both.message.includes('b: cannot connect'), both.message);
  assert.equal(
    noneKept([
      ['b', lost],
      ['a', refused],
    ]).sqlstate,
    '28000',
  );
  assert.equal(noneKept([]).sqlstate, '08001');
  assert.deepEqual([roleTold('YES'), roleTold('NO')], ['read-only', 'read-write']);
});
