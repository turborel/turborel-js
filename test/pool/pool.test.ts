/**
 * Tests of a pool, the agent's statements and a pipeline's windows, with
 * connections of the tests' own making (RULES.md R-TEST-2).
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Agent, connectionStatement, identifierOf } from '../../src/agent/agent.js';
import { DEFAULT_IDLE_TIMEOUT, DEFAULT_MAX, DEFAULT_MAX_LIFETIME, DEFAULT_WAIT, Pool } from '../../src/pool/pool.js';
import type { Connection } from '../../src/session/connection.js';
import { PIPELINE_WINDOW, type Queued, windows } from '../../src/session/pipeline.js';
import { tokens } from '../../src/sql/lexer.js';
import { TurborelError, connectionFailure } from '../../src/error.js';
import { isFailure } from '../support/failures.js';

/** A connection of the tests' making: what a pool and an agent ask of one. */
class Fake {
  isLost = false;
  readTimeout: number | undefined;
  answers = true;
  resets = true;
  destroyed = false;
  inTransaction = false;
  failsTerminate = false;
  readonly given: string[][] = [];

  has(): boolean {
    return true;
  }

  setReadTimeout(ms: number | undefined): void {
    this.readTimeout = ms;
  }

  ping(): Promise<void> {
    return this.answers ? Promise.resolve() : Promise.reject(connectionFailure('gone'));
  }

  giveBack(more: readonly string[]): Promise<void> {
    this.given.push([...more]);
    return this.resets ? Promise.resolve() : Promise.reject(connectionFailure('no reset'));
  }

  destroy(): void {
    this.destroyed = true;
  }

  terminate(): Promise<void> {
    return this.failsTerminate ? Promise.reject(connectionFailure('gone')) : Promise.resolve();
  }
}

/**
 * A fake as a connection.
 *
 * @param fake - the fake
 * @returns it, as a connection
 */
function asConnection(fake: Fake): Connection {
  return fake as unknown as Connection;
}

/** Verifies: [CLIENT Pools] the defaults: 10 at most, 10 idle, ten minutes idle, an hour's life, 30 seconds' wait. */
test("a pool's defaults", () => {
  assert.deepEqual(
    [DEFAULT_MAX, DEFAULT_IDLE_TIMEOUT, DEFAULT_MAX_LIFETIME, DEFAULT_WAIT],
    [10, 600_000, 3_600_000, 30_000],
  );
});

/** Verifies: [CLIENT Pools] one idle past its timeout, or failing its check, closed as get meets it; one failing its reset, past its life or beyond max idle closed as it comes back; a failure to make one is get's. */
test('a pool closes what it cannot hand out', async () => {
  const made: Fake[] = [];
  let failing = false;
  const pool = new Pool(
    () => {
      if (failing) return Promise.reject(new TurborelError(-919, '08001', 'no server'));
      const fake = new Fake();
      made.push(fake);
      return Promise.resolve(asConnection(fake));
    },
    { max: 3, maxIdle: 1, idleTimeout: 30, reset: ['SET TIME ZONE LOCAL'] },
  );
  const [a, b] = [await pool.get(), await pool.get()];
  await a.release();
  await b.release();
  assert.deepEqual(pool.counts, { made: 1, idle: 1 }, 'beyond max idle closed');
  assert.equal(made[1]?.destroyed, true);
  assert.deepEqual(made[0]?.given, [['SET TIME ZONE LOCAL']]);
  await new Promise((resolve) => setTimeout(resolve, 40));
  const c = await pool.get();
  assert.equal(made.at(0)?.destroyed, true, 'idle past its timeout');
  const fake = made[2];
  assert.ok(fake !== undefined);
  fake.resets = false;
  await c.release();
  assert.deepEqual([fake.destroyed, pool.counts.made], [true, 0], 'its reset failed');
  const d = await pool.get();
  await d.release();
  const checked = made[3];
  assert.ok(checked !== undefined);
  checked.answers = false;
  const e = await pool.get();
  assert.equal(checked.destroyed, true, 'failing its check');
  await e.release();
  failing = true;
  const idle = made[4];
  assert.ok(idle !== undefined);
  idle.isLost = true;
  await assert.rejects(pool.get(), isFailure(-919, '08001'), "the source's failure");
  assert.deepEqual(pool.counts, { made: 0, idle: 0 });
});

/** Verifies: [CLIENT Pools] a connection past its lifetime is closed as it comes back; with no limits, kept. */
test('lifetimes', async () => {
  const lived = new Pool(() => Promise.resolve(asConnection(new Fake())), { maxLifetime: 0, check: false });
  const old = await lived.get();
  await old.release();
  assert.deepEqual(lived.counts, { made: 0, idle: 0 }, 'past its life');
  const unbounded = new Pool(() => Promise.resolve(asConnection(new Fake())), {
    idleTimeout: undefined,
    maxLifetime: undefined,
  });
  await (await unbounded.get()).release();
  assert.deepEqual(unbounded.counts, { made: 1, idle: 1 });
});

/** Verifies: [CLIENT Pools] get waits for a connection to come back, each wait its own, and fails with 08001 past wait. */
test('a pool waits', async () => {
  const pool = new Pool(() => Promise.resolve(asConnection(new Fake())), { max: 1, wait: 50 });
  const held = await pool.get();
  const waiting = pool.get();
  setTimeout(() => void held.release(), 10);
  const got = await waiting;
  assert.equal(got.connection, held.connection);
  await assert.rejects(pool.get(), isFailure(-919, '08001'));
  await got.release();
  const zero = new Pool(() => Promise.resolve(asConnection(new Fake())), { max: 0, wait: 0 });
  await assert.rejects(zero.get(), isFailure(-919, '08001'));
});

