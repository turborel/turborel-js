/**
 * SQL names as an import writes them (`[CLIENT Importing]`), as
 * turborel-client's `import/insert.rs` reads them with turborel's lexer: a
 * table name made of delimited identifiers, so nothing else is taken for
 * one, and the column a source's heading names.
 *
 * @packageDocumentation
 */

import { tokens } from '../sql/lexer.js';

/** The most parts of a table name: catalog, schema and table. */
const MAX_NAME_PARTS = 3;
/** Tokens a table name's parts and periods take, each part and the period after it. */
const PART_TOKENS = 2;

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
  for (let i = 0; ; i += PART_TOKENS) {
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
