/**
 * The routine debugger's messages (`[PROTOCOL Debug 'V']`,
 * `[PROTOCOL Debugged 'V']`, `[PROTOCOL Event 'W']`), with `debugger`
 * granted, an extension: Debug asks of the session another connection
 * runs, Debugged answers it where a Complete does not, and an Event tells,
 * unasked, what the debugged session did. Internal.
 *
 * @packageDocumentation
 */

import type { Reader } from './reader.js';
import type { TypeName } from './types.js';
import { readValue, writeValue } from './value-codec.js';
import type { Value } from './values.js';
import type { Writer } from './writer.js';

/** What a breakpoint's routine is: a procedure, a function or a trigger. */
export type RoutineKind = 'procedure' | 'function' | 'trigger';

/** How a paused session goes on: into, to its next statement; over, to this frame's next; out, to the next of the frame it returns to; or continue, to a breakpoint. */
export type ResumeAction = 'into' | 'over' | 'out' | 'continue';

/** A breakpoint set: its number, its routine's specific name, its line from 1 and its condition, if any. */
export interface Breakpoint {
  /** Its number, which `clear` names it by. */
  readonly number: number;
  /** Its routine's specific name, or the trigger's name. */
  readonly routine: TypeName;
  /** The line of the routine's text, from 1. */
  readonly line: number;
  /** The `<search condition>` it pauses only where true, if any. */
  readonly condition?: string;
}

/** A Debug request. */
export type DebugRequest =
  | { readonly what: 'identify' | 'detach' | 'breakpoints' | 'interrupt' | 'stack' }
  | { readonly what: 'attach'; readonly connection: bigint }
  | {
      readonly what: 'break';
      readonly kind: RoutineKind;
      readonly routine: TypeName;
      readonly line: number;
      readonly condition?: string;
    }
  | { readonly what: 'clear'; readonly number: number }
  | { readonly what: 'resume'; readonly action: ResumeAction };

/** A parameter or a variable of a frame: its name, its type as SQL writes it, its value. */
export interface Named {
  /** Its name. */
  readonly name: string;
  /** Its type, as SQL writes it. */
  readonly dataType: string;
  /** Its value. */
  readonly value: Value;
}

/** A cursor of a frame: its name, whether it is open, and its query. */
export interface CursorShown {
  /** Its name. */
  readonly name: string;
  /** Whether it is open. */
  readonly open: boolean;
  /** Its query's text. */
  readonly query: string;
}

/** What routine a frame runs: its kind, its specific name, and its name. */
export interface Origin {
  /** A procedure, a function or a trigger. */
  readonly kind: RoutineKind;
  /** Its specific name. */
  readonly name: TypeName;
  /** Its name, as it was created. */
  readonly shown: TypeName;
}

/** A frame of a paused session's call stack: a run of a routine's or a trigger's body, or of a statement run directly. */
export interface Frame {
  /** The routine it runs; none of a statement run directly. */
  readonly origin?: Origin;
  /** Whether the debugger may see into it; one not visible shows its origin alone. */
  readonly visible: boolean;
  /** Its place, in characters from the beginning of the routine's text. */
  readonly at?: bigint;
  /** Its line, from 1. */
  readonly line?: number;
  /** Its column, from 1. */
  readonly column?: number;
  /** Its parameters; of a trigger, its transition variables. */
  readonly parameters: readonly Named[];
  /** Its variables. */
  readonly variables: readonly Named[];
  /** Its cursors. */
  readonly cursors: readonly CursorShown[];
}

/** A pause: at a breakpoint, its number, or at the end of a step; and the call stack, the outermost frame first. */
export interface Paused {
  /** Why it paused. */
  readonly reason: 'breakpoint' | 'step';
  /** The breakpoint it paused at, if it did. */
  readonly breakpoint?: number;
  /** Its frames, the outermost first. */
  readonly frames: readonly Frame[];
}

/** What Debugged answers: a connection's ID, a breakpoint, every breakpoint, or a pause, if paused. */
export type DebugReply =
  | { readonly what: 'connection'; readonly id: bigint }
  | { readonly what: 'breakpoint'; readonly breakpoint: Breakpoint }
  | { readonly what: 'breakpoints'; readonly breakpoints: readonly Breakpoint[] }
  | { readonly what: 'stack'; readonly paused?: Paused };

