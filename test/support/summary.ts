/**
 * A reply in one line of words, every field of it, so a test can say
 * what a reply decodes to as the sample frames' meanings do.
 */

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
  switch (reply.kind) {
    case 'challenge':
      return `challenge ${Buffer.from(reply.challenge).toString('utf8')}`;
    case 'ready':
      return `ready ${reply.authorization} key=${hex(reply.key)} capabilities=${reply.capabilities.join(',')} server=${reply.server}`;
    case 'prepared':
      return `prepared ${String(reply.statement)} parameters=[${reply.parameters.map(parameter).join('; ')}] columns=[${reply.columns.map(column).join('; ')}]`;
    case 'description':
      return `description [${reply.columns.map(column).join('; ')}]`;
    case 'rows':
      return `rows ${reply.rows.map((r) => `[${r.map(literalOf).join(', ')}]`).join(' ')}`.trimEnd();
    case 'complete':
      return `complete ${completion(reply.completion)}`;
    case 'error':
      return `error ${failure(reply.failure)}`;
    case 'lobData':
      return `lob data ${hex(reply.data)}`;
    case 'lobLocator':
      return `lob locator ${String(reply.locator)}`;
    case 'notice':
      return `notice ${reply.sqlstate} ${reply.message}${diagnostics(reply.diagnostics)}`;
    case 'status':
      return `status ${reply.name}=${reply.value}`;
    case 'suspended':
    case 'pong':
      return reply.kind;
  }
}
