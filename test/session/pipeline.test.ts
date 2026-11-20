/**
 * Tests of a pipeline against a scripted server on loopback that answers
 * each request in turn, refusing a statement that names `bad`
 * (RULES.md R-TEST-1).
 */

import assert from 'node:assert/strict';
import { after, test } from 'node:test';

import { Trust } from '../../src/auth/mechanism.js';
import { REQUEST } from '../../src/codec/kinds.js';
import { Reader } from '../../src/codec/reader.js';
import { TurborelError } from '../../src/error.js';
import { connectTo } from '../../src/session/connect.js';
import type { Connection } from '../../src/session/connection.js';
import { type Peer, type Scripted, scripted } from '../support/fake-server.js';
import { isConnectionFailure } from '../support/failures.js';

const servers: Scripted[] = [];

after(async () => {
  await Promise.all(servers.map((s) => s.close()));
});

/**
 * A connection to a server that answers each request, and the statements it was sent.
 *
 * @param granted - the capabilities it grants
 * @param lose - a statement whose text makes the server close
 * @returns the connection, and the statements seen
 */
async function server(granted: readonly string[] = [], lose = 'lose'): Promise<[Connection, string[]]> {
  const seen: string[] = [];
  const s = await scripted(async (peer: Peer) => {
    await peer.frame();
    peer.ready(granted);
    let active = false;
    for (;;) {
      const frame = await peer.frame();
      const r = new Reader(frame.body, 'request');
      const sql = frame.kind === REQUEST.QUERY ? r.string() : String.fromCharCode(frame.kind);
      seen.push(sql);
      if (sql.includes(lose)) {
        peer.end();
        return;
      }
      if (sql.includes('bad')) peer.error(new TurborelError(-201, '23000', 'refused', { active }));
      else {
        active = !(sql === 'COMMIT' || sql.startsWith('ROLLBACK') || frame.kind === REQUEST.DEALLOCATE);
        peer.complete({ active });
      }
    }
  });
  servers.push(s);
  return [await connectTo(s.target, 'ann', new Trust()), seen];
}

/** Verifies: [CLIENT Pipelines] every request runs, a failure its own outcome; releases closed and destroyed. */
test('a pipeline continues past a failure', async () => {
  const [conn, seen] = await server();
  const ran = await conn.pipeline().query('a').query('bad').query('c').release(4).run();
  assert.deepEqual(
    ran.map((p) => p.kind),
    ['done', 'failed', 'done', 'done', 'done'],
  );
  assert.deepEqual(seen, ['a', 'bad', 'c', 'C', 'D']);
  conn.destroy();
});

/** Verifies: [CLIENT Pipelines] skip: savepoints set, those after a failure rolled back and skipped, the first released, committed under autocommit. */
test('a pipeline skips after a failure', async () => {
  const [conn, seen] = await server();
  conn.setAutocommit(true);
  const ran = await conn.pipeline().onError('skip').query('a').query('bad').query('c').run();
  assert.deepEqual(
    ran.map((p) => p.kind),
    ['done', 'failed', 'skipped'],
  );
  assert.deepEqual(seen, [
    'a',
    'SAVEPOINT TURBOREL_PIPELINE_1',
    'bad',
    'SAVEPOINT TURBOREL_PIPELINE_2',
    'c',
    'ROLLBACK TO SAVEPOINT TURBOREL_PIPELINE_2',
    'RELEASE SAVEPOINT TURBOREL_PIPELINE_1',
    'COMMIT',
  ]);
  conn.destroy();
});

/** Verifies: [CLIENT Pipelines] run fails with 08006 once the connection is lost, no outcome given. */
test('a pipeline on a connection lost', async () => {
  const [conn] = await server();
  await assert.rejects(conn.pipeline().query('a').query('lose').query('c').run(), isConnectionFailure);
  assert.equal(conn.isLost, true);
});

/** Verifies: [CLIENT Pools] a connection of a server without Reset given back by one pipeline: rolled back, its statements released, its user, schema and zone those of its login, then the pool's statements. */
test('given back without Reset', async () => {
  const [conn, seen] = await server();
  await conn.giveBack(['SET X']);
  assert.deepEqual(seen, [
    'ROLLBACK',
    `SET SESSION AUTHORIZATION '"ANN"'`,
    `SET SCHEMA '"ANN"'`,
    'SET TIME ZONE LOCAL',
    'SET X',
  ]);
  await assert.rejects(conn.giveBack(['bad']), (e: unknown) => e instanceof TurborelError && e.sqlstate === '23000');
  conn.destroy();
  await assert.rejects(conn.giveBack(), isConnectionFailure, 'a lost connection is not given back');
});
