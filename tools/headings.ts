/**
 * The headings of Turborel's documents a citation may name (RULES.md D6),
 * copied from Turborel's main at e97e0aa4, the commit CONFORMANCE.md
 * names: The Native Protocol, `doc/client/05-protocol.md`, and The Client
 * Library and Settings, Pipelines and Pools, `doc/client/02-library.md`
 * and `doc/client/02-library-connections.md`, which share no heading.
 */

/** The Turborel commit the headings are copied at. */
export const TURBOREL_COMMIT = 'e97e0aa4';

/** The headings of The Native Protocol, in its order. */
export const PROTOCOL_HEADINGS: readonly string[] = [
  'The Native Protocol',
  'Frames',
  'Compressed frames',
  'Values and fields',
  'Data types',
  'Values',
  'JSON values',
  'Composite fields',
  'The tail',
  'Opening a connection',
  'Mechanisms',
  'Capabilities',
  'Requests',
  "Hello 'H'",
  "Answer 'A'",
  "Query 'Q'",
  "Prepare 'P'",
  "Execute 'E'",
  "Fetch 'F'",
  "Close 'C'",
  "Deallocate 'D'",
  "Lob 'L'",
  "Cancel 'Z'",
  "Terminate 'X'",
  "Describe 'Y'",
  "Ping 'G'",
  "Reset 'W'",
  "ChangeUser 'U'",
  "CopyIn 'I'",
  "CopyData 'J'",
  "CopyEnd 'N'",
  'Replies',
  "Challenge 'C'",
  "Ready 'R'",
  "Prepared 'P'",
  "Description 'D'",
  "Rows 'B'",
  "Suspended 'S'",
  "Complete 'K'",
  "Error 'E'",
  "Lob 'L'",
  "Notice 'N'",
  "Status 'T'",
  "Pong 'G'",
  'Conversations',
  'Errors and notices',
  'A worked example',
];

/** The headings of the two client documents, in their order. */
export const CLIENT_HEADINGS: readonly string[] = [
  'The Client Library',
  'Connecting',
  'Timeouts',
  'Running statements',
  'Prepared statements',
  'Large objects',
  'XML values',
  'UUIDs',
  'Importing',
  'What a connection asks for',
  'What the server tells',
  'Controlling the session',
  'Copying and exporting',
  'The SQL-agent',
  'Settings, Pipelines and Pools',
  'Connecting by settings',
  'Where settings come from',
  'The connection URI',
  'The service file',
  'The password file',
  'Several servers',
  'TLS by mode',
  'Pipelines',
  'Pools',
  'The SCRAM key cache',
];

/** A heading printed twice in The Native Protocol, under Requests and under Replies. */
export const TWICE_PRINTED = "Lob 'L'";
