/**
 * Connecting to a target (`[CLIENT Connecting]`), as turborel-client's
 * `target::connect_to_within` does: a secret mechanism refused over plain
 * TCP before anything is sent (SQLSTATE 28000); the socket opened and TLS
 * begun within the connect timeout; the mechanism bound to the TLS
 * channel; then the login. A named pipe's reads and writes are bounded
 * only as it is opened, as turborel-client bounds them.
 *
 * @packageDocumentation
 */

import { Connection, DEFAULT_TIMEOUTS, type OpenOptions } from './connection.js';
import { TurborelError } from '../error.js';
import type { Mechanism } from '../auth/mechanism.js';
import { SQLSTATE_INVALID_AUTHORIZATION } from '../auth/scram-exchange.js';
import { FrameStream } from '../transport/frames.js';
import { type Opened, type Target, isPlainTcp, open } from '../transport/target.js';

/** SQLCODE of a connection exception, of credentials refused before connecting. */
const SQLCODE_CONNECTION = -919;

/** The platform whose local target is a named pipe. */
const WINDOWS = 'win32';

/**
 * Refuses `mechanism` over `target` if it is plain TCP and what the mechanism sends is secret.
 *
 * @param target - where the server is
 * @param mechanism - what proves the user
 * @throws {@link TurborelError} 28000 before any connection is made
 */
export function refuseInTheClear(target: Target, mechanism: Mechanism): void {
  if (isPlainTcp(target) && mechanism.secret) {
    throw new TurborelError(
      SQLCODE_CONNECTION,
      SQLSTATE_INVALID_AUTHORIZATION,
      `${mechanism.name} is sent only over TLS, a Unix socket or a named pipe, never over plain TCP`,
    );
  }
}

/**
 * Connects to the server at `target` as `user`, proved by `mechanism`.
 *
 * @param target - where the server is, and how it is reached
 * @param user - the user, read by the server as an identifier
 * @param mechanism - what proves the user
 * @param options - what the connection asks for and how long it waits
 * @returns the connection, logged in
 * @throws {@link TurborelError} 28000 for a secret mechanism over plain TCP, or credentials refused; 08006 if no connection is made, in time
 */
export async function connectTo(
  target: Target,
  user: string,
  mechanism: Mechanism,
  options: Omit<OpenOptions, 'target' | 'boundedReads'> = {},
): Promise<Connection> {
  refuseInTheClear(target, mechanism);
  const timeouts = options.timeouts ?? DEFAULT_TIMEOUTS;
  return logIn(target, await open(target, timeouts.connect), user, mechanism, { ...options, timeouts });
}

/**
 * Logs in over a socket opened to `target`, the mechanism bound to its TLS channel, if it has one.
 *
 * @param target - where the socket reached
 * @param opened - the socket, and its channel
 * @param user - the user
 * @param mechanism - what proves the user
 * @param options - what the connection asks for and how long it waits
 * @returns the connection, logged in
 */
export async function logIn(
  target: Target,
  opened: Opened,
  user: string,
  mechanism: Mechanism,
  options: Omit<OpenOptions, 'target' | 'boundedReads'> = {},
): Promise<Connection> {
  if (opened.channel !== undefined) mechanism.bind(opened.channel);
  const pipe = target.kind === 'local' && process.platform === WINDOWS;
  return Connection.open(new FrameStream(opened.socket), user, mechanism, {
    ...options,
    timeouts: options.timeouts ?? DEFAULT_TIMEOUTS,
    target,
    boundedReads: !pipe,
  });
}
