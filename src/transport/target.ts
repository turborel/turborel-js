/**
 * Where a server is, and how a client reaches it: over TCP, port 7422
 * unless told another; a Unix socket, or on Windows a named pipe; or TLS
 * begun on the TCP port, the server telling it by the handshake's first
 * byte, as turborel-client's `target.rs` reaches them
 * (`[PROTOCOL The Native Protocol]`, `[CLIENT Connecting]`). A connection made to a
 * target keeps it, so it can be reached again to cancel a statement.
 *
 * @packageDocumentation
 */

import { type Socket, connect as connectNet, isIP } from 'node:net';
import { type ConnectionOptions, type TLSSocket, checkServerIdentity, connect as connectTls } from 'node:tls';

import { within } from './frames.js';
import { channelOf } from '../tls/channel.js';
import type { TlsConfig } from '../tls/config.js';
import { connectionFailure } from '../error.js';
import type { TlsChannel } from '../auth/mechanism.js';

/** The TCP port a server listens on unless told another (`[PROTOCOL The Native Protocol]`). */
export const DEFAULT_PORT = 7422;

/** The named pipe a server on Windows serves unless told another (`[CLIENT Connecting]`). */
export const DEFAULT_PIPE = '\\\\.\\pipe\\turborel';

/** Where a server is, and how it is reached. */
export type Target =
  | { readonly kind: 'tcp'; readonly host: string; readonly port: number }
  | { readonly kind: 'local'; readonly path: string }
  | { readonly kind: 'tls'; readonly host: string; readonly port: number; readonly tls: TlsConfig };

/** A socket opened to a target, and the TLS channel it is secured by, if it is. */
export interface Opened {
  /** The socket, plain or TLS. */
  readonly socket: Socket;
  /** What a mechanism binds itself to, of a TLS connection. */
  readonly channel?: TlsChannel;
}

/**
 * The target of a server over TCP.
 *
 * @param host - its name or address
 * @param port - its port, 7422 unless told another
 * @returns the target
 */
export function tcp(host: string, port: number = DEFAULT_PORT): Target {
  return { kind: 'tcp', host, port };
}

/**
 * The target of a server at a Unix socket, or on Windows a named pipe.
 *
 * @param path - the socket's path, or the pipe's name, as `\\.\pipe\turborel`
 * @returns the target
 */
export function local(path: string): Target {
  return { kind: 'local', path };
}

/**
 * The target of a server over TLS, begun on its TCP port.
 *
 * @param host - its name or address
 * @param tls - how the connection trusts the server and presents itself
 * @param port - its port, 7422 unless told another
 * @returns the target
 */
export function overTls(host: string, tls: TlsConfig, port: number = DEFAULT_PORT): Target {
  return { kind: 'tls', host, port, tls };
}

/**
 * Whether `target` is plain TCP, over which no secret is sent.
 *
 * @param target - the target
 * @returns true if it is TCP without TLS
 */
export function isPlainTcp(target: Target): boolean {
  return target.kind === 'tcp';
}

/**
 * Waits for a socket to connect, as `event` says it has.
 *
 * @param socket - the socket connecting
 * @param event - `connect`, or `secureConnect` of TLS
 * @param ms - the milliseconds it may take, or undefined for none
 * @param what - what failed, if it fails
 */
async function connected(socket: Socket, event: string, ms: number | undefined, what: string): Promise<void> {
  const made = new Promise<void>((resolve, reject) => {
    socket.once(event, () => {
      resolve();
    });
    socket.once('error', (e: Error) => {
      reject(connectionFailure(`${what}: ${e.message}`, e));
    });
  });
  await within(made, ms, 'connect', () => {
    socket.destroy();
  });
}

/**
 * The options Node.js's TLS connects by, of a configuration and a host:
 * the server's certificate checked against the configuration's server
 * name, else the host's, which is sent as the server's name too unless it
 * is an address.
 *
 * @param host - the host connected to
 * @param port - its port
 * @param config - the configuration
 * @returns the options
 */
function tlsOptions(host: string, port: number, config: TlsConfig): ConnectionOptions {
  const name = config.serverName ?? host;
  return {
    checkServerIdentity: (_: string, cert) => checkServerIdentity(name, cert),
    ...config.options,
    host,
    port,
    ...(isIP(name) === 0 ? { servername: name } : {}),
  };
}

/**
 * Begins TLS over a connected socket.
 *
 * @param socket - the socket, connected
 * @param target - the TLS target it reached
 * @param ms - the milliseconds the handshake may take
 * @returns the TLS socket, and its channel
 */
async function secure(
  socket: Socket,
  target: Extract<Target, { kind: 'tls' }>,
  ms: number | undefined,
): Promise<Opened> {
  const secured: TLSSocket = connectTls({ ...tlsOptions(target.host, target.port, target.tls), socket });
  await connected(secured, 'secureConnect', ms, 'the TLS handshake failed');
  return { socket: secured, channel: channelOf(secured) };
}

/**
 * Opens a socket to `target` as `open` does, but over TLS if the server
 * takes it, else over plain TCP: a server reached whose handshake fails
 * connected to again without TLS; one that cannot be reached not tried
 * twice.
 *
 * @param target - where the server is
 * @param ms - the milliseconds each step may take
 * @returns the target reached, plain if TLS failed, and the socket
 */
export async function openPreferring(
  target: Target,
  ms: number | undefined,
): Promise<{ target: Target; opened: Opened }> {
  if (target.kind !== 'tls') return { target, opened: await open(target, ms) };
  const plain = tcp(target.host, target.port);
  const { socket } = await open(plain, ms);
  try {
    return { target, opened: await secure(socket, target, ms) };
  } catch {
    socket.destroy();
    return { target: plain, opened: await open(plain, ms) };
  }
}

/**
 * Opens a socket to `target`, each step within `ms`.
 *
 * @param target - where the server is
 * @param ms - the milliseconds each step may take, or undefined for none
 * @returns the socket, and its TLS channel if it is TLS
 * @throws {@link TurborelError} 08006 if it cannot connect, in time, or its TLS handshake fails
 */
export async function open(target: Target, ms: number | undefined): Promise<Opened> {
  switch (target.kind) {
    case 'tcp': {
      const socket = connectNet({ host: target.host, port: target.port, noDelay: true });
      await connected(socket, 'connect', ms, 'cannot connect');
      return { socket };
    }
    case 'local': {
      const socket = connectNet({ path: target.path });
      await connected(socket, 'connect', ms, 'cannot connect');
      return { socket };
    }
    case 'tls': {
      const { socket } = await open(tcp(target.host, target.port), ms);
      try {
        return await secure(socket, target, ms);
      } catch (e) {
        socket.destroy();
        throw e;
      }
    }
  }
}