/** What the debugger hears of its target: a pause, a pause that timed out, a statement cancelled while paused, or the target's session ended. */
export type DebugEvent =
  { readonly what: 'paused'; readonly paused: Paused } | { readonly what: 'timedOut' | 'cancelled' | 'ended' };

/** Each Debug request's code, by what it asks. */
const REQUESTS: readonly DebugRequest['what'][] = [
  'identify',
  'attach',
  'detach',
  'break',
  'clear',
  'breakpoints',
  'resume',
  'interrupt',
  'stack',
];
/** Each kind of routine's code. */
const KINDS: readonly RoutineKind[] = ['procedure', 'function', 'trigger'];
/** Each action's code. */
const ACTIONS: readonly ResumeAction[] = ['into', 'over', 'out', 'continue'];
/** Each Debugged's code. */
const REPLIES: readonly DebugReply['what'][] = ['connection', 'breakpoint', 'breakpoints', 'stack'];
/** Each event's code. */
const EVENTS: readonly DebugEvent['what'][] = ['paused', 'timedOut', 'cancelled', 'ended'];
/** A pause's reason's code: at a breakpoint 0, a step 1. */
const REASONS: readonly Paused['reason'][] = ['breakpoint', 'step'];

/**
 * The value of `code` in `table`, or a malformed message.
 *
 * @param r - the reader
 * @param table - the values, by their codes
 * @param what - what the code is of
 * @returns the value
 * @throws {@link TurborelError} 08006 for a code of none
 */
function coded<T>(r: Reader, table: readonly T[], what: string): T {
  const code = r.u8();
  const found = table[code];
  if (found === undefined) throw r.corrupt(`${String(code)} is no ${what}'s code`);
  return found;
}

/**
 * A string if its flag says one follows.
 *
 * @param r - the reader
 * @returns it, or undefined
 */
function given(r: Reader): string | undefined {
  return r.flag() ? r.string() : undefined;
}

/**
 * Writes a flag, then `s` if there is one.
 *
 * @param w - the writer
 * @param s - the string, if any
 */
function writeGiven(w: Writer, s: string | undefined): void {
  w.flag(s !== undefined);
  if (s !== undefined) w.string(s);
}

/**
 * Reads a schema and a name.
 *
 * @param r - the reader
 * @returns the name
 */
function readName(r: Reader): TypeName {
  return { schema: r.string(), name: r.string() };
}

/**
 * Writes the body of a Debug request.
 *
 * @param w - the writer
 * @param q - the request
 */
export function writeDebug(w: Writer, q: DebugRequest): void {
  w.u8(REQUESTS.indexOf(q.what));
  if (q.what === 'attach') w.u64(q.connection);
  else if (q.what === 'break') {
    w.u8(KINDS.indexOf(q.kind)).string(q.routine.schema).string(q.routine.name).u32(q.line);
    writeGiven(w, q.condition);
  } else if (q.what === 'clear') w.u32(q.number);
  else if (q.what === 'resume') w.u8(ACTIONS.indexOf(q.action));
}

/**
 * Reads a breakpoint.
 *
 * @param r - the reader
 * @returns it
 */
function readBreakpoint(r: Reader): Breakpoint {
  const number = r.u32();
  const routine = readName(r);
  const line = r.u32();
  const condition = given(r);
  return { number, routine, line, ...(condition === undefined ? {} : { condition }) };
}

/**
 * Writes a breakpoint.
 *
 * @param w - the writer
 * @param b - the breakpoint
 */
function writeBreakpoint(w: Writer, b: Breakpoint): void {
  w.u32(b.number).string(b.routine.schema).string(b.routine.name).u32(b.line);
  writeGiven(w, b.condition);
}

/**
 * Reads a parameter or a variable of a frame.
 *
 * @param r - the reader
 * @returns it
 */
function readNamed(r: Reader): Named {
  return { name: r.string(), dataType: r.string(), value: readValue(r) };
}

/**
 * Reads a frame: its origin, whether visible, its place, line and column, its parameters, variables and cursors.
 *
 * @param r - the reader
 * @returns it
 */
