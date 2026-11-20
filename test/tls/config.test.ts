/**
 * Tests of how a client's TLS trusts its server: the authorities of a
 * file, the platform's, or both (RULES.md R-TEST-2).
 */

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { rootCertificates } from 'node:tls';

import { authorities, config, platformAuthorities, presentingTo, roots, trusting } from '../../src/tls/config.js';
import { isPlainTcp, isTls, local, overTls, tcp } from '../../src/transport/target.js';
import { isConnectionFailure } from '../support/failures.js';

const dir = mkdtempSync(join(tmpdir(), 'turborel-js-tls-'));
after(() => {
  rmSync(dir, { recursive: true, force: true });
});

/**
 * A file of `text` in the test's directory.
 *
 * @param name - its name
 * @param text - its text
 * @returns its path
 */
function file(name: string, text: string): string {
  const path = join(dir, name);
  writeFileSync(path, text);
  return path;
}

const [first = '', second = ''] = rootCertificates;
const pair = file('pair.pem', `${first}\n${second}\n`);

/** Verifies: [CLIENT Connecting] TLS trusts the authorities of a PEM file; one of none, unreadable or damaged is refused. */
test("a file's authorities", () => {
  assert.equal(authorities(pair).length, 2);
  assert.deepEqual(trusting(pair).options.ca, authorities(pair));
  assert.throws(() => authorities(file('empty.pem', 'no certificate here')), isConnectionFailure);
  assert.throws(() => authorities(join(dir, 'missing.pem')), isConnectionFailure);
  const damaged = '-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----\n';
  assert.throws(() => authorities(file('damaged.pem', damaged)), isConnectionFailure);
});

/** Verifies: [CLIENT Connecting] the platform's authorities are those SSL_CERT_FILE and SSL_CERT_DIR name, if either is set, else the system's. */
test("the platform's authorities", () => {
  assert.equal(platformAuthorities({ SSL_CERT_FILE: pair }).length, 2);
  const certs = join(dir, 'certs');
  mkdirSync(certs);
  writeFileSync(join(certs, 'one.pem'), first);
  assert.equal(platformAuthorities({ SSL_CERT_DIR: certs }).length, 1);
  assert.equal(platformAuthorities({ SSL_CERT_FILE: pair, SSL_CERT_DIR: certs }).length, 3);
  assert.ok(platformAuthorities({ SSL_CERT_FILE: '' }).length > 0, "empty, the system's");
});

/** Verifies: [CLIENT Connecting] a file's authorities, the platform's, or both; none trusted is refused. */
test("a file's, the platform's, or both", () => {
  assert.equal(roots(pair, false).length, 2);
  assert.ok(roots(pair, true).length > 2);
  assert.ok(roots(undefined, true).length > 0);
  assert.throws(() => roots(undefined, false), isConnectionFailure);
  assert.deepEqual(config(['x'], 'db.example'), { options: { ca: ['x'] }, serverName: 'db.example' });
  assert.deepEqual(config(['x']), { options: { ca: ['x'] } });
});

/** Verifies: [CLIENT Connecting] the mechanism certificate presents a chain and key read from PEM files. */
test('a certificate presented', () => {
  const presented = presentingTo(['ca'], { chain: file('chain.pem', 'CHAIN'), key: file('key.pem', 'KEY') });
  assert.deepEqual(presented.options, { ca: ['ca'], cert: 'CHAIN', key: 'KEY' });
  assert.throws(() => presentingTo([], { chain: join(dir, 'none'), key: join(dir, 'none') }), isConnectionFailure);
});

/** Verifies: [CLIENT Connecting] a target is TLS, plain TCP, or local, as it says. */
test('what a target is', () => {
  const secured = overTls('db', config(['x']));
  assert.deepEqual([isTls(secured), isPlainTcp(secured)], [true, false]);
  assert.deepEqual([isTls(tcp('db')), isPlainTcp(tcp('db'))], [false, true]);
  assert.deepEqual([isTls(local('/s')), isPlainTcp(local('/s'))], [false, false]);
});
