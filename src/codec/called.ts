/**
 * Parameter modes (`[PROTOCOL Parameter modes]`): with `parameter-modes`
 * granted, a Prepared of a CALL of an SQL-invoked procedure ends with tail
 * 20, the procedure's specific name and each of the statement's `?`s in
 * the order written, OUT ones too: the mode and ordinal position of the
 * parameter whose argument holds it, and its type. Internal.
 *
 * @packageDocumentation
 */

import { type Column, type Parameter, readColumn, readParameter, writeParameter } from './composite.js';
import { readDeclared } from './declared.js';
import type { Reader } from './reader.js';
import { CALLED, DECLARED, Tail } from './tail.js';
import type { TypeName } from './types.js';
import type { Writer } from './writer.js';

/** The mode of a procedure's parameter, as SQL names it: IN, INOUT or OUT. */
export type ParameterMode = 'in' | 'inout' | 'out';

/** Each mode's code, as the protocol and the standard's Table 33 code them. */
const MODE_CODES: Readonly<Record<ParameterMode, number>> = { in: 1, inout: 2, out: 4 };

/** A dynamic parameter, a `?`: its type, and the mode and ordinal position of the parameter whose argument holds it. */
export interface DynamicParameter extends Parameter {
  /** IN, of every `?` not of a CALL's OUT or INOUT parameter. */
  readonly mode: ParameterMode;
  /** Of a CALL's `?`, its parameter's ordinal position, from 1; of another, none. */
  readonly ordinal?: number;
}

/** What a Prepared of a CALL tells of the procedure it invokes and of its `?`s. */
export interface Called {
  /** The procedure's specific name. */
  readonly procedure: TypeName;
  /** Each `?` of the statement, in the order written. */
  readonly parameters: readonly DynamicParameter[];
}

/** A Prepared's columns and what it tells of a CALL. */
export interface PreparedTail {
  /** The columns, each with its declared type if told. */
  readonly columns: Column[];
  /** Of a CALL of an SQL-invoked procedure, as told. */
  readonly called?: Called;
}

/**
 * Reads one `?` of tail 20: its mode, its ordinal position, its type.
 *
 * @param r - the reader
 * @returns it
 * @throws {@link TurborelError} 08006 for a mode of another code, or a position of 0
 */
function readCalledParameter(r: Reader): DynamicParameter {
  const code = r.u8();
  const mode = (Object.keys(MODE_CODES) as ParameterMode[]).find((m) => MODE_CODES[m] === code);
  if (mode === undefined) throw r.corrupt(`${String(code)} is no parameter mode's code`);
  const ordinal = r.u32();
  if (ordinal === 0) throw r.corrupt("a parameter's ordinal position is from 1");
  return { mode, ordinal, ...readParameter(r) };
}

/**
 * Reads a Prepared's columns, then its tail: tag 19, their declared types, and tag 20, what it tells of a CALL.
 *
 * @param r - the reader
 * @returns the columns and what it tells of a CALL
 */
export function readPreparedColumns(r: Reader): PreparedTail {
  let columns = r.list(readColumn);
  const tail = new Tail([DECLARED, CALLED]);
  for (let tag = tail.next(r); tag !== undefined; tag = tail.next(r)) {
    if (tag === DECLARED) {
      columns = readDeclared(r, columns);
      continue;
    }
    const procedure = { schema: r.string(), name: r.string() };
    return { columns, called: { procedure, parameters: r.list(readCalledParameter) } };
  }
  return { columns };
}

/**
 * Writes tail 20, if there is a CALL to tell of.
 *
 * @param w - the writer
 * @param called - what it tells, if anything
 */
export function writeCalled(w: Writer, called: Called | undefined): void {
  if (called === undefined) return;
  w.u8(CALLED).string(called.procedure.schema).string(called.procedure.name);
  w.list(called.parameters, (inner, p) => {
    writeParameter(inner.u8(MODE_CODES[p.mode]).u32(p.ordinal ?? 0), p);
  });
}

/**
 * Every `?` of a statement: as tail 20 told them, or else each input an IN one, of no position.
 *
 * @param inputs - the parameters an execution gives values for
 * @param called - what a Prepared of a CALL told, if it did
 * @returns each `?`, in the order written
 */
export function dynamicParameters(inputs: readonly Parameter[], called: Called | undefined): DynamicParameter[] {
  return called === undefined ? inputs.map((p) => ({ mode: 'in', ...p })) : [...called.parameters];
}
