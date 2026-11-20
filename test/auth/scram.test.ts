/**
 * Tests of SCRAM-SHA-256: RFC 7677's test vector, the exchange's checks of
 * the server, the channel bindings, and the key cache (RULES.md R-TEST-9).
 */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';

import { endPoint } from '../../src/auth/end-point.js';
import { KEY_CACHE_ENTRIES, KeyCache } from '../../src/auth/key-cache.js';
import { Scram } from '../../src/auth/scram.js';
import { ScramClient, decode64, deriveKeys } from '../../src/auth/scram-exchange.js';
import { isFailure } from '../support/failures.js';

const UTF8 = new TextEncoder();
const text = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);

/** RFC 7677 §3's exchange, user "user" and password "pencil". */
const VECTOR = {
  nonce: 'rOprNGfwEbeRWgbNEkqO',
  serverFirst: 'r=rOprNGfwEbeRWgbNEkqO%hvYDpWUa2RaTCAfuxFIlj)hNlF$k0,s=W22ZaJ0SNY7soEsUEjb6gQ==,i=4096',
  clientFinal:
    'c=biws,r=rOprNGfwEbeRWgbNEkqO%hvYDpWUa2RaTCAfuxFIlj)hNlF$k0,p=dHzbZapWIk4jUhN+Ute9ytag9zjfMHgsqmmiz7AndVQ=',
  serverFinal: 'v=6rriTRBi23WpRR/wtup+mMhUZUn/dB5nLTJRsjl95G4=',
};

const refused = isFailure(-919, '28000');

/** Verifies: [PROTOCOL Mechanisms] [RFC 7677 §3] the exchange of RFC 7677's test vector, byte for byte, the server's signature checked. */
test("RFC 7677's test vector", async () => {
  const client = new ScramClient({ kind: 'unbound' }, 'user');
  assert.equal(text(client.first(VECTOR.nonce)), `n,,n=user,r=${VECTOR.nonce}`);
  const first = client.read(UTF8.encode(VECTOR.serverFirst));
  assert.equal(first.iterations, 4096);
  const keys = await deriveKeys('pencil', first.salt, first.iterations);
  assert.equal(text(client.prove(first, keys)), VECTOR.clientFinal);
  assert.equal(client.verified, false);
  client.verify(UTF8.encode(VECTOR.serverFinal));
  assert.equal(client.verified, true);
});

/**
 * An exchange of RFC 7677's vector, client-first sent.
 *
 * @returns it
 */
function begun(): ScramClient {
  const c = new ScramClient({ kind: 'unbound' }, 'user');
  c.first(VECTOR.nonce);
  return c;
}

/** Verifies: [PROTOCOL Mechanisms] [RFC 5802 §7] server-first is refused if its nonce, salt or iterations are wrong, or it comes out of turn. */
test('server-first is checked', () => {
  const bad = [
    'r=other%x,s=W22ZaJ0SNY7soEsUEjb6gQ==,i=4096',
    `r=${VECTOR.nonce},s=W22ZaJ0SNY7soEsUEjb6gQ==,i=4096`,
    `r=${VECTOR.nonce}x,s=not base 64,i=4096`,
    `r=${VECTOR.nonce}x,s=W22ZaJ0SNY7soEsUEjb6gQ==,i=0`,
    `r=${VECTOR.nonce}x,s=W22ZaJ0SNY7soEsUEjb6gQ==,i=4096,x=1`,
    `s=W22ZaJ0SNY7soEsUEjb6gQ==`,
    `r=${VECTOR.nonce}x`,
  ];
  for (const message of bad) assert.throws(() => begun().read(UTF8.encode(message)), refused, message);
  assert.throws(() => begun().read(Uint8Array.of(0xff)), refused, 'not UTF-8');
  const unsent = new ScramClient({ kind: 'unbound' });
  assert.throws(() => unsent.read(UTF8.encode(VECTOR.serverFirst)), refused, 'out of turn');
});

/** Verifies: [PROTOCOL Mechanisms] [RFC 5802 §7] server-final is refused if its signature is wrong, it refuses, or it comes out of turn. */
test('server-final is checked', async () => {
  const proved = begun();
  const first = proved.read(UTF8.encode(VECTOR.serverFirst));
  proved.prove(first, await deriveKeys('pencil', first.salt, first.iterations));
  const finals: [string, string][] = [
    ['v=7rriTRBi23WpRR/wtup+mMhUZUn/dB5nLTJRsjl95G4=', 'a wrong signature'],
    ['e=invalid-proof', 'refused'],
    ['v=***', 'not base 64'],
  ];
  for (const [message, why] of finals) {
    assert.throws(
      () => {
        proved.verify(UTF8.encode(message));
      },
      refused,
      why,
    );
  }
  assert.throws(
    () => {
      begun().verify(UTF8.encode(VECTOR.serverFinal));
    },
    refused,
    'out of turn',
  );
});

