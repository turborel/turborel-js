/**
 * A reply in one line of words, every field of it, so a test can say
 * what a reply decodes to as the sample frames' meanings do.
 */

import type { Called } from '../../src/codec/called.js';
import type { Breakpoint, DebugReply, Frame, Named, Paused } from '../../src/codec/debug.js';
import type { Column, Parameter } from '../../src/codec/composite.js';
import { typeWritten } from '../../src/codec/declared.js';
import type { Completion, Reply } from '../../src/codec/replies.js';
import { literalOf } from '../../src/codec/text.js';
import type { Diagnostics, TurborelError } from '../../src/error.js';

/**
 * Octets as upper-case hexadecimal digits.
 *
 * @param bytes - the octets
 * @returns their digits
 */
function hex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('hex').toUpperCase();
}

/**
 * A column: its name, its type as its tag says, NOT NULL if so, and its declared type if told.
 *
 * @param c - the column
 * @returns it, in words
 */
function column(c: Column): string {
  const declared = c.declared === undefined ? '' : ` declared ${c.declared.name} as ${c.declared.written}`;
  return `${c.name ?? '(unnamed)'} ${typeWritten(c.type)}${c.notNull ? ' NOT NULL' : ''}${declared}`;
}

/**
 * A parameter: its type, varying if flagged.
 *
 * @param p - the parameter
 * @returns it, in words
 */
function parameter(p: Parameter): string {
  return `${typeWritten(p.type)}${p.varying ? ' varying' : ''}`;
}

/**
 * What a Prepared of a CALL tells: its procedure, and each `?`'s mode, position and type.
 *
 * @param c - what it tells, if anything
 * @returns it, in words, or the empty string if nothing
 */
function called(c: Called | undefined): string {
  if (c === undefined) return '';
  const each = c.parameters.map((p) => `${p.mode} ${String(p.ordinal)} ${parameter(p)}`);
  return ` called ${c.procedure.schema}.${c.procedure.name} [${each.join('; ')}]`;
}

/**
 * A breakpoint: its number, routine, line and condition.
 *
 * @param b - the breakpoint
 * @returns it, in words
 */
function breakpoint(b: Breakpoint): string {
  const condition = b.condition === undefined ? '' : ` when ${b.condition}`;
  return `${String(b.number)} ${b.routine.schema}.${b.routine.name} line ${String(b.line)}${condition}`;
}

/**
 * A frame: its origin, whether visible, its place, its parameters, variables and cursors.
 *
 * @param f - the frame
 * @returns it, in words
 */
function frame(f: Frame): string {
  const origin =
    f.origin === undefined
      ? 'direct'
      : `${f.origin.kind} ${f.origin.name.schema}.${f.origin.name.name} (${f.origin.shown.schema}.${f.origin.shown.name})`;
  const at = f.at === undefined ? '' : ` at ${String(f.at)}`;
  const line = f.line === undefined ? '' : ` line ${String(f.line)} column ${String(f.column)}`;
  const named = (list: readonly Named[]): string =>
    list.map((n) => `${n.name} ${n.dataType} ${literalOf(n.value)}`).join(', ');
  const cursors = f.cursors.map((c) => `${c.name} ${c.open ? 'open' : 'closed'} ${c.query}`).join(', ');
  return `${origin}${f.visible ? '' : ' hidden'}${at}${line} parameters [${named(f.parameters)}] variables [${named(f.variables)}] cursors [${cursors}]`;
}

/**
 * A pause: its reason, and its frames.
 *
 * @param p - the pause
 * @returns it, in words
 */
function paused(p: Paused): string {
  const reason = p.reason === 'breakpoint' ? `at breakpoint ${String(p.breakpoint)}` : 'a step';
  return `${reason} frames [${p.frames.map(frame).join('; ')}]`;
}

/**
 * What a Debugged answers.
 *
 * @param d - the answer
 * @returns it, in words
 */
