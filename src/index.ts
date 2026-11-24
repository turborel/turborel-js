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
 * is made for. Its standard API (RULES.md D2) is `connect`, which gives a
 * `Client`, with prepared statements, cursors as async iterators and
 * pools; beneath it is the low-level client, every feature of
 * turborel-client: connections by every transport and mechanism, the
 * statements they run, large objects, copies, imports and exports,
 * settings, pipelines, pools and the SQL-agent; its error type; and the
 * values and data types its codec reads and writes.
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
export type { Column, Declared, Parameter } from './codec/composite.js';
export type { Called, DynamicParameter, ParameterMode } from './codec/called.js';
export { columnType, columnTypeName, typeName, typeWritten } from './codec/declared.js';
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
export { CERTIFICATE, Certificate, PASSWORD, Password, TRUST, Trust } from './auth/mechanism.js';
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
export { DEFAULT_PIPE, DEFAULT_PORT, isPlainTcp, isTls, local, open, overTls, tcp } from './transport/target.js';
export type { Opened } from './transport/target.js';
export type { Target } from './transport/target.js';
export { CHUNK_OCTETS, LOB_INLINE_OCTETS, LobWriter } from './session/lobs.js';
export { CHUNK_BYTES, Copying } from './session/copy.js';
export { csvField, readNative } from './session/export.js';
export type { ExportFormat, ExportTarget, NativeRows } from './session/export.js';
export { approximateText, jsonText, literalOf, textOf } from './codec/text.js';
export { DEFAULT_MAX_RECORD, Delimited, Dialect } from './import/delimited.js';
export { DEFAULT_BATCH, ImportError } from './import/import.js';
export type { Cause, ImportOptions, Imported, Rejected } from './import/import.js';
export { importInto } from './import/run.js';
export { SourceError } from './import/source.js';
export type { Heading, Position, Source, SourceRecord } from './import/source.js';
export { ENVIRONMENT, KEYS, Options, SCHEME } from './settings/options.js';
export type { Key } from './settings/options.js';
export { DEFAULT_HOST, DEFAULT_PASSFILE, DEFAULT_SERVICE_FILE, Settings } from './settings/settings.js';
export { serviceFile } from './settings/files.js';
export type { Host, LoadBalance, TargetRole } from './settings/settings.js';
export { ROLE_QUERY, role } from './settings/failover.js';
export type { Role } from './settings/failover.js';
export { modeConfig } from './tls/modes.js';
export type { TlsFiles, TlsMode } from './tls/modes.js';
export { PIPELINE_WINDOW, Pipeline } from './session/pipeline.js';
export type { OnError, Piped } from './session/pipeline.js';
export { RESET_MOST_STATEMENTS } from './session/connection.js';
export {
  DEFAULT_IDLE_TIMEOUT,
  DEFAULT_MAX,
  DEFAULT_MAX_LIFETIME,
  DEFAULT_WAIT,
  Pool,
  Pooled,
  RESET_WITHIN,
} from './pool/pool.js';
export type { PoolConfig, PoolSource } from './pool/pool.js';
export { Agent } from './agent/agent.js';
export type { Connector } from './agent/agent.js';
export { Client, PreparedStatement, connect } from './api/client.js';
export type { ConnectOptions, Result, RunOptions } from './api/client.js';
export type { ResultColumn } from './api/columns.js';
export { Cursor, DEFAULT_CURSOR_BATCH } from './api/cursor.js';
export type { CursorReadOptions } from './api/cursor.js';
export { ClientPool, createPool } from './api/pool.js';