function readFrame(r: Reader): Frame {
  const origin = r.flag()
    ? { kind: coded(r, KINDS, 'routine kind'), name: readName(r), shown: readName(r) }
    : undefined;
  const visible = r.flag();
  const at = r.flag() ? r.u64() : undefined;
  const place = r.flag() ? { line: r.u32(), column: r.u32() } : {};
  const parameters = r.list(readNamed);
  const variables = r.list(readNamed);
  const cursors = r.list((inner): CursorShown => ({ name: inner.string(), open: inner.flag(), query: inner.string() }));
  return {
    ...(origin === undefined ? {} : { origin }),
    visible,
    ...(at === undefined ? {} : { at }),
    ...place,
    parameters,
    variables,
    cursors,
  };
}

/**
 * Writes a frame.
 *
 * @param w - the writer
 * @param f - the frame
 */
function writeFrame(w: Writer, f: Frame): void {
  w.flag(f.origin !== undefined);
  if (f.origin !== undefined) {
    const { kind, name, shown } = f.origin;
    w.u8(KINDS.indexOf(kind)).string(name.schema).string(name.name).string(shown.schema).string(shown.name);
  }
  w.flag(f.visible).flag(f.at !== undefined);
  if (f.at !== undefined) w.u64(f.at);
  w.flag(f.line !== undefined);
  if (f.line !== undefined) w.u32(f.line).u32(f.column ?? 0);
  for (const list of [f.parameters, f.variables]) {
    w.list(list, (inner, n) => {
      writeValue(inner.string(n.name).string(n.dataType), n.value);
    });
  }
  w.list(f.cursors, (inner, c) => inner.string(c.name).flag(c.open).string(c.query));
}

/**
 * Reads a pause: its reason, then its frames.
 *
 * @param r - the reader
 * @returns it
 */
function readPause(r: Reader): Paused {
  const reason = coded(r, REASONS, 'pause reason');
  const breakpoint = reason === 'breakpoint' ? { breakpoint: r.u32() } : {};
  return { reason, ...breakpoint, frames: r.list(readFrame) };
}

/**
 * Writes a pause.
 *
 * @param w - the writer
 * @param p - the pause
 */
function writePause(w: Writer, p: Paused): void {
  w.u8(REASONS.indexOf(p.reason));
  if (p.reason === 'breakpoint') w.u32(p.breakpoint ?? 0);
  w.list(p.frames, writeFrame);
}

/**
 * Reads the body of a Debugged.
 *
 * @param r - the reader
 * @returns what it answers
 */
export function readDebugged(r: Reader): DebugReply {
  const what = coded(r, REPLIES, 'Debugged');
  if (what === 'connection') return { what, id: r.u64() };
  if (what === 'breakpoint') return { what, breakpoint: readBreakpoint(r) };
  if (what === 'breakpoints') return { what, breakpoints: r.list(readBreakpoint) };
  return r.flag() ? { what, paused: readPause(r) } : { what };
}

/**
 * Writes the body of a Debugged.
 *
 * @param w - the writer
 * @param d - what it answers
 */
export function writeDebugged(w: Writer, d: DebugReply): void {
  w.u8(REPLIES.indexOf(d.what));
  if (d.what === 'connection') w.u64(d.id);
  else if (d.what === 'breakpoint') writeBreakpoint(w, d.breakpoint);
  else if (d.what === 'breakpoints') w.list(d.breakpoints, writeBreakpoint);
  else {
    w.flag(d.paused !== undefined);
    if (d.paused !== undefined) writePause(w, d.paused);
  }
}

/**
 * Reads the body of an Event.
 *
 * @param r - the reader
 * @returns the event
 */
export function readEvent(r: Reader): DebugEvent {
  const what = coded(r, EVENTS, 'event');
  return what === 'paused' ? { what, paused: readPause(r) } : { what };
}

/**
 * Writes the body of an Event.
 *
 * @param w - the writer
 * @param e - the event
 */
export function writeEvent(w: Writer, e: DebugEvent): void {
  w.u8(EVENTS.indexOf(e.what));
  if (e.what === 'paused') writePause(w, e.paused);
}