/** Verifies: [PROTOCOL Mechanisms] a bound exchange names its binding in its GS2 header, which client-final carries with the channel's data. */
test('channel bindings are named and carried', async () => {
  const data = Uint8Array.of(1, 2, 3);
  for (const [channel, gs2] of [
    [{ kind: 'exporter', data }, 'p=tls-exporter,,'],
    [{ kind: 'endPoint', data }, 'p=tls-server-end-point,,'],
    [{ kind: 'unoffered' }, 'y,,'],
  ] as const) {
    const client = new ScramClient(channel);
    assert.ok(text(client.first('abc')).startsWith(`${gs2}n=,r=abc`));
    const first = client.read(UTF8.encode('r=abcdef,s=AAAA,i=1'));
    const final = text(client.prove(first, await deriveKeys('p', first.salt, 1)));
    const carried = decode64(final.slice(2, final.indexOf(',')));
    assert.deepEqual(carried, Uint8Array.from([...UTF8.encode(gs2), ...('data' in channel ? channel.data : [])]));
  }
  assert.equal(new ScramClient({ kind: 'exporter', data }).bound, true);
  assert.equal(new ScramClient({ kind: 'unoffered' }).bound, false);
});

/** Verifies: [PROTOCOL Mechanisms] scram-sha-256-plus once bound, by tls-exporter over TLS 1.3, else the certificate's end point, else unoffered. */
test('a Scram mechanism binds as its channel allows', () => {
  const scram = new Scram('pencil');
  assert.equal(scram.name, 'scram-sha-256');
  assert.equal(scram.secret, true);
  scram.bind({ exporter: new Uint8Array(32) });
  assert.equal(scram.name, 'scram-sha-256-plus');
  assert.ok(text(scram.initial()).startsWith('p=tls-exporter,,n=,r='));
  assert.equal(scram.name, 'scram-sha-256', 'the next connection binds afresh');
  scram.bind({ certificate: new Uint8Array(4) });
  assert.ok(text(scram.initial()).startsWith('y,,'), 'a certificate of no binding: unoffered');
  const off = new Scram('pencil', { channelBinding: 'disable', inTheClear: true });
  off.bind({ exporter: new Uint8Array(32) });
  assert.equal(off.name, 'scram-sha-256');
  assert.equal(off.secret, false);
  assert.equal(String(scram), 'Scram(..)');
});

/** Verifies: [CLIENT Connecting] SCRAM refuses an unbound connection under require, and Ready before the server proved itself. */
test('a Scram mechanism refuses what it must', async () => {
  const required = new Scram('pencil', { channelBinding: 'require' });
  required.initial();
  await assert.rejects(required.answer(UTF8.encode('r=x,s=AAAA,i=1')), refused);
  const early = new Scram('pencil');
  early.initial();
  assert.throws(
    () => {
      early.ready();
    },
    isFailure(-919, '08006'),
  );
  await assert.rejects(new Scram('p').answer(UTF8.encode('r=x')), isFailure(-919, '08006'), 'not begun');
});

/** Verifies: [CLIENT The SCRAM key cache] keys kept after a login, found by salt, iterations and password, at most 64, dropped on failure, hits and misses told. */
test('the key cache', async () => {
  const cache = new KeyCache();
  const salt = Uint8Array.of(1, 2);
  const keys = await cache.derived('pencil', salt, 4096);
  assert.deepEqual(await cache.derived('pencil', salt, 4096), keys);
  assert.deepEqual(cache.lookups(), { hits: 1, misses: 1 });
  await cache.derived('other', salt, 4096);
  await cache.derived('pencil', salt, 4097);
  assert.equal(cache.size, 3, 'a wrong password, or other iterations, finds nothing');
  cache.forget('pencil', salt, 4096);
  cache.forget('pencil', Uint8Array.of(9), 4096);
  assert.equal(cache.size, 2);
  for (let i = 0; i < KEY_CACHE_ENTRIES + 1; i += 1) await cache.derived(`p${String(i)}`, salt, 1);
  assert.equal(cache.size, KEY_CACHE_ENTRIES, 'the oldest dropped first');
  assert.equal(String(cache), `KeyCache(${String(KEY_CACHE_ENTRIES)} entries)`);
  cache.clear();
  assert.equal(cache.size, 0);
  assert.equal(cache.isEmpty, true);
});

