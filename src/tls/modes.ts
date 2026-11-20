/**
 * TLS by mode (`[CLIENT TLS by mode]`), as turborel-client's
 * `tls/modes.rs` makes it: `prefer` and `require` encrypt, and the
 * handshake proves the server holds the key of the certificate it
 * presents, but who signed it is not checked, so they keep out an
 * eavesdropper and not a server in the middle; `verify-ca` checks the
 * certificate against the authorities trusted, not its name;
 * `verify-full` checks both. Each presents the client's certificate if
 * one is named.
 *
 * @packageDocumentation
 */

import type { ConnectionOptions } from 'node:tls';

import { type TlsConfig, readText, roots } from './config.js';
import { connectionFailure } from '../error.js';

/** How a connection over TCP uses TLS. */
export type TlsMode = 'disable' | 'prefer' | 'require' | 'verify-ca' | 'verify-full';

/** The files a connection's TLS is made of. */
export interface TlsFiles {
  /** A PEM file of the authorities trusted. */
  readonly roots?: string;
  /** Whether the platform's authorities are trusted too. */
  readonly systemRoots: boolean;
  /** A PEM file of the client's certificate chain, to present. */
  readonly certificate?: string;
  /** A PEM file of its private key. */
  readonly key?: string;
  /** The name the server's certificate is checked against, if not the host's. */
  readonly serverName?: string;
}

/**
 * The certificate and key `files` name, read: none if they name no certificate.
 *
 * @param files - the files
 * @returns Node.js's options of them
 * @throws {@link TurborelError} 08006 for a certificate named without its key, or a file that cannot be read
 */
function identity(files: TlsFiles): ConnectionOptions {
  if (files.certificate === undefined) return {};
  if (files.key === undefined)
    throw connectionFailure('a client certificate is presented with its key, and none is named');
  return { cert: readText(files.certificate), key: readText(files.key) };
}

/**
 * The client's TLS of `mode`, trusting and presenting what `files` name.
 *
 * @param mode - the mode
 * @param files - the files
 * @returns the configuration, or undefined of `disable`
 * @throws {@link TurborelError} 08006 if a file cannot be read, or `verify-ca` or `verify-full` trusts no authority
 */
export function modeConfig(mode: TlsMode, files: TlsFiles): TlsConfig | undefined {
  const name = files.serverName === undefined ? {} : { serverName: files.serverName };
  switch (mode) {
    case 'disable':
      return undefined;
    case 'prefer':
    case 'require':
      return { options: { rejectUnauthorized: false, ...identity(files) }, ...name };
    case 'verify-ca': {
      const ca = roots(files.roots, files.systemRoots);
      return { options: { ca, checkServerIdentity: () => undefined, ...identity(files) }, ...name };
    }
    case 'verify-full':
      return { options: { ca: roots(files.roots, files.systemRoots), ...identity(files) }, ...name };
  }
}
