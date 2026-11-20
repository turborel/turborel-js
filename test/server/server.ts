/**
 * The live tests' server (RULES.md R-TEST-8): a turboreld of the user's
 * naming, set up here with test certificates made for the run, SCRAM
 * users and SERVER.TRUST_LOCAL, on port 17432, its data in a directory of
 * its own, stopped once the tests are done. The live tests run only where
 * TURBOREL_TEST_SERVER names the server: a path to turboreld, or
 * `docker:` and an image, as `docker:ghcr.io/turborel/turborel:nightly`,
 * so the other tests stay deterministic (R-TEST-5).
 */

import { type ChildProcess, execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** The environment variable naming the server the live tests run against. */
export const TEST_SERVER = 'TURBOREL_TEST_SERVER';

/** The prefix of a server run from a container image. */
const DOCKER = 'docker:';

/** The port the live tests' server listens on, this driver's own. */
export const PORT = 17432;

/** The users made, and their passwords. */
export const USERS = { ann: 'ann-secret', bob: 'bob-secret' } as const;

/** The PBKDF2 iterations of the test users' verifiers: the least turborel takes, so logins are quick. */
const ITERATIONS = 10_000;

/** How long the server may take to start. */
const START_WITHIN = 30_000;

/** The files of a test PKI. */
export interface Pki {
  /** The authority's certificate. */
  readonly ca: string;
  /** The server's certificate, of localhost and 127.0.0.1. */
  readonly serverCert: string;
  /** The server's key. */
  readonly serverKey: string;
  /** A client's certificate, of the common name ann. */
  readonly clientCert: string;
  /** The client's key. */
  readonly clientKey: string;
}

/** A live server, started. */
export interface Live {
  /** Its data and files. */
  readonly dir: string;
  /** Its Unix socket, or on Windows its named pipe. */
  readonly socket: string;
  /** The test PKI it serves TLS by. */
  readonly pki: Pki;
  /** Stops it, and removes its directory. */
  stop(): Promise<void>;
}

/** @returns the openssl to make certificates with: OpenSSL 3 where Homebrew keeps it, else the PATH's */
function openssl(): string {
  const brewed = '/opt/homebrew/opt/openssl@3/bin/openssl';
  return existsSync(brewed) ? brewed : 'openssl';
}

/**
 * Makes a key and a certificate signed by the authority, or the authority itself.
 *
 * @param dir - where the files go
 * @param name - the files' name
 * @param subject - the certificate's subject
 * @param extensions - its extensions, in openssl's configuration form
 */
function certificate(dir: string, name: string, subject: string, extensions: string): void {
  const run = (args: string[]): void => {
    execFileSync(openssl(), args, { cwd: dir, stdio: 'ignore' });
  };
  const ext = join(dir, `${name}.ext`);
  writeFileSync(ext, extensions);
  run(['genpkey', '-algorithm', 'EC', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-out', `${name}.key`]);
  if (name === 'ca') {
    run([
      'req',
      '-x509',
      '-new',
      '-key',
      'ca.key',
      '-subj',
      subject,
      '-days',
      '2',
      '-out',
      'ca.pem',
      '-extensions',
      'v3',
      '-config',
      ext,
    ]);
    return;
  }
  run(['req', '-new', '-key', `${name}.key`, '-subj', subject, '-out', `${name}.csr`]);
  run(
    ['x509', '-req', '-in', `${name}.csr`, '-CA', 'ca.pem', '-CAkey', 'ca.key', '-CAcreateserial'].concat([
      '-days',
      '2',
      '-sha256',
      '-out',
      `${name}.pem`,
      '-extfile',
      ext,
      '-extensions',
      'v3',
    ]),
  );
}

/**
 * Makes a test PKI in `dir`: an authority, the server's certificate and a client's.
 *
 * @param dir - where the files go
 * @returns their paths
 */
export function makePki(dir: string): Pki {
  const req = '[req]\ndistinguished_name = dn\n[dn]\n';
  certificate(
    dir,
    'ca',
    '/CN=turborel-js test authority',
    `${req}[v3]\nbasicConstraints = critical, CA:TRUE\nkeyUsage = critical, keyCertSign, cRLSign\n`,
  );
  certificate(
    dir,
    'server',
    '/CN=localhost',
    '[v3]\nsubjectAltName = DNS:localhost, IP:127.0.0.1\nextendedKeyUsage = serverAuth\n',
  );
  certificate(dir, 'client', '/CN=ann', '[v3]\nextendedKeyUsage = clientAuth\n');
  const at = (file: string): string => join(dir, file);
  return {
    ca: at('ca.pem'),
    serverCert: at('server.pem'),
    serverKey: at('server.key'),
    clientCert: at('client.pem'),
    clientKey: at('client.key'),
  };
}

/**
 * The command that runs turboreld with `args`: the program itself, or a container of the image named.
 *
 * @param server - TURBOREL_TEST_SERVER's value
 * @param dir - the directory its files are in, mounted at the same path in a container
 * @param args - turboreld's arguments
 * @returns the program and its arguments
 */
function command(server: string, dir: string, args: string[]): [string, string[]] {
  if (!server.startsWith(DOCKER)) return [server, args];
  const user =
    typeof process.getuid === 'function' ? `${String(process.getuid())}:${String(process.getgid?.())}` : '0:0';
  const docker = [
    'run',
    '--rm',
    '-i',
    '--network',
    'host',
    '--user',
    user,
    '-v',
    `${dir}:${dir}`,
    '--name',
    `turborel-js-${String(process.pid)}`,
  ];
  return ['docker', [...docker, server.slice(DOCKER.length), ...args]];
}

/**
 * Adds a user to the database in `dir`, its password on standard input.
 *
 * @param server - TURBOREL_TEST_SERVER's value
 * @param dir - the database's directory
 * @param user - the user
 * @param owner - whether it owns the database
 */
function addUser(server: string, dir: string, user: keyof typeof USERS, owner: boolean): void {
  const args = [
    '--dir',
    join(dir, 'db'),
    '--log',
    join(dir, 'setup.log'),
    '--set',
    `SERVER.PASSWORD_ITERATIONS=${String(ITERATIONS)}`,
  ];
  const [program, all] = command(server, dir, [...args, 'user', 'add', user, ...(owner ? ['--owner'] : [])]);
  execFileSync(program, all, { input: `${USERS[user]}\n`, stdio: ['pipe', 'ignore', 'ignore'] });
}

/**
 * Waits for the server to say it listens, as it does on its standard error.
 *
 * @param child - the server's process
 * @returns once it listens
 */
function listening(child: ChildProcess): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('turboreld did not start in time'));
    }, START_WITHIN);
    child.stderr?.on('data', (chunk: Buffer) => {
      if (chunk.toString().includes('listening at')) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`turboreld exited with ${String(code)}`));
    });
  });
}