/** Verifies: [PROTOCOL Requests] requests are written a window of at most 64 KiB at a time, in order, a longer one alone in its own. */
test("a pipeline's windows", () => {
  const q = (sql: string): Queued => ({ kind: 'query', sql });
  const queued = [q('a'), q('VALUES 1'), q('x'.repeat(PIPELINE_WINDOW / 2)), q('y'.repeat(PIPELINE_WINDOW)), q('z')];
  assert.deepEqual(
    windows(queued, false, []).map((w) => w.length),
    [3, 1, 1],
  );
  assert.deepEqual(windows([], false, []), []);
});

/** Verifies: [CLIENT The SQL-agent] connection statements read as SQL-92 writes them; another statement is none; a value is a character string literal. */
test("the agent's statements", () => {
  assert.deepEqual(connectionStatement("CONNECT TO 'db' AS 'c1' USER 'ann'"), {
    kind: 'connect',
    server: 'db',
    name: 'c1',
    user: 'ann',
  });
  assert.deepEqual(connectionStatement('connect to default'), { kind: 'connectDefault' });
  assert.deepEqual(connectionStatement("SET CONNECTION 'c1'"), { kind: 'set', name: 'c1' });
  assert.deepEqual(connectionStatement('SET CONNECTION DEFAULT'), { kind: 'set' });
  for (const [sql, object] of [
    ['DISCONNECT ALL', 'all'],
    ['DISCONNECT CURRENT', 'current'],
    ['DISCONNECT DEFAULT', 'default'],
  ] as const) {
    assert.deepEqual(connectionStatement(sql), { kind: 'disconnect', object });
  }
  assert.deepEqual(
    connectionStatement("DISCONNECT '  c1  '"),
    { kind: 'disconnect', object: { name: 'c1' } },
    'spaces trimmed',
  );
  assert.equal(connectionStatement('SET SCHEMA ANN'), undefined);
  assert.equal(connectionStatement('VALUES 1'), undefined);
  assert.throws(() => connectionStatement('CONNECT db'), isFailure(-102, '2A000'));
  assert.throws(() => connectionStatement("CONNECT TO 'a' 'b'"), isFailure(-102, '2A000'));
  assert.throws(() => connectionStatement('CONNECT TO'), isFailure(-102, '2A000'));
  assert.throws(() => connectionStatement('CONNECT TO 7'), isFailure(-103, '2A000'));
  assert.throws(() => connectionStatement('CONNECT TO :host'), isFailure(-900, '0A000'));
  assert.deepEqual(
    [identifierOf('ann'), identifierOf('"Mixed"'), identifierOf('first'), identifierOf('a b')],
    ['ANN', 'Mixed', undefined, undefined],
  );
  assert.deepEqual(tokens("'a''b'\n  'c' -- more\n'd' 'e'"), [
    { kind: 'string', text: "a'bcd" },
    { kind: 'string', text: 'e' },
  ]);
  assert.deepEqual(tokens("'open"), [{ kind: 'other' }]);
});

/** Verifies: [CLIENT The SQL-agent] a connector that cannot connect gives 08001, one refused 08004; a DISCONNECT whose end failed warns 01002; a connection's transaction active refuses it (25000). */
test("the agent's failures", async () => {
  const fakes: Fake[] = [];
  let refusal: TurborelError | undefined;
  const agent = new Agent({
    connect: () => {
      if (refusal !== undefined) return Promise.reject(refusal);
      const fake = new Fake();
      fakes.push(fake);
      return Promise.resolve(asConnection(fake));
    },
  });
  refusal = connectionFailure('cannot connect');
  await assert.rejects(agent.query("CONNECT TO 'a'"), isFailure(-919, '08001'));
  refusal = new TurborelError(-919, '28000', 'no');
  await assert.rejects(agent.query("CONNECT TO 'a'"), isFailure(-919, '08004'));
  refusal = undefined;
  await agent.query('CONNECT TO DEFAULT');
  await assert.rejects(agent.query('CONNECT TO DEFAULT'), isFailure(-919, '08002'));
  await assert.rejects(agent.query("CONNECT TO 'a b'"), isFailure(-919, '2E000'));
  await agent.query("CONNECT TO 'b'");
  await assert.rejects(
    agent.query('DISCONNECT DEFAULT').then(() => agent.query('DISCONNECT DEFAULT')),
    isFailure(-919, '08003'),
  );
  const [, b] = fakes;
  assert.ok(b !== undefined);
  b.inTransaction = true;
  await assert.rejects(agent.query('DISCONNECT ALL'), isFailure(-917, '25000'));
  b.inTransaction = false;
  b.failsTerminate = true;
  const warned = await agent.query("DISCONNECT 'b'");
  assert.equal(warned.kind === 'done' && warned.completion.sqlstate, '01002');
  await assert.rejects(agent.query('DISCONNECT CURRENT'), isFailure(-919, '08003'));
  assert.equal(agent.warning, undefined);
  assert.equal(agent.canceller(), undefined);
  await agent.query('CONNECT TO DEFAULT');
  await agent.query('SET CONNECTION DEFAULT');
  const last = fakes[2];
  assert.ok(last !== undefined);
  last.failsTerminate = true;
  await assert.rejects(agent.terminate(), isFailure(-919, '08006'));
  const begun = new Agent({ connect: () => Promise.reject(new Error('unused')) }, asConnection(new Fake()));
  assert.equal(begun.currentName, undefined);
  await begun.terminate();
});
