/**
 * Live tests of connecting by settings, against the server
 * TURBOREL_TEST_SERVER names (RULES.md R-TEST-8): the URI, the files, TLS
 * by mode and channel binding, several servers and roles, and the key
 * cache settings share.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

import type { Connection } from '../../src/session/connection.js';
import { role } from '../../src/settings/failover.js';
import { Options } from '../../src/settings/options.js';
import { Settings } from '../../src/settings/settings.js';
import { PORT, USERS, makePki } from '../server/server.js';
import { isFailure } from '../support/failures.js';
import { live, liveServer } from '../support/live.js';

liveServer();

const scratch = mkdtempSync(join(tmpdir(), 'turborel-js-settings-live-'));
after(() => {
  rmSync(scratch, { recursive: true, force: true });
});

/** The server's TCP address, as a URI's host writes it. */
const AT = `127.0.0.1:${String(PORT)}`;

/**
 * The settings of `uri`, read with no environment.
 *
 * @param uri - the URI
 * @returns the settings
 */
function settings(uri: string): Settings {
  return Settings.resolveIn(Options.fromUri(uri), () => undefined);
}

/**
 * The value of one row's one column a query gives.
 *
 * @param conn - the connection
 * @param sql - the query
 * @returns its value
 */
async function single(conn: Connection, sql: string): Promise<unknown> {
  const outcome = await conn.query(sql);
  return outcome.kind === 'rows' ? outcome.rows[0]?.[0] : undefined;
}

/** Verifies: [CLIENT Connecting by settings] a URI's settings connect: trust over a Unix socket, which no TLS secures; a password by SCRAM over TLS, bound; the program named as the attribute `application`, which the owner sees. */
test('connecting by a URI', async (t) => {
  const s = live(t);
  if (s === undefined) return;
  const local = await settings(`turborel://ann@${encodeURIComponent(s.socket)}/?tls_mode=require`).connect();
  assert.deepEqual([local.authorization, local.target?.kind], ['ANN', 'local']);
  await local.terminate();
  const uri = `turborel://ann:${USERS.ann}@${AT}/?tls_mode=require&application_name=reports`;
  const secured = await settings(uri).connect();
  assert.deepEqual([secured.authorization, secured.target?.kind], ['ANN', 'tls']);
  const attribute =
    "SELECT ATTRIBUTE_VALUE FROM INFORMATION_SCHEMA.CONNECTION_ATTRIBUTES WHERE ATTRIBUTE_NAME = 'application'";
  assert.equal(await single(secured, attribute), 'reports');
  await secured.terminate();
});

/** Verifies: [CLIENT TLS by mode] `prefer` takes TLS where the server does; `disable` none, refusing a password in the clear; `verify-full` checks the name, `verify-ca` the authority alone; an authority not trusted is refused. */
test('TLS by mode', async (t) => {
  const s = live(t);
  if (s === undefined) return;
  const ca = encodeURIComponent(s.pki.ca);
  const preferred = await settings(`turborel://ann@${AT}`).connect();
  assert.equal(preferred.target?.kind, 'tls', 'prefer, by default');
  await preferred.terminate();
  const plain = await settings(`turborel://ann@${AT}/?tls_mode=disable`).connect();
  assert.equal(plain.target?.kind, 'tcp');
  await plain.terminate();
  await assert.rejects(settings(`turborel://bob:x@${AT}/?tls_mode=disable`).connect(), isFailure(-919, '28000'));
  const full = await settings(
    `turborel://ann@localhost:${String(PORT)}/?tls_mode=verify-full&tls_roots=${ca}`,
  ).connect();
  assert.equal(full.target?.kind, 'tls');
  await full.terminate();
  const named = `turborel://ann@${AT}/?tls_roots=${ca}&server_name=wrong.example&tls_mode=`;
  await assert.rejects(settings(`${named}verify-full`).connect(), /handshake/u, 'the name checked');
  const any = await settings(`${named}verify-ca`).connect();
  assert.equal(any.target?.kind, 'tls', 'the name not checked');
  await any.terminate();
  const other = makePki(mkdtempSync(join(scratch, 'other-')));
  const untrusted = `turborel://ann@${AT}/?tls_mode=verify-ca&tls_roots=${encodeURIComponent(other.ca)}`;
  await assert.rejects(settings(untrusted).connect(), /handshake/u);
  await assert.rejects(
    settings(`turborel://ann@${AT}/?tls_mode=verify-full`).connect(),
    isFailure(-919, '08006'),
    'no authority',
  );
});

