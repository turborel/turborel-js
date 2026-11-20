/**
 * Predicates of the failures tests expect, shared by the test files
 * (RULES.md R-TEST-6).
 */

import { TurborelError } from '../../src/error.js';

/**
 * A predicate of a `TurborelError` of `sqlcode` and `sqlstate`, for
 * `assert.throws`.
 *
 * @param sqlcode - the SQLCODE expected
 * @param sqlstate - the SQLSTATE expected
 * @returns the predicate
 */
export function isFailure(sqlcode: number, sqlstate: string): (error: unknown) => boolean {
  return (error) => error instanceof TurborelError && error.sqlcode === sqlcode && error.sqlstate === sqlstate;
}

/** Whether a thrown error is a connection failure, SQLCODE -919 and SQLSTATE 08006. */
export const isConnectionFailure = isFailure(-919, '08006');
