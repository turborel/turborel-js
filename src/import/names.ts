/**
 * SQL names as an import writes them (`[CLIENT Importing]`), as
 * turborel-client's `import/insert.rs` reads them with turborel's lexer: a
 * table name made of delimited identifiers, so nothing else is taken for
 * one, and the column a source's heading names.
 *
 * @packageDocumentation
 */

/** The longest identifier, in characters, underscores of a regular one not counted. */
const MAX_IDENTIFIER_LENGTH = 128;
/** The most parts of a table name: catalog, schema and table. */
const MAX_NAME_PARTS = 3;

/** The reserved words of turborel's lexer (`src/lexer.rs`, `key_words!`), none of which is a regular identifier. */
const KEY_WORDS: ReadonlySet<string> = new Set(
  (
    'ABSOLUTE ACTION ADD ALL ALLOCATE ALTER AND ANY ARE AS ASC ASSERTION AT AUTHORIZATION AVG ' +
    'BEGIN BETWEEN BIT BIT_LENGTH BOTH BY ' +
    'CASCADE CASCADED CASE CAST CATALOG CHAR CHARACTER CHAR_LENGTH CHARACTER_LENGTH CHECK CLOSE ' +
    'COALESCE COLLATE COLLATION COLUMN COMMIT CONNECT CONNECTION CONSTRAINT CONSTRAINTS CONTINUE ' +
    'CONVERT CORRESPONDING COUNT CREATE CROSS CURRENT CURRENT_DATE CURRENT_TIME CURRENT_TIMESTAMP ' +
    'CURRENT_USER CURSOR ' +
    'DATE DAY DEALLOCATE DEC DECIMAL DECLARE DEFAULT DEFERRABLE DEFERRED DELETE DESC DESCRIBE ' +
    'DESCRIPTOR DIAGNOSTICS DISCONNECT DISTINCT DOMAIN DOUBLE DROP ' +
    'ELSE END ESCAPE EXCEPT EXCEPTION EXEC EXECUTE EXISTS EXTERNAL EXTRACT ' +
    'FALSE FETCH FIRST FLOAT FOR FOREIGN FOUND FROM FULL ' +
    'GET GLOBAL GO GOTO GRANT GROUP ' +
    'HAVING HOUR ' +
    'IDENTITY IMMEDIATE IN INDICATOR INITIALLY INNER INPUT INSENSITIVE INSERT INT INTEGER INTERSECT ' +
    'INTERVAL INTO IS ISOLATION ' +
    'JOIN KEY ' +
    'LANGUAGE LAST LEADING LEFT LEVEL LIKE LOCAL LOWER ' +
    'MATCH MAX MIN MINUTE MODULE MONTH ' +
    'NAMES NATIONAL NATURAL NCHAR NEXT NO NOT NULL NULLIF NUMERIC ' +
    'OCTET_LENGTH OF ON ONLY OPEN OPTION OR ORDER OUTER OUTPUT OVERLAPS ' +
    'PAD PARTIAL POSITION PRECISION PREPARE PRESERVE PRIMARY PRIOR PRIVILEGES PROCEDURE PUBLIC ' +
    'READ REAL REFERENCES RELATIVE RESTRICT REVOKE RIGHT ROLLBACK ROWS ' +
    'SCHEMA SCROLL SECOND SECTION SELECT SESSION SESSION_USER SET SIZE SMALLINT SOME SPACE SQL ' +
    'SQLCODE SQLERROR SQLSTATE SUBSTRING SUM SYSTEM_USER ' +
    'TABLE TEMPORARY THEN TIME TIMESTAMP TIMEZONE_HOUR TIMEZONE_MINUTE TO TRAILING TRANSACTION ' +
    'TRANSLATE TRANSLATION TRIM TRUE ' +
    'UNION UNIQUE UNKNOWN UPDATE UPPER USAGE USER USING ' +
    'VALUE VALUES VARCHAR VARYING VIEW ' +
    'WHEN WHENEVER WHERE WITH WORK WRITE ' +
    'YEAR ZONE'
  ).split(' '),
);

/** A regular identifier's characters: a letter first, then letters, ASCII digits and underscores. */
const REGULAR = /^\p{Alphabetic}[\p{Alphabetic}0-9_]*/u;
/** White space between tokens. */
const SPACE = /^\s+/u;
/** The characters of a comment's opening and closing marks, and of a simple comment's. */
const PAIR = 2;