/** Verifies: [CLIENT The SCRAM key cache] a mechanism given a cache takes its keys, and forgets them when its login fails. */
test('a mechanism with a cache', async () => {
  const cache = new KeyCache();
  const scram = new Scram('pencil', { cache });
  const nonce = text(scram.initial()).slice('n,,n=,r='.length);
  await scram.answer(UTF8.encode(`r=${nonce}x,s=AAAA,i=1`));
  assert.equal(cache.size, 1);
  await assert.rejects(scram.answer(UTF8.encode('v=AAAA')), refused);
  assert.equal(cache.size, 0, 'forgotten as the exchange failed');
  scram.initial();
  scram.refused();
});

/**
 * DER of a tag and a short body.
 *
 * @param tag - the tag
 * @param body - the body
 * @returns the element
 */
function tlv(tag: number, body: number[]): number[] {
  return [tag, body.length, ...body];
}

/**
 * A certificate of a signature algorithm, as the end point reads it.
 *
 * @param oid - the algorithm's OID body
 * @param parameters - its parameters' DER
 * @returns the certificate's DER
 */
function certificate(oid: number[], parameters: number[] = []): Uint8Array {
  const algorithm = tlv(0x30, [...tlv(0x06, oid), ...parameters]);
  return Uint8Array.from(tlv(0x30, [...tlv(0x30, [0x02, 1, 7]), ...algorithm, ...tlv(0x03, [0])]));
}

const PKCS1 = [0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01];
const HASHALGS = [0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02];

/** Verifies: [PROTOCOL Mechanisms] [RFC 5929 §4.1] tls-server-end-point hashes the certificate by the hash its signature chooses, SHA-256 for MD5 and SHA-1. */
test('the end point binding', () => {
  const hashed = (hash: string, der: Uint8Array): Uint8Array => new Uint8Array(createHash(hash).update(der).digest());
  const cases: [number[], string][] = [
    [[...PKCS1, 0x04], 'sha256'],
    [[...PKCS1, 0x05], 'sha256'],
    [[...PKCS1, 0x0b], 'sha256'],
    [[...PKCS1, 0x0c], 'sha384'],
    [[...PKCS1, 0x0d], 'sha512'],
    [[0x2a, 0x86, 0x48, 0xce, 0x3d, 0x04, 0x03, 0x03], 'sha384'],
  ];
  for (const [oid, hash] of cases) {
    const der = certificate(oid, [0x05, 0]);
    assert.deepEqual(endPoint(der), hashed(hash, der));
  }
  assert.equal(endPoint(certificate([0x2b, 0x65, 0x70])), undefined, 'Ed25519');
  const whole = certificate([...PKCS1, 0x0b]);
  for (let cut = 0; cut < whole.byteLength; cut += 1) assert.equal(endPoint(whole.subarray(0, cut)), undefined);
  const pss = (hash: number[] | undefined, mask: number[] | undefined): Uint8Array => {
    const h = hash === undefined ? [] : tlv(0xa0, tlv(0x30, [...tlv(0x06, hash), 0x05, 0]));
    const m =
      mask === undefined
        ? []
        : tlv(0xa1, tlv(0x30, [...tlv(0x06, [...PKCS1, 0x08]), ...tlv(0x30, [...tlv(0x06, mask), 0x05, 0])]));
    return certificate([...PKCS1, 0x0a], tlv(0x30, [...h, ...m]));
  };
  const same = pss([...HASHALGS, 0x02], [...HASHALGS, 0x02]);
  assert.deepEqual(endPoint(same), hashed('sha384', same));
  const defaults = pss(undefined, undefined);
  assert.deepEqual(endPoint(defaults), hashed('sha256', defaults), 'SHA-1 by default');
  assert.equal(endPoint(pss([...HASHALGS, 0x01], undefined)), undefined, 'two hashes');
  assert.equal(endPoint(certificate([...PKCS1, 0x0a])), undefined, 'no parameters');
  const long = Uint8Array.from([0x30, 0x81, 2, 1, 2]);
  assert.equal(endPoint(long), undefined, 'a long-form length read, of no certificate');
});
