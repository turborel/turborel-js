/**
 * How a client's TLS trusts its server and presents itself
 * (`[CLIENT Connecting]`), as turborel-client's `tls.rs` does: the
 * certificate authorities of the PEM files it is given, the platform's
 * only when asked, and a certificate chain and key to present for the
 * mechanism `certificate`. The server's certificate is checked against
 * the name connected to.
 *
 * @packageDocumentation
 */

import { X509Certificate } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import * as tls from 'node:tls';

import { connectionFailure } from '../error.js';

/** The environment variable naming a PEM file of the platform's authorities, read in place of its store. */
export const SSL_CERT_FILE = 'SSL_CERT_FILE';

/** The environment variable naming a directory of PEM files of the platform's authorities. */
export const SSL_CERT_DIR = 'SSL_CERT_DIR';

/** A PEM certificate, from its first line to its last. */
const PEM_CERTIFICATE = /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/gu;

/** How a connection's TLS trusts its server and presents itself. */
export interface TlsConfig {
  /** Node.js's options of the connection's TLS: its authorities, and a certificate and key to present. */
  readonly options: tls.ConnectionOptions;
  /** The name the server's certificate is checked against, the host's if none. */
  readonly serverName?: string;
}

/**
 * The text of the file at `path`.
 *
 * @param path - the file
 * @returns its text
 * @throws {@link TurborelError} 08006 if it cannot be read
 */
export function readText(path: string): string {
  try {
    return readFileSync(path, 'utf8');
  } catch (e) {
    throw connectionFailure(`cannot read ${path}: ${(e as Error).message}`, e);
  }
}

/**
 * The certificates of a PEM text, each checked to be one.
 *
 * @param text - PEM text
 * @param from - where it came from, for the failure
 * @returns each certificate's PEM
 */
function certificatesOf(text: string, from: string): string[] {
  const pems = text.match(PEM_CERTIFICATE) ?? [];
  for (const pem of pems) {
    try {
      new X509Certificate(pem);
    } catch (e) {
      throw connectionFailure(`cannot trust ${from}: ${(e as Error).message}`, e);
    }
  }
  return pems;
}

/**
 * The authorities of the PEM file at `path`.
 *
 * @param path - the file
 * @returns each authority's certificate, as PEM
 * @throws {@link TurborelError} 08006 if it cannot be read, or holds no certificate
 */
export function authorities(path: string): string[] {
  const pems = certificatesOf(readText(path), path);
  if (pems.length === 0) throw connectionFailure(`${path} holds no certificate`);
  return pems;
}

/**
 * The platform's authorities: those of the files SSL_CERT_FILE and
 * SSL_CERT_DIR name, if either is set, else the system's store, or the
 * authorities Node.js bundles where it reads no store.
 *
 * @param env - the environment read
 * @returns each authority's certificate, as PEM
 */
export function platformAuthorities(env: NodeJS.ProcessEnv = process.env): string[] {
  const file = env[SSL_CERT_FILE];
  const dir = env[SSL_CERT_DIR];
  if ((file ?? '') !== '' || (dir ?? '') !== '') {
    const fromFile = file === undefined || file === '' ? [] : certificatesOf(readText(file), file);
    const fromDir =
      dir === undefined || dir === ''
        ? []
        : readdirSync(dir).flatMap((name) => certificatesOf(readText(join(dir, name)), join(dir, name)));
    return [...fromFile, ...fromDir];
  }
  const system = typeof tls.getCACertificates === 'function' ? tls.getCACertificates('system') : [];
  return system.length > 0 ? system : [...tls.rootCertificates];
}

/**
 * The authorities of a file, the platform's, or both.
 *
 * @param file - a PEM file of authorities, if one is named
 * @param platform - whether the platform's are trusted too
 * @returns each authority's certificate, as PEM
 * @throws {@link TurborelError} 08006 if none is trusted, or the file cannot be read
 */
export function roots(file: string | undefined, platform: boolean): string[] {
  const store = [...(file === undefined ? [] : authorities(file)), ...(platform ? platformAuthorities() : [])];
  if (store.length === 0) {
    throw connectionFailure("no certificate authority is trusted: name a file of them, or the platform's");
  }
  return store;
}

/**
 * The TLS of a connection trusting the authorities `store`.
 *
 * @param store - the authorities, as PEM
 * @param serverName - the name the server's certificate is checked against, the host's if none
 * @returns the configuration
 */
export function config(store: readonly string[], serverName?: string): TlsConfig {
  return { options: { ca: [...store] }, ...(serverName === undefined ? {} : { serverName }) };
}

/**
 * The TLS of a connection trusting the authorities of the PEM file at `path`.
 *
 * @param path - the file
 * @returns the configuration
 * @throws {@link TurborelError} 08006 if it cannot be read, or holds no certificate
 */
export function trusting(path: string): TlsConfig {
  return config(authorities(path));
}

/**
 * The TLS of a connection trusting the authorities `store`, presenting
 * the certificate chain and key of the PEM files `chain` and `key`, for
 * the mechanism `certificate`.
 *
 * @param store - the authorities, as PEM
 * @param identity - the PEM files of the chain and of its key
 * @returns the configuration
 * @throws {@link TurborelError} 08006 if a file cannot be read
 */
export function presentingTo(
  store: readonly string[],
  identity: { readonly chain: string; readonly key: string },
): TlsConfig {
  return { options: { ca: [...store], cert: readText(identity.chain), key: readText(identity.key) } };
}

/**
 * The TLS of a connection trusting the authorities of the PEM file
 * `rootsPath`, presenting the chain and key of two more.
 *
 * @param rootsPath - the file of the authorities
 * @param identity - the PEM files of the chain and of its key
 * @returns the configuration
 * @throws {@link TurborelError} 08006 if a file cannot be read, or the first holds no certificate
 */
export function presenting(rootsPath: string, identity: { readonly chain: string; readonly key: string }): TlsConfig {
  return presentingTo(authorities(rootsPath), identity);
}
