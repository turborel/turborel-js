/**
 * SQL text as turborel's lexer reads the little of it the driver reads
 * itself (`src/lexer.rs`): separators, white space and comments, nested
 * bracketed ones among them; regular identifiers in upper case, its
 * reserved words key words; delimited identifiers; character string
 * literals; periods. Anything else is a token of no kind the driver reads.
 *
 * @packageDocumentation
 */

/** The longest identifier, in characters, underscores of a regular one not counted. */
const MAX_IDENTIFIER_LENGTH = 128;

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
export type Token =
  | { readonly kind: 'identifier'; readonly name: string }
  | { readonly kind: 'keyWord'; readonly word: string }
  | { readonly kind: 'string'; readonly text: string }
  | { readonly kind: 'period' | 'parameter' | 'colon' | 'other' };

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
 * The character string literal at the start of `text`: its quotes taken
 * off, a doubled quote one, and a part after a separator holding a line
 * break joined to it.
 *
 * @param text - from its opening quote
 * @returns its text and length, or undefined if it is not closed
 */
function characterString(text: string): [string, number] | undefined {
  let value = '';
  let at = 0;
  for (;;) {
    let i = at + 1;
    for (; ; i += 1) {
      if (i >= text.length) return undefined;
      if (text.charAt(i) === "'") {
        if (text.charAt(i + 1) !== "'") break;
        i += 1;
      }
      value += text.charAt(i);
    }
    const end = i + 1;
    const gap = separators(text.slice(end));
    if (!text.slice(end, end + gap).includes('\n') || text.charAt(end + gap) !== "'") return [value, end];
    at = end + gap;
  }
}

/** The single characters read as tokens of their own. */
const SINGLE: Readonly<Record<string, Token>> = {
  '.': { kind: 'period' },
  '?': { kind: 'parameter' },
  ':': { kind: 'colon' },
};

/**
 * The token at the start of `rest`, no separator before it.
 *
 * @param rest - the text
 * @returns the token and its length, or undefined for one the driver does not read
 */
function token(rest: string): [Token, number] | undefined {
  const regular = REGULAR.exec(rest)?.[0];
  if (regular !== undefined && !/^[Xx]'/u.test(rest)) {
    const word = regular.toUpperCase();
    if (KEY_WORDS.has(word)) return [{ kind: 'keyWord', word }, regular.length];
    if (Array.from(regular.replaceAll('_', '')).length > MAX_IDENTIFIER_LENGTH) return undefined;
    return [{ kind: 'identifier', name: word }, regular.length];
  }
  if (rest.startsWith('"')) {
    const found = delimitedIdentifier(rest);
    return found === undefined ? undefined : [{ kind: 'identifier', name: found[0] }, found[1]];
  }
  if (rest.startsWith("'")) {
    const found = characterString(rest);
    return found === undefined ? undefined : [{ kind: 'string', text: found[0] }, found[1]];
  }
  const single = SINGLE[rest.charAt(0)];
  return single === undefined ? undefined : [single, 1];
}

/**
 * The tokens of `text`, as turborel's lexer reads them, up to the first it does not read, given as `other`.
 *
 * @param text - the text
 * @returns its tokens
 */
export function tokens(text: string): Token[] {
  const out: Token[] = [];
  let rest = text;
  for (;;) {
    rest = rest.slice(separators(rest));
    if (rest === '') return out;
    const found = token(rest);
    if (found === undefined) return [...out, { kind: 'other' }];
    out.push(found[0]);
    rest = rest.slice(found[1]);
  }
}
