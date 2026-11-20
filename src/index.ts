/**
 * turborel, the JavaScript driver for turborel, a relational database
 * system.
 *
 * @remarks
 * The driver speaks turborel's native protocol, version 1, itself, in
 * TypeScript compiled to JavaScript, on Node.js 22.12 or later, with no
 * runtime dependency beyond Node.js's own modules (RULES.md D1, D3, D10).
 * Browsers cannot open a TCP connection and are not served.
 *
 * This is the alpha, version 0.0.0, the number of the turborel release it
 * is made for. Its Promise-based API of connections, queries, prepared
 * statements, cursors as async iterators and pools (RULES.md D2) is built
 * milestone by milestone, over the low-level client it exports: so far
 * its connections, by every transport and mechanism, the statements they
 * run, prepared or not, its error type, and the values and data types its
 * codec reads and writes.
 *
 * @packageDocumentation
 */

export { TurborelError } from './error.js';
export type { Diagnostics, TurborelErrorOptions } from './error.js';
export { Decimal } from './codec/decimal.js';
export { DecFloat } from './codec/decfloat.js';
export {
  Datetime,
  Interval,
  Lob,
  LobLocator,
  Multiset,
  PluginValue,
  Reference,
  SqlRow,
  Structured,
  Uuid,
  Xml,
} from './codec/values.js';
export type { LobKind, Moment, Value } from './codec/values.js';
export { Json, JsonObject } from './codec/json.js';
export type { JsonInput, JsonItem } from './codec/json.js';
export type {
  CharUnits,
  DataType,
  IntervalField,
  Qualifier,
  RowField,
  StructuredName,
  TypeName,
  XmlSchemaName,
} from './codec/types.js';
export { Certificate, Password, Trust } from './auth/mechanism.js';
export type { Mechanism, TlsChannel } from './auth/mechanism.js';
export { Scram } from './auth/scram.js';
export type { ChannelBinding, ScramOptions } from './auth/scram.js';
export { KEY_CACHE_ENTRIES, KeyCache } from './auth/key-cache.js';
export type { Lookups } from './auth/key-cache.js';
export { CANCEL_WITHIN, Canceller } from './session/cancel.js';
export * as capabilities from './session/capabilities.js';
export { connectTo } from './session/connect.js';
export { CONNECT_WITHIN, Connection, DEFAULT_TIMEOUTS, TERMINATE_WITHIN, VERSION } from './session/connection.js';
export type { OpenOptions, Timeouts } from './session/connection.js';
export { Statement } from './session/statements.js';
export type { Batch, CursorOptions, Outcome, Ran, Sink, Streamed } from './session/statements.js';
export { APPLICATION, KEPT_NOTICES, Offer } from './session/told.js';
export type { Notice, NoticeHandler } from './session/told.js';
export { channelOf } from './tls/channel.js';
export { config, platformAuthorities, presenting, presentingTo, roots, trusting } from './tls/config.js';
export type { TlsConfig } from './tls/config.js';
export { FrameStream } from './transport/frames.js';
export { DEFAULT_PIPE, DEFAULT_PORT, local, overTls, tcp } from './transport/target.js';
export type { Target } from './transport/target.js';