/**
 * Starts the live tests' server, if TURBOREL_TEST_SERVER names one.
 *
 * @returns the server, or undefined where none is named
 */
export async function startLive(): Promise<Live | undefined> {
  const server = process.env[TEST_SERVER];
  if (server === undefined || server === '') return undefined;
  const dir = mkdtempSync(join(tmpdir(), 'turborel-js-'));
  const pki = makePki(dir);
  addUser(server, dir, 'ann', true);
  addUser(server, dir, 'bob', false);
  const socket = process.platform === 'win32' ? `\\\\.\\pipe\\turborel-js-${String(process.pid)}` : join(dir, 'socket');
  const settings = [
    'SERVER.HOST=127.0.0.1',
    `SERVER.PORT=${String(PORT)}`,
    `SERVER.SOCKET=${socket}`,
    'SERVER.TLS=ON',
    `SERVER.TLS_CERTIFICATE=${pki.serverCert}`,
    `SERVER.TLS_KEY=${pki.serverKey}`,
    `SERVER.TLS_CLIENT_CA=${pki.ca}`,
    'SERVER.TRUST_LOCAL=ON',
    'SERVER.LOGIN_DELAY_MS=0',
  ];
  const args = ['--dir', join(dir, 'db'), '--log', join(dir, 'server.log'), ...settings.flatMap((s) => ['--set', s])];
  const [program, all] = command(server, dir, args);
  const child = spawn(program, all, { stdio: ['ignore', 'ignore', 'pipe'] });
  await listening(child);
  return {
    dir,
    socket,
    pki,
    stop: async () => {
      const exited = new Promise<void>((resolve) =>
        child.once('exit', () => {
          resolve();
        }),
      );
      if (server.startsWith(DOCKER))
        execFileSync('docker', ['kill', `turborel-js-${String(process.pid)}`], { stdio: 'ignore' });
      else child.kill('SIGTERM');
      await exited;
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