/**
 * How long the separators at the start of `text` are: white space, `--`
 * comments to the line's end, and bracketed comments, a `/*` within one
 * beginning one nested in it.
 *
 * @param text - the text
 * @returns their length; an unclosed bracketed comment runs to the end
 */
function separators(text: string): number {
  let at = 0;
  for (;;) {
    const space = SPACE.exec(text.slice(at))?.[0].length ?? 0;
    at += space;
    if (text.startsWith('--', at)) {
      const end = text.indexOf('\n', at);
      at = end < 0 ? text.length : end;
    } else if (text.startsWith('/*', at)) {
      let depth = 0;
      do {
        if (text.startsWith('/*', at)) [depth, at] = [depth + 1, at + PAIR];
        else if (text.startsWith('*/', at)) [depth, at] = [depth - 1, at + PAIR];
        else at += 1;
      } while (depth > 0 && at < text.length);
    } else if (space === 0) return at;
  }
}

/** A token of a name: an identifier, a key word, a period, or something else. */
type Token =
  | { readonly kind: 'identifier'; readonly name: string }
  | { readonly kind: 'keyWord'; readonly word: string }
  | { readonly kind: 'period' }
  | { readonly kind: 'other' };

/**
 * The delimited identifier at the start of `text`, its quotes taken off, a doubled quote one.
 *
 * @param text - from its opening quote
 * @returns its name and length, or undefined if it is none
 */
function delimitedIdentifier(text: string): [string, number] | undefined {
  let name = '';
  for (let i = 1; i < text.length; i += 1) {
    const c = text.charAt(i);
    if (c === '\n' || c === '\r') return undefined;
    if (c === '"') {
      if (text.charAt(i + 1) !== '"')
        return name === '' || Array.from(name).length > MAX_IDENTIFIER_LENGTH ? undefined : [name, i + 1];
      i += 1;
    }
    name += c;
  }
  return undefined;
}

/**
 * The tokens of `text`, as turborel's lexer reads a name's.
 *
 * @param text - the text
 * @returns its tokens
 */
function tokens(text: string): Token[] {
  const out: Token[] = [];
  let rest = text;
  for (;;) {
    rest = rest.slice(separators(rest));
    if (rest === '') return out;
    const regular = REGULAR.exec(rest)?.[0];
    if (regular !== undefined && !/^[Xx]'/u.test(rest)) {
      const word = regular.toUpperCase();
      if (KEY_WORDS.has(word)) out.push({ kind: 'keyWord', word });
      else if (Array.from(regular.replaceAll('_', '')).length > MAX_IDENTIFIER_LENGTH)
        return [...out, { kind: 'other' }];
      else out.push({ kind: 'identifier', name: word });
      rest = rest.slice(regular.length);
    } else if (rest.startsWith('"')) {
      const found = delimitedIdentifier(rest);
      if (found === undefined) return [...out, { kind: 'other' }];
      out.push({ kind: 'identifier', name: found[0] });
      rest = rest.slice(found[1]);
    } else if (rest.startsWith('.')) {
      out.push({ kind: 'period' });
      rest = rest.slice(1);
    } else return [...out, { kind: 'other' }];
  }
}

/**
 * `name` as a delimited identifier, a quote in it written twice.
 *
 * @param name - the name
 * @returns it, quoted
 */
export function delimited(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

/**
 * A table name as SQL text of delimited identifiers, so nothing else is taken for one.
 *
 * @param text - a table name, of one to three identifiers joined by periods
 * @returns it, each part delimited
 * @throws Error saying it is not a table name
 */
export function tableName(text: string): string {
  const read = tokens(text);
  const parts: string[] = [];
  for (let i = 0; ; i += PAIR) {
    const part = read[i];
    if (part?.kind !== 'identifier') throw new Error(`${text} is not a <table name>`);
    parts.push(delimited(part.name));
    const next = read[i + 1];
    if (next === undefined) return parts.join('.');
    if (next.kind !== 'period' || parts.length === MAX_NAME_PARTS) throw new Error(`${text} is not a <table name>`);
  }
}

/**
 * The column a heading names: the identifier it is, if it is one, a regular one in upper case, and so a key word; else its name as written.
 *
 * @param heading - the heading's name
 * @returns the column's name
 */
export function columnName(heading: string): string {
  const read = tokens(heading);
  const [only] = read;
  if (read.length !== 1 || only === undefined) return heading;
  if (only.kind === 'identifier') return only.name;
  if (only.kind === 'keyWord') return only.word;
  return heading;
}
