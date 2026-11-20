/**
 * What a TLS connection's handshake gives SCRAM-SHA-256-PLUS to bind
 * itself to (`[PROTOCOL Mechanisms]`): the certificate the server
 * presented, for `tls-server-end-point` (RFC 5929), and over TLS 1.3 the
 * keying material the connection exports, for `tls-exporter` (RFC 9266),
 * as turborel-client's `tls::channel` takes them.
 *
 * @packageDocumentation
 */

import type { TLSSocket } from 'node:tls';

import type { TlsChannel } from '../auth/mechanism.js';

/** The label `tls-exporter` exports by [RFC 9266 §2]. */
export const EXPORTER_LABEL = 'EXPORTER-Channel-Binding';

/** The bytes `tls-exporter` exports [RFC 9266 §2]. */
export const EXPORTER_BYTES = 32;

/** The protocol version over which `tls-exporter` is the binding. */
const TLS_1_3 = 'TLSv1.3';

/**
 * The channel of a TLS socket, once its handshake is done.
 *
 * @param socket - the socket
 * @returns its server's certificate, and its exported keying material over TLS 1.3
 */
export function channelOf(socket: TLSSocket): TlsChannel {
  const raw = socket.getPeerCertificate().raw as Buffer | undefined;
  const certificate = raw === undefined ? undefined : new Uint8Array(raw);
  const exporter =
    socket.getProtocol() === TLS_1_3
      ? new Uint8Array(socket.exportKeyingMaterial(EXPORTER_BYTES, EXPORTER_LABEL, Buffer.alloc(0)))
      : undefined;
  return { ...(certificate === undefined ? {} : { certificate }), ...(exporter === undefined ? {} : { exporter }) };
}
