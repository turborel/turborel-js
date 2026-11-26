/**
 * What each sample frame of `[PROTOCOL Sample frames]` means, as its
 * meaning in the file says it: each server frame's reply in words, as
 * `summary` writes it, and the request of each client frame.
 */

import type { Attribute } from '../../src/codec/tail.js';
import type { DebugRequest } from '../../src/codec/debug.js';
import type { Request } from '../../src/codec/requests.js';

/** UTF-8 octets of `s`. */
const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);

/**
 * A Hello of ANN by trust, asking `capabilities`, with `attributes`.
 *
 * @param capabilities - what it asks for
 * @param attributes - its attributes
 * @param mechanism - its mechanism and first bytes, trust and none by default
 * @returns the request
 */
function hello(
  capabilities: readonly string[],
  attributes: readonly Attribute[] = [],
  mechanism: [string, string] = ['trust', ''],
): Request {
  return {
    kind: 'hello',
    version: 1,
    user: 'ANN',
    mechanism: mechanism[0],
    initial: utf8(mechanism[1]),
    capabilities,
    attributes,
  };
}

/**
 * A Query of `sql`.
 *
 * @param sql - its text
 * @param ends - whether it ends the transaction
 * @param attributes - its attributes
 * @param multi - whether it holds several statements
 * @returns the request
 */
function query(sql: string, ends: boolean, attributes: readonly Attribute[] = [], multi = false): Request {
  return { kind: 'query', sql, ends, attributes, multi };
}

/**
 * A Debug request.
 *
 * @param q - what it asks
 * @returns the request
 */
function debug(q: DebugRequest): Request {
  return { kind: 'debug', debug: q };
}

