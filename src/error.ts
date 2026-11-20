/**
 * The driver's one error type (RULES.md R-ERR-2): every failure, the
 * server's or the driver's own, is a {@link TurborelError} carrying its
 * SQLCODE and SQLSTATE, as turborel-client's `Failure` does.
 *
 * @packageDocumentation
 */

/** SQLCODE of a connection failure, as the protocol's Frames section gives it. */
export const SQLCODE_CONNECTION = -919;

/** SQLSTATE 08006, connection failure: a malformed frame among its causes. */
export const SQLSTATE_CONNECTION_FAILURE = '08006';

/** What else a {@link TurborelError} may say, beside its codes and message. */
export interface TurborelErrorOptions {
  /** The rule of a standard the failure cites, as `ISO/IEC 9075:1992 §11.36 GR3`. */
  readonly rule?: string;
  /** Whether the session's transaction is active after the failure. */
  readonly active?: boolean;
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
  /** Whether the session's transaction is active after it. */
  readonly active: boolean;

  /**
   * A failure of `sqlcode` and `sqlstate`, saying `message`.
   *
   * @param sqlcode - its SQLCODE
   * @param sqlstate - its SQLSTATE, five characters
   * @param message - what happened, in plain words
   * @param options - the rule it cites, whether a transaction is active, and its cause
   */
  constructor(sqlcode: number, sqlstate: string, message: string, options: TurborelErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'TurborelError';
    this.sqlcode = sqlcode;
    this.sqlstate = sqlstate;
    this.rule = options.rule;
    this.active = options.active ?? false;
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
