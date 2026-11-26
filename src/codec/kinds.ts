/**
 * The kinds of the protocol's messages, each a frame's first octet, read
 * in the direction it travels (`[PROTOCOL Frames]`, `[PROTOCOL Requests]`,
 * `[PROTOCOL Replies]`). Internal.
 *
 * @packageDocumentation
 */

/**
 * The code of a kind's letter.
 *
 * @param letter - one ASCII letter
 * @returns its octet
 */
function kind(letter: string): number {
  return letter.charCodeAt(0);
}

/** The kinds of the requests a client sends. */
export const REQUEST = {
  HELLO: kind('H'),
  ANSWER: kind('A'),
  QUERY: kind('Q'),
  PREPARE: kind('P'),
  EXECUTE: kind('E'),
  FETCH: kind('F'),
  CLOSE: kind('C'),
  DEALLOCATE: kind('D'),
  LOB: kind('L'),
  CANCEL: kind('Z'),
  TERMINATE: kind('X'),
  DESCRIBE: kind('Y'),
  PING: kind('G'),
  RESET: kind('W'),
  CHANGE_USER: kind('U'),
  COPY_IN: kind('I'),
  COPY_DATA: kind('J'),
  COPY_END: kind('N'),
  COPY_COLUMNS: kind('O'),
  DEBUG: kind('V'),
} as const;

/** The kinds of the replies a server sends. */
export const REPLY = {
  CHALLENGE: kind('C'),
  READY: kind('R'),
  PREPARED: kind('P'),
  DESCRIPTION: kind('D'),
  ROWS: kind('B'),
  SUSPENDED: kind('S'),
  COMPLETE: kind('K'),
  ERROR: kind('E'),
  LOB: kind('L'),
  NOTICE: kind('N'),
  STATUS: kind('T'),
  PONG: kind('G'),
  DEBUGGED: kind('V'),
  EVENT: kind('W'),
} as const;

/** The kind of a compressed frame, the same both ways (`[PROTOCOL Compressed frames]`). */
export const COMPRESSED = kind('z');

/** A Lob request's operations (`[PROTOCOL Lob 'L']`, the request). */
export const LOB_OP = { READ: 0, CREATE: 1, APPEND: 2, FREE: 3, HOLD: 4 } as const;

/** A Lob reply's kinds (`[PROTOCOL Lob 'L']`, the reply). */
export const LOB_REPLY = { DATA: 0, LOCATOR: 1 } as const;

/** What a Describe describes: 0 a statement, 1 a cursor (`[PROTOCOL Describe 'Y']`). */
export const DESCRIBED = { STATEMENT: 0, CURSOR: 1 } as const;