/** Each server frame's reply, by its name, as its meaning says. */
export const SERVER: Readonly<Record<string, string>> = {
  challenge: 'challenge r=abcdef,s=c2FsdA==,i=4096',
  ready: 'ready ANN key=A5A5A5A5A5A5A5A5A5A5A5A5A5A5A5A5 capabilities=ping server=turborel 0.0.0 (alpha)',
  prepared:
    'prepared 1 parameters=[CHARACTER VARYING(32767) varying; NUMERIC(10,0)] columns=[K NUMERIC(10,0) NOT NULL; (unnamed) CHARACTER VARYING(5)]',
  'prepared-empty': 'prepared 2 parameters=[] columns=[]',
  'prepared-declared':
    'prepared 1 parameters=[CHARACTER VARYING(32767) varying; NUMERIC(10,0)] columns=[K NUMERIC(10,0) NOT NULL declared INTEGER as INTEGER]',
  'prepared-called':
    'prepared 3 parameters=[NUMERIC(10,0)] columns=[G NUMERIC(10,0) NOT NULL] called S.P [in 1 NUMERIC(10,0); out 2 NUMERIC(10,0)]',
  description: 'description [K NUMERIC(10,0) NOT NULL; (unnamed) CHARACTER VARYING(5)]',
  'description-empty': 'description []',
  'description-declared':
    'description [I NUMERIC(10,0) NOT NULL declared INTEGER as INTEGER; S NUMERIC(5,0) declared SMALLINT as SMALLINT; B NUMERIC(18,0) declared BIGINT as BIGINT; D NUMERIC(9,2) declared DECIMAL as DECIMAL(9,2); R FLOAT(24) declared REAL as REAL; P FLOAT(53) declared DOUBLE PRECISION as DOUBLE PRECISION; M NUMERIC(9,2) declared USER-DEFINED as S.MONEY]',
  rows: "rows [1, 'a'] [NULL, '']",
  'rows-none': 'rows',
  'rows-empty-row': 'rows []',
  suspended: 'suspended',
  complete: 'complete 0 00000 active=false',
  'complete-active': 'complete 0 00000 active=true',
  'complete-no-data': 'complete 100 02000 active=false',
  'complete-position': 'complete 0 00000 active=false position=4711',
  'complete-more': 'complete 0 00000 active=false more',
  'complete-rows': 'complete 0 00000 active=false rows=1',
  'complete-every': 'complete 0 00000 active=false position=4711 more rows=3 generated=7,8 time=1500/20/300',
  'complete-conditions': 'complete 0 01004 active=true condition 0 01004 string data, right truncation active=true',
  error: 'error -803 23505 a unique constraint is broken active=false',
  'error-cited':
    'error -803 23505 a unique constraint is broken rule=ISO/IEC 9075-2:2023 §11.7 position=12 active=true',
  'error-diagnostics':
    'error -803 23505 a unique constraint is broken rule=ISO/IEC 9075-2:2023 §11.7 position=12 active=true severity=ERROR detail=key (K)=(1) hint=choose another K context=trigger S.TR schema=S table=T column=K dataType=INTEGER constraint=T_PK',
  'error-connection': 'error -919 08006 a malformed message active=false',
  'lob-data': 'lob data 61C3A9',
  'lob-data-empty': 'lob data ',
  'lob-locator': 'lob locator 4',
  notice: 'notice 01004 string data, right truncation',
  'notice-diagnostics': 'notice 01004 string data, right truncation severity=WARNING detail=cut to 4',
  pong: 'pong',
  'status-server-version': 'status SERVER_VERSION=turborel 0.0.0 (alpha)',
  'status-authorization': 'status AUTHORIZATION=ANN',
  'status-schema': 'status SCHEMA=ANN',
  'status-read-only': 'status READ_ONLY=NO',
  'status-server-read-only': 'status SERVER_READ_ONLY=YES',
  'status-catalog': 'status CATALOG=TURBOREL',
  'status-owner': 'status OWNER=YES',
  'status-time-zone': 'status SESSION.TIME_ZONE=+05:30',
  'status-null': 'status STATEMENT.TIMEOUT_MS=',
  'rows-compressed': `rows ${Array.from({ length: 64 }, (_, i) => `[${String(i)}, '${'abcdefgh'.repeat(4)}']`).join(' ')}`,
  'description-character': 'description [C CHARACTER(4)]',
  'description-character-octets': 'description [C CHARACTER(16 OCTETS)]',
  'description-exact': 'description [C NUMERIC(9,2)]',
  'description-approximate': 'description [C FLOAT(53)]',
  'description-plugin-type': 'description [C ST_GEOMETRY]',
  'description-varying': 'description [C CHARACTER VARYING(20)]',
  'description-binary': 'description [C BINARY(16)]',
  'description-binary-varying': 'description [C BINARY VARYING(255)]',
  'description-date': 'description [C DATE]',
  'description-time': 'description [C TIME(3)]',
  'description-time-zoned': 'description [C TIME(0) WITH TIME ZONE]',
  'description-timestamp': 'description [C TIMESTAMP(6)]',
  'description-timestamp-zoned': 'description [C TIMESTAMP(6) WITH TIME ZONE]',
  'description-interval-year-month': 'description [C INTERVAL YEAR(4) TO MONTH]',
  'description-interval-day-second': 'description [C INTERVAL DAY(2) TO SECOND(6)]',
  'description-boolean': 'description [C BOOLEAN]',
  'description-decfloat': 'description [C DECFLOAT(34)]',
  'description-clob': 'description [C CHARACTER LARGE OBJECT(1048576)]',
  'description-blob': 'description [C BINARY LARGE OBJECT(65536)]',
  'description-json': 'description [C JSON]',
  'description-uuid': 'description [C UUID]',
  'description-array': 'description [C BOOLEAN ARRAY[3]]',
  'description-row': 'description [C ROW(X CHARACTER VARYING(3), Y BOOLEAN)]',
  'description-multiset': 'description [C CHARACTER(2) MULTISET]',
  'description-structured': 'description [C S.SHAPE]',
  'description-reference': 'description [C REF(S.SHAPE)]',
  'description-reference-scoped': 'description [C REF(S.SHAPE) SCOPE S.SHAPES]',
  'description-xml-document': 'description [C XML(DOCUMENT(UNTYPED))]',
  'description-xml-content': 'description [C XML(CONTENT(ANY))]',
  'description-xml-sequence': 'description [C XML(SEQUENCE)]',
  'description-xml-schema': "description [C XML(DOCUMENT(XMLSCHEMA ID S.PO NAMESPACE 'urn:po'))]",
  'description-distinct': 'description [C CHARACTER VARYING(4)]',
  'description-declared-array': 'description [C NUMERIC(10,0) ARRAY[3] declared ARRAY as INTEGER ARRAY[3]]',
  'value-null': 'rows [NULL]',
  'value-character': "rows ['abc']",
  'value-character-empty': "rows ['']",
  'value-character-utf8': "rows ['é€']",
  'value-exact': 'rows [123.45]',
  'value-exact-negative': 'rows [-1]',
  'value-exact-largest': 'rows [170141183460469231731687303715884105727]',
  'value-approximate': 'rows [1.5E0]',
  'value-approximate-negative-zero': 'rows [-0E0]',
  'value-plugin': 'rows [POINT (1 2)]',
  'value-binary': "rows [X'DEADBEEF']",
  'value-binary-empty': "rows [X'']",
  'value-date': "rows [DATE '2024-02-29']",
  'value-time': "rows [TIME '12:34:56.5']",
  'value-time-zoned': "rows [TIME '12:34:56+05:30']",
  'value-timestamp': "rows [TIMESTAMP '2024-02-29 12:34:56.123456']",
  'value-timestamp-zoned': "rows [TIMESTAMP '2024-02-29 12:34:56-08:00']",
  'value-timestamp-earliest': "rows [TIMESTAMP '0001-01-01 00:00:00']",
  'value-interval-year-month': "rows [INTERVAL -'1-02' YEAR(2) TO MONTH]",
  'value-interval-day-second': "rows [INTERVAL '1 02:03:04.500000' DAY(2) TO SECOND(6)]",
  'value-true': 'rows [TRUE]',
  'value-false': 'rows [FALSE]',
  'value-decfloat': "rows [CAST('-1.5' AS DECFLOAT)]",
  'value-array': 'rows [ARRAY[1, NULL]]',
  'value-array-empty': 'rows [ARRAY[]]',
  'value-row': "rows [ROW('x', TRUE)]",
  'value-lob-character': "rows ['aé']",
  'value-lob-binary': "rows [X'00FF']",
  'value-lob-locator': 'rows [<CHARACTER LARGE OBJECT of 200000 characters>]',
  'value-multiset': "rows [MULTISET['a', 'a']]",
  'value-structured': 'rows [S.SHAPE(3, NULL)]',
  'value-reference': 'rows [REF(0102030405060708)]',
  'value-json': 'rows [JSON(\'{"a":[1,"x"]}\')]',
  'value-json-scalars': 'rows [JSON(\'[null,true,false,-2,1.50,"",{}]\')]',
  'value-xml': "rows [XMLPARSE(CONTENT '<a>&lt;</a>' PRESERVE WHITESPACE)]",
  'value-uuid': "rows [UUID '00112233-4455-6677-8899-aabbccddeeff']",
  'debugged-connection': 'debugged connection 2',
  'debugged-breakpoint': 'debugged breakpoint 1 ANN.RAISE_PAY line 4',
  'debugged-breakpoints': 'debugged breakpoints [1 ANN.RAISE_PAY line 4]',
  'debugged-running': 'debugged stack running',
  'debugged-stack':
    'debugged stack at breakpoint 1 frames [procedure ANN.RAISE_PAY (ANN.RAISE_PAY) at 1 line 4 column 3 parameters [PCT INTEGER 10] variables [N INTEGER NULL] cursors [C closed SELECT ID FROM STAFF]]',
  'event-paused':
    'event paused at breakpoint 1 frames [procedure ANN.RAISE_PAY (ANN.RAISE_PAY) at 1 line 4 column 3 parameters [PCT INTEGER 10] variables [N INTEGER NULL] cursors [C closed SELECT ID FROM STAFF]]',
  'event-timed-out': 'event timedOut',
  'event-cancelled': 'event cancelled',
  'event-ended': 'event ended',
};

