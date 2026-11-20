/**
 * Tests of connecting by settings against scripted servers on loopback:
 * `prefer` connecting again without TLS, the connect timeout, and a role
 * read from INFORMATION_SCHEMA.REPLICAS where no status tells it
 * (RULES.md R-TEST-1).
 */

import assert from 'node:assert/strict';
import { type AddressInfo, type Server, type Socket, createServer } from 'node:net';
import { after, test } from 'node:test';

import { REQUEST } from '../../src/codec/kinds.js';
import { TurborelError } from '../../src/error.js';
import { role } from '../../src/settings/failover.js';
import { Options } from '../../src/settings/options.js';
import { Settings } from '../../src/settings/settings.js';
import { Peer } from '../support/fake-server.js';
import { isFailure } from '../support/failures.js';

const servers: Server[] = [];
const sockets: Socket[] = [];

after(async () => {
  for (const s of sockets) s.destroy();
  await Promise.all(servers.map((s) => new Promise((resolve) => s.close(resolve))));
});

/**
 * A server on loopback whose connections `handle` takes.
 *
 * @param handle - what each connection is answered with
 * @returns its port
 */
async function listen(handle: (socket: Socket, n: number) => void): Promise<number> {
  let n = 0;
  const server = createServer((socket) => {
    sockets.push(socket);
    socket.on('error', () => undefined);
    n += 1;
    handle(socket, n);
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return (server.address() as AddressInfo).port;
}

/**
 * A peer answered as a server of no TLS and no status: Ready, then `then`.
 *
 * @param socket - the connection
 * @param then - what follows the login
 */
function serve(socket: Socket, then: (peer: Peer) => Promise<void> = () => Promise.resolve()): void {
  const peer = new Peer(socket);
  void (async () => {
    await peer.frame();
    peer.ready(['notices']);
    await then(peer);
  })().catch(() => undefined);
}

/**
 * The settings of `uri`, read with no environment.
 *
 * @param uri - the URI
 * @returns the settings
 */
function settings(uri: string): Settings {
  return Settings.resolveIn(Options.fromUri(uri), () => undefined);
}

/** Verifies: [CLIENT TLS by mode] under `prefer`, a server reached whose TLS handshake fails is connected to again over plain TCP. */
test('prefer connects again without TLS', async () => {
  const port = await listen((socket, n) => {
    if (n === 2) serve(socket);
    else socket.once('data', () => socket.destroy());
  });
  const conn = await settings(`turborel://ann@127.0.0.1:${String(port)}`).connect();
  assert.deepEqual([conn.authorization, conn.target?.kind], ['ANN', 'tcp']);
  conn.destroy();
  await assert.rejects(
    settings(`turborel://ann@127.0.0.1:${String(port)}/?tls_mode=require`).connect(),
    isFailure(-919, '08006'),
  );
});

/** Verifies: [CLIENT Several servers] each step of connecting waits at most the connect timeout. */
test('the connect timeout', async () => {
  const port = await listen(() => undefined);
  const began = Date.now();
  await assert.rejects(
    settings(`turborel://ann@127.0.0.1:${String(port)}/?tls_mode=disable&connect_timeout=1`).connect(),
    isFailure(-919, '08006'),
  );
  assert.ok(Date.now() - began < 5000);
});

/** Verifies: [CLIENT Several servers] a server that tells no SERVER_READ_ONLY has its role read from INFORMATION_SCHEMA.REPLICAS: PRIMARY read-write, another read-only, no row unknown, no table a server alone. */
test('a role read from REPLICAS', async () => {
  const answers: ((peer: Peer) => void)[] = [
    (peer) => {
      peer.description([{ name: 'ROLE', type: { kind: 'varying', length: 10, units: 'characters' }, notNull: false }]);
      peer.rows([['PRIMARY']]);
      peer.complete();
    },
    (peer) => {
      peer.description([{ name: 'ROLE', type: { kind: 'varying', length: 10, units: 'characters' }, notNull: false }]);
      peer.rows([['BACKUP ']]);
      peer.complete();
    },
    (peer) => {
      peer.description([{ name: 'ROLE', type: { kind: 'varying', length: 10, units: 'characters' }, notNull: false }]);
      peer.complete();
    },
    (peer) => {
      peer.error(new TurborelError(-103, '42000', 'no table REPLICAS'));
    },
    (peer) => {
      peer.error(new TurborelError(-301, '22000', 'no role to give'));
    },
  ];
  let i = 0;
  const port = await listen((socket) => {
    const answer = answers[i];
    i += 1;
    serve(socket, async (peer) => {
      const frame = await peer.frame();
      assert.equal(frame.kind, REQUEST.QUERY);
      answer?.(peer);
    });
  });
  const uri = `turborel://ann@127.0.0.1:${String(port)}/?tls_mode=disable`;
  const seen = [];
  for (let n = 0; n < 4; n += 1) {
    const conn = await settings(uri).connect();
    seen.push(await role(conn));
    assert.equal(conn.autocommit, false, 'autocommit as it was');
    conn.destroy();
  }
  assert.deepEqual(seen, ['read-write', 'read-only', 'unknown', 'read-write']);
  await assert.rejects(settings(`${uri}&target=read-only`).connect(), isFailure(-301, '22000'), "the query's failure");
});
