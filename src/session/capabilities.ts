/**
 * The capabilities of the protocol's version 1 (`[PROTOCOL Capabilities]`),
 * by name, in the order Ready grants them, as turborel-protocol's
 * `capability.rs` lists them, and the session statuses the server tells
 * (`[PROTOCOL Status 'T']`, CONFORMANCE.md G2).
 *
 * @packageDocumentation
 */

/** A Notice before a statement's completion. */
export const NOTICES = 'notices';
/** A Status of each session setting at login and of each a statement changes. */
export const STATUS = 'status';
/** An Error's failure carries tags 7 to 15. */
export const DIAGNOSTICS = 'diagnostics';
/** The request Describe. */
export const DESCRIBE = 'describe';
/** Several cursors of one prepared statement, numbered by tag 3. */
export const CURSORS = 'cursors';
/** The request Ping, answered by Pong. */
export const PING = 'ping';
/** The request Reset. */
export const RESET = 'reset';
/** The request ChangeUser. */
export const CHANGE_USER = 'change-user';
/** Attributes, tag 1, on Query and Execute. */
export const QUERY_ATTRIBUTES = 'query-attributes';
/** Hello carries attributes; every server reads them, granted or not. */
export const CONNECTION_ATTRIBUTES = 'connection-attributes';
/** A Query of several statements, tag 2, and tag 5 on its Completes. */
export const MULTI_STATEMENT = 'multi-statement';
/** Compressed frames, both ways. */
export const COMPRESSION = 'compression';
/** A Complete that committed carries the commit's log position, tag 4. */
export const COMMIT_POSITION = 'commit-position';
/** The requests CopyIn, CopyData and CopyEnd. */
export const COPY = 'copy';
/** A Complete carries its rows, tag 6, and the server's time, tag 18. */
export const ROW_COUNTS = 'row-counts';
/** A Complete of an INSERT carries the identity values it generated, tag 16. */
export const GENERATED_VALUES = 'generated-values';
/** An Execute that ends the transaction ends it with its cursor. */
export const FETCH_ENDS = 'fetch-ends';
/** A Complete carries its statement's conditions, tag 17, in place of Notices. */
export const CONDITIONS = 'conditions';
/** A Prepared and a Description carry each column's declared type, tag 19. */
export const DECLARED_TYPES = 'declared-types';
/** A Prepared of a CALL carries its procedure and each `?` with its parameter's mode, tag 20. */
export const PARAMETER_MODES = 'parameter-modes';
/** The request Debug, answered by Debugged or a Complete, and the Event the server sends unasked, an extension. */
export const DEBUGGER = 'debugger';
/** The request CopyColumns, rows of a copy by column, with `copy`. */
export const COLUMNS = 'columns';

/** Every capability of version 1, in the order Ready grants them. */
export const ALL_CAPABILITIES: readonly string[] = [
  NOTICES,
  STATUS,
  DIAGNOSTICS,
  DESCRIBE,
  CURSORS,
  PING,
  RESET,
  CHANGE_USER,
  QUERY_ATTRIBUTES,
  CONNECTION_ATTRIBUTES,
  MULTI_STATEMENT,
  COMPRESSION,
  COMMIT_POSITION,
  COPY,
  ROW_COUNTS,
  GENERATED_VALUES,
  FETCH_ENDS,
  CONDITIONS,
  DECLARED_TYPES,
  PARAMETER_MODES,
  DEBUGGER,
  COLUMNS,
];

/** The session's authorization identifier, a status the server tells. */
export const AUTHORIZATION = 'AUTHORIZATION';
/** The session's default schema. */
export const SCHEMA = 'SCHEMA';
/** Whether the session's transactions are read-only, YES or NO. */
export const READ_ONLY = 'READ_ONLY';
/** The server's product and version. */
export const SERVER_VERSION = 'SERVER_VERSION';
/** Whether the server takes no change, YES of a replica, NO of a primary (CONFORMANCE.md G2). */
export const SERVER_READ_ONLY = 'SERVER_READ_ONLY';
/** The session's catalog (CONFORMANCE.md G2). */
export const CATALOG = 'CATALOG';
/** Whether the session's user owns the database, YES or NO (CONFORMANCE.md G2). */
export const OWNER = 'OWNER';