/** Verifies: [CLIENT TLS by mode] `channel_binding=require` refuses before any connection settings whose mechanism binds nothing, and takes SCRAM over TLS. */
test('channel binding required', async (t) => {
  if (live(t) === undefined) return;
  await assert.rejects(settings(`turborel://ann@${AT}/?channel_binding=require`).connect(), isFailure(-919, '28000'));
  const bound = await settings(`turborel://bob:${USERS.bob}@${AT}/?channel_binding=require&tls_mode=require`).connect();
  assert.equal(bound.authorization, 'BOB');
  await bound.terminate();
});

/** Verifies: [CLIENT TLS by mode] settings naming a certificate and its key present them, the user proved by it; one without its key is refused, saying so. */
test('a client certificate by settings', async (t) => {
  const s = live(t);
  if (s === undefined) return;
  const [chain, key] = [encodeURIComponent(s.pki.clientCert), encodeURIComponent(s.pki.clientKey)];
  const base = `turborel://ann@${AT}/?tls_mode=require&tls_certificate=${chain}`;
  const proved = await settings(`${base}&tls_key=${key}`).connect();
  assert.equal(proved.authorization, 'ANN');
  await proved.terminate();
  await assert.rejects(settings(base).connect(), /presented with its key, and none is named/u);
  await assert.rejects(settings(`${base}&tls_key=${encodeURIComponent(join(scratch, 'none.pem'))}`).connect());
});

/** Verifies: [CLIENT The password file] [CLIENT The service file] a password the settings do not give is the password file's; a service names the settings; one key cache serves every connection the settings make. */
test('the files, and the key cache', async (t) => {
  if (live(t) === undefined) return;
  const passfile = join(scratch, 'pass');
  writeFileSync(passfile, `# test\n127.0.0.1:${String(PORT)}:bob:${USERS.bob}\n`);
  const services = join(scratch, 'services.conf');
  writeFileSync(services, `[live]\nhost = ${AT}\nuser = bob\ntls_mode = require\npassfile = ${passfile}\n`);
  const named = Settings.resolveIn(new Options().set('service', 'live').set('service_file', services), () => undefined);
  for (let i = 0; i < 2; i += 1) {
    const conn = await named.connect();
    assert.equal(conn.authorization, 'BOB');
    await conn.terminate();
  }
  assert.deepEqual(named.keyCache.lookups(), { hits: 1, misses: 1 }, 'the second login took the first one keys');
});

/** Verifies: [CLIENT Several servers] hosts tried in turn, one unreachable passed; none kept, each named and why; `target` keeps a server of the role asked, told by SERVER_READ_ONLY. */
test('several servers and roles', async (t) => {
  if (live(t) === undefined) return;
  const kept = await settings(`turborel://ann@127.0.0.1:1,${AT}/?tls_mode=disable&target=read-write`).connect();
  assert.equal(await role(kept), 'read-write');
  assert.equal(await single(kept, 'VALUES 1'), 1n);
  await kept.terminate();
  await assert.rejects(settings(`turborel://ann@127.0.0.1:1,127.0.0.1:2/?tls_mode=disable`).connect(), (e: unknown) => {
    assert.ok(isFailure(-919, '08001')(e));
    const message = (e as Error).message;
    return message.includes('127.0.0.1 (127.0.0.1:1)') && message.includes('127.0.0.1 (127.0.0.1:2)');
  });
  await assert.rejects(settings(`turborel://ann@${AT}/?tls_mode=disable&target=read-only`).connect(), (e: unknown) => {
    assert.ok(isFailure(-919, '08001')(e));
    return (e as Error).message === 'the server is read-write, and read-only is asked';
  });
  const balanced = settings(`turborel://ann@127.0.0.1:1,${AT}/?tls_mode=disable&load_balance=random`);
  for (let i = 0; i < 4; i += 1) await (await balanced.connect()).terminate();
});