function debugged(d: DebugReply): string {
  if (d.what === 'connection') return `connection ${String(d.id)}`;
  if (d.what === 'breakpoint') return `breakpoint ${breakpoint(d.breakpoint)}`;
  if (d.what === 'breakpoints') return `breakpoints [${d.breakpoints.map(breakpoint).join('; ')}]`;
  return d.paused === undefined ? 'stack running' : `stack ${paused(d.paused)}`;
}

/**
 * Diagnostics, each field told.
 *
 * @param d - the diagnostics
 * @returns them, in words, or the empty string if none
 */
function diagnostics(d: Diagnostics | undefined): string {
  if (d === undefined) return '';
  return Object.entries(d)
    .map(([k, v]) => ` ${k}=${String(v)}`)
    .join('');
}

/**
 * A failure: its codes, message, rule, position, whether active, and diagnostics.
 *
 * @param f - the failure
 * @returns it, in words
 */
function failure(f: TurborelError): string {
  const rule = f.rule === undefined ? '' : ` rule=${f.rule}`;
  const position = f.position === undefined ? '' : ` position=${String(f.position)}`;
  return `${String(f.sqlcode)} ${f.sqlstate} ${f.message}${rule}${position} active=${String(f.active)}${diagnostics(f.diagnostics)}`;
}

/**
 * A completion: its codes, whether active, then each tail field it has.
 *
 * @param c - the completion
 * @returns it, in words
 */
function completion(c: Completion): string {
  const parts = [`${String(c.sqlcode)} ${c.sqlstate} active=${String(c.active)}`];
  if (c.position !== undefined) parts.push(`position=${String(c.position)}`);
  if (c.more) parts.push('more');
  if (c.rows !== undefined) parts.push(`rows=${String(c.rows)}`);
  if (c.generated.length > 0) parts.push(`generated=${c.generated.join(',')}`);
  for (const f of c.conditions) parts.push(`condition ${failure(f)}`);
  if (c.time !== undefined) {
    parts.push(`time=${String(c.time.total)}/${String(c.time.queued)}/${String(c.time.locks)}`);
  }
  return parts.join(' ');
}

/**
 * `reply` in one line of words.
 *
 * @param reply - the reply
 * @returns it, every field told
 */
export function summary(reply: Reply): string {
  return (SUMMARIES[reply.kind] as (r: Reply) => string)(reply);
}

/** How each kind of reply is told in words. */
const SUMMARIES: { readonly [K in Reply['kind']]: (r: Extract<Reply, { kind: K }>) => string } = {
  challenge: (r) => `challenge ${Buffer.from(r.challenge).toString('utf8')}`,
  ready: (r) =>
    `ready ${r.authorization} key=${hex(r.key)} capabilities=${r.capabilities.join(',')} server=${r.server}`,
  prepared: (r) =>
    `prepared ${String(r.statement)} parameters=[${r.parameters.map(parameter).join('; ')}] columns=[${r.columns.map(column).join('; ')}]${called(r.called)}`,
  description: (r) => `description [${r.columns.map(column).join('; ')}]`,
  rows: (r) => `rows ${r.rows.map((row) => `[${row.map(literalOf).join(', ')}]`).join(' ')}`.trimEnd(),
  complete: (r) => `complete ${completion(r.completion)}`,
  error: (r) => `error ${failure(r.failure)}`,
  lobData: (r) => `lob data ${hex(r.data)}`,
  lobLocator: (r) => `lob locator ${String(r.locator)}`,
  notice: (r) => `notice ${r.sqlstate} ${r.message}${diagnostics(r.diagnostics)}`,
  status: (r) => `status ${r.name}=${r.value}`,
  suspended: () => 'suspended',
  pong: () => 'pong',
  debugged: (r) => `debugged ${debugged(r.debugged)}`,
  event: (r) => `event ${r.event.what}${r.event.what === 'paused' ? ` ${paused(r.event.paused)}` : ''}`,
};
