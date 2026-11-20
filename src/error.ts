/**
 * The driver's one error type (RULES.md D12, R-ERR-2): every failure, the
 * server's or the driver's own, is a {@link TurborelError} carrying its
 * SQLCODE and SQLSTATE, as turborel-client's `Failure` does.
 *
 * @packageDocumentation
 */

/** SQLCODE of a connection failure, as the protocol's Frames section gives it. */
export const SQLCODE_CONNECTION = -919;

/** SQLSTATE 08006, connection failure: a malformed frame among its causes. */
export const SQLSTATE_CONNECTION_FAILURE = '08006';

/** SQLCODE of a data exception, turborel's for SQLSTATE class 22. */
export const SQLCODE_DATA = -301;

/** SQLSTATE 22003, numeric value out of range. */
export const SQLSTATE_NUMERIC_OUT_OF_RANGE = '22003';

/** SQLSTATE 22021, character not in repertoire: a string that is no Unicode text. */
export const SQLSTATE_NOT_IN_REPERTOIRE = '22021';

/** SQLCODE of valid SQL turborel does not process, past one of its limits. */
export const SQLCODE_UNSUPPORTED = -900;

/** SQLSTATE 0A000, feature not supported, turborel's for SQLCODE -900. */
export const SQLSTATE_UNSUPPORTED = '0A000';

/** SQLCODE of an API misused, turborel's own. */
export const SQLCODE_API = -910;

/** SQLSTATE TB910, an API misused, turborel's own class TB. */
export const SQLSTATE_API = 'TB910';

/**
 * What a failure says beyond its codes and message, as the protocol's
 * tags 7 to 15 carry it with `diagnostics`: each absent if not said.
 */
export interface Diagnostics {
  /** ERROR, FATAL, WARNING or NOTICE. */
  readonly severity?: string;
  /** More than the message says, as the key a constraint refused. */
  readonly detail?: string;
  /** What may be done about it. */
  readonly hint?: string;
  /** The trigger or routine running, as `trigger S.T`. */
  readonly context?: string;
  /** The schema of what it is about. */
  readonly schema?: string;
  /** The table or view it is about. */
  readonly table?: string;
  /** The column it is about. */
  readonly column?: string;
  /** The data type of the value it is about. */
  readonly dataType?: string;
  /** The constraint broken. */
  readonly constraint?: string;
}

/** What else a {@link TurborelError} may say, beside its codes and message. */
export interface TurborelErrorOptions {
  /** The rule of a standard the failure cites, as `ISO/IEC 9075:1992 §11.36 GR3`. */
  readonly rule?: string;
  /** Where in the statement it is, in characters. */
  readonly position?: bigint;
  /** Whether the session's transaction is active after the failure. */
  readonly active?: boolean;
  /** Its severity and what it is about, if the server said. */
  readonly diagnostics?: Diagnostics;
  /** The error that caused this one, if it came from below the driver. */
  readonly cause?: unknown;
}

/**
 * A failure, of a statement or of the connection.
 *
 * @remarks
 * The driver throws nothing else and rejects no promise with anything else
 * (RULES.md R-ERR-2). A failure the driver raises itself carries the
 * SQLCODE and SQLSTATE turborel-client gives for the same failure.
 */
export class TurborelError extends Error {
  /** Its SQLCODE: negative for a failure. */
  readonly sqlcode: number;
  /** Its SQLSTATE: five characters, its class the first two. */
  readonly sqlstate: string;
  /** The rule of a standard it cites, if it cites one. */
  readonly rule: string | undefined;
  /** Where in the statement it is, in characters, if known. */
  readonly position: bigint | undefined;
  /** Whether the session's transaction is active after it. */
  readonly active: boolean;
  /** Its severity and what it is about, if the server said. */
  readonly diagnostics: Diagnostics | undefined;

  /**
   * A failure of `sqlcode` and `sqlstate`, saying `message`.
   *
   * @param sqlcode - its SQLCODE
   * @param sqlstate - its SQLSTATE, five characters
   * @param message - what happened, in plain words
   * @param options - the rule it cites, its position, whether a transaction is active, its diagnostics and cause
   */
  constructor(sqlcode: number, sqlstate: string, message: string, options: TurborelErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'TurborelError';
    this.sqlcode = sqlcode;
    this.sqlstate = sqlstate;
    this.rule = options.rule;
    this.position = options.position;
    this.active = options.active ?? false;
    this.diagnostics = options.diagnostics;
  }
}

/**
 * A connection failure (SQLCODE -919, SQLSTATE 08006), saying `message`:
 * what a malformed frame, among other things, fails the connection with.
 *
 * @param message - what happened, in plain words
 * @returns the failure, to be thrown
 */
export function connectionFailure(message: string): TurborelError {
  return new TurborelError(SQLCODE_CONNECTION, SQLSTATE_CONNECTION_FAILURE, message);
}

/**
 * A data exception (SQLCODE -301) of `sqlstate`, saying `message`: a value
 * a program gave that the protocol cannot carry.
 *
 * @param sqlstate - its SQLSTATE, of class 22
 * @param message - what happened, in plain words
 * @returns the failure, to be thrown
 */
export function dataException(sqlstate: string, message: string): TurborelError {
  return new TurborelError(SQLCODE_DATA, sqlstate, message);
}

/**
 * A value past one of turborel's limits (SQLCODE -900, SQLSTATE 0A000),
 * as the server refuses it, saying `message`.
 *
 * @param message - what happened, in plain words
 * @returns the failure, to be thrown
 */
export function beyondLimits(message: string): TurborelError {
  return new TurborelError(SQLCODE_UNSUPPORTED, SQLSTATE_UNSUPPORTED, message);
}

/**
 * The driver's API misused (SQLCODE -910, SQLSTATE TB910), saying
 * `message`: an argument of a type or range the driver does not take.
 *
 * @param message - what happened, in plain words
 * @returns the failure, to be thrown
 */
export function apiMisuse(message: string): TurborelError {
  return new TurborelError(SQLCODE_API, SQLSTATE_API, message);
}
