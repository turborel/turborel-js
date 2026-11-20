/**
 * The standard API's columns (RULES.md D22): each column a statement
 * gives, with its type's name and its type as SQL writes it, as it was
 * declared where the server told it (`declared-types`), so an INTEGER
 * column is INTEGER and not NUMERIC(10,0).
 *
 * @packageDocumentation
 */

import type { Column } from '../codec/composite.js';
import { columnType, columnTypeName } from '../codec/declared.js';

/** A column of a result, a prepared statement or a cursor. */
export interface ResultColumn extends Column {
  /** Its type's name, as the Information Schema's DATA_TYPE gives it: INTEGER, DECIMAL, CHARACTER VARYING. */
  readonly typeName: string;
  /** Its type as SQL writes it: INTEGER, DECIMAL(9,2), CHARACTER VARYING(20). */
  readonly typeWritten: string;
}

/** Each low-level column's standard API form, made once. */
const MADE = new WeakMap<readonly Column[], readonly ResultColumn[]>();

/**
 * `columns`, each with its type's name and its type written.
 *
 * @param columns - the columns, as the low-level client gives them
 * @returns them, for the standard API
 */
export function resultColumns(columns: readonly Column[]): readonly ResultColumn[] {
  let made = MADE.get(columns);
  if (made === undefined) {
    made = columns.map((c) => ({ ...c, typeName: columnTypeName(c), typeWritten: columnType(c) }));
    MADE.set(columns, made);
  }
  return made;
}