/** Each client frame's request, by its name, as its meaning says. */
export const CLIENT: Readonly<Record<string, Request>> = {
  'hello-ping': hello(['ping']),
  'hello-none': hello([]),
  'hello-every': hello(['status', 'describe', 'cursors', 'compression', 'declared-types'], [['application', 'app']]),
  'hello-attribute-longest': hello([], [['a'.repeat(64), 'v'.repeat(1024)]]),
  'hello-attributes-most': hello(
    [],
    Array.from({ length: 32 }, (_, i): Attribute => [`a${String(i)}`, '']),
  ),
  'hello-scram': hello([], [], ['scram-sha-256', 'n,,n=,r=abc']),
  answer: { kind: 'answer', answer: utf8('c=biws,r=abc,p=xyz') },
  'answer-empty': { kind: 'answer', answer: new Uint8Array(0) },
  cancel: { kind: 'cancel', key: new Uint8Array(16).fill(0xa5) },
  query: query('VALUES 1', true),
  'query-empty': query('', false),
  'query-attributes': query("VALUES QUERY_ATTRIBUTE('trace')", false, [['trace', 't1']]),
  'query-multi': query('VALUES 1; VALUES 2', true, [], true),
  prepare: { kind: 'prepare', statement: 1, sql: 'SELECT K FROM T WHERE K > ?' },
  execute: { kind: 'execute', statement: 1, cursor: 0, values: [null, '', true], rows: 2, ends: false, attributes: [] },
  'execute-cursor': {
    kind: 'execute',
    statement: 1,
    cursor: 7,
    values: [],
    rows: 0,
    ends: true,
    attributes: [['a', 'b']],
  },
  fetch: { kind: 'fetch', statement: 1, cursor: 0, rows: 100 },
  'fetch-cursor': { kind: 'fetch', statement: 1, cursor: 7, rows: 0xffff_ffff },
  close: { kind: 'close', statement: 1, cursor: 0 },
  'close-cursor': { kind: 'close', statement: 1, cursor: 7 },
  deallocate: { kind: 'deallocate', statement: 0xffff_ffff },
  terminate: { kind: 'terminate' },
  'lob-read': { kind: 'lob', lob: { op: 'read', locator: 3, from: 0n, count: 65_536n, characters: true } },
  'lob-create': { kind: 'lob', lob: { op: 'create', lobKind: 'binary' } },
  'lob-append': { kind: 'lob', lob: { op: 'append', locator: 4, bytes: Uint8Array.of(0xc3) } },
  'lob-free': { kind: 'lob', lob: { op: 'free', locator: 4 } },
  'lob-hold': { kind: 'lob', lob: { op: 'hold', locator: 3 } },
  'describe-statement': { kind: 'describe', what: 'statement', statement: 1, cursor: 0 },
  'describe-cursor': { kind: 'describe', what: 'cursor', statement: 1, cursor: 7 },
  ping: { kind: 'ping' },
  reset: { kind: 'reset' },
  'change-user': { kind: 'changeUser', user: 'BOB', mechanism: 'password', initial: utf8('secret') },
  'copy-in': { kind: 'copyIn', table: 'S.T', columns: ['ID', 'NAME'], ends: true },
  'copy-in-every-column': { kind: 'copyIn', table: 'T', columns: [], ends: false },
  'copy-data': {
    kind: 'copyData',
    rows: [
      ['1', null],
      ['2', 'b'],
    ],
  },
  'copy-end': { kind: 'copyEnd', abandon: false },
  'copy-end-abandon': { kind: 'copyEnd', abandon: true },
  'copy-columns': {
    kind: 'copyColumns',
    rows: 2,
    columns: [
      { nulls: Uint8Array.of(0b10), ends: [1, 1], text: utf8('1') },
      { nulls: Uint8Array.of(0), ends: [1, 1], text: utf8('b') },
    ],
  },
  'query-compressed': query(`SELECT '${'x'.repeat(2000)}' FROM T`, true),
  'debug-identify': debug({ what: 'identify' }),
  'debug-attach': debug({ what: 'attach', connection: 2n }),
  'debug-detach': debug({ what: 'detach' }),
  'debug-break': debug({
    what: 'break',
    kind: 'procedure',
    routine: { schema: 'ANN', name: 'RAISE_PAY' },
    line: 4,
    condition: 'PCT > 5',
  }),
  'debug-clear': debug({ what: 'clear', number: 1 }),
  'debug-breakpoints': debug({ what: 'breakpoints' }),
  'debug-resume': debug({ what: 'resume', action: 'over' }),
  'debug-interrupt': debug({ what: 'interrupt' }),
  'debug-stack': debug({ what: 'stack' }),
};
