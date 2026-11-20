/**
 * What a connection asks of each request before it is sent, and of each
 * failure as it comes, as turborel-client's `session.rs` (`needs`) and
 * `Failure::ends_connection` ask it: the capabilities a request needs
 * granted, and whether a failure loses the connection.
 *
 * @packageDocumentation
 */

import * as cap from './capabilities.js';
import type { Request } from '../codec/requests.js';
import type { TurborelError } from '../error.js';

/** The SQLSTATE class of a connection exception, which loses the connection. */
const CONNECTION_CLASS = '08';
/** SQLSTATE 08003, connection does not exist, which names another connection and loses none. */
const ANOTHER_CONNECTION = '08003';
/** The SQLSTATE class of invalid authorization, which loses a connection being made. */
const AUTHORIZATION_CLASS = '28';
/** SQLCODE of a connection exception. */
const SQLCODE_CONNECTION = -919;

/** The capability each request with one needs, by its kind. */
const NEEDED: Readonly<Partial<Record<Request['kind'], string>>> = {
  describe: cap.DESCRIBE,
  ping: cap.PING,
  reset: cap.RESET,
  changeUser: cap.CHANGE_USER,
  copyIn: cap.COPY,
  copyData: cap.COPY,
  copyEnd: cap.COPY,
};

/**
 * The capabilities `request` needs granted, its tail fields' among them.
 *
 * @param request - the request
 * @returns their names
 */
export function capabilitiesOf(request: Request): string[] {
  const needed: string[] = [];
  const own = NEEDED[request.kind];
  if (own !== undefined) needed.push(own);
  if ((request.kind === 'query' || request.kind === 'execute') && request.attributes.length > 0)
    needed.push(cap.QUERY_ATTRIBUTES);
  if (request.kind === 'query' && request.multi) needed.push(cap.MULTI_STATEMENT);
  if ((request.kind === 'execute' || request.kind === 'fetch' || request.kind === 'close') && request.cursor !== 0) {
    needed.push(cap.CURSORS);
  }
  return needed;
}

/**
 * Whether `failure` loses the connection it came on: a connection
 * exception but 08003, or credentials refused as the connection is made.
 *
 * @param failure - the failure
 * @returns true if the server closes the connection after it
 */
export function endsConnection(failure: TurborelError): boolean {
  const another = failure.sqlstate === ANOTHER_CONNECTION;
  const connecting = failure.sqlcode === SQLCODE_CONNECTION && failure.sqlstate.startsWith(AUTHORIZATION_CLASS);
  return (failure.sqlstate.startsWith(CONNECTION_CLASS) && !another) || connecting;
}
