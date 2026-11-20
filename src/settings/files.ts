/**
 * The files connection settings come from (`[CLIENT The service file]`,
 * `[CLIENT The password file]`), as turborel-client's `settings/files.rs`
 * reads them: a service file of named sections of settings, and a
 * password file of passwords by server and user.
 *
 * A password file should be readable by its owner alone. As
 * turborel-client, the driver checks only that it is a regular file, and
 * its owner answers for the rest.
 *
 * @packageDocumentation
 */

import { readFileSync, statSync } from 'node:fs';

import { Options, invalid } from './options.js';
import type { TurborelError } from '../error.js';

/** What begins a comment line, in either file. */
const COMMENT = '#';
/** What matches any value in a password file. */
const ANY = '*';
/** What escapes the character after it in a password file. */
const ESCAPE = '\\';
/** What separates a password file's fields. */
const SEPARATOR = ':';
/** The fields of a password file's line. */
const FIELDS = 4;

/**
 * The settings of the section `name` of the service file `text`, read from `file`.
 *
 * @param text - the file's text
 * @param name - the section
 * @param file - the file's path, for a failure
 * @returns the section's settings
 * @throws {@link TurborelError} 08001 if a line is malformed or sets no setting, or there is no section `name`
 */
export function service(text: string, name: string, file: string): Options {
  const at = (n: number, why: string): TurborelError => invalid(`${file} line ${String(n)}: ${why}`);
  let found: Options | undefined;
  let current: string | undefined;
  for (const [i, raw] of text.split(/\r?\n/u).entries()) {
    const line = raw.trim();
    const n = i + 1;
    if (line === '' || line.startsWith(COMMENT)) continue;
    if (line.startsWith('[')) {
      if (!line.endsWith(']')) throw at(n, "a section's name ends with ]");
      current = line.slice(1, line.length - 1).trim();
      continue;
    }
    if (current === undefined) throw at(n, 'a setting comes before any section');
    const eq = line.indexOf('=');
    if (eq < 0) throw at(n, 'a setting is <key> = <value>');
    const key = line.slice(0, eq).trim();
    if (key === 'service' || key === 'service_file') throw at(n, `a service cannot set ${key}`);
    let options: Options;
    try {
      options = new Options().set(key, line.slice(eq + 1).trim());
    } catch (e) {
      throw at(n, (e as TurborelError).message);
    }
    if (current === name) found = options.over(found ?? new Options());
  }
  if (found === undefined) throw invalid(`${file} has no service ${name}`);
  return found;
}

/**
 * The settings of the section `name` of the service file at `file`.
 *
 * @param file - the file's path
 * @param name - the section
 * @returns its settings
 * @throws {@link TurborelError} 08001 if it cannot be read, a line is malformed, or it has no section `name`
 */
export function serviceFile(file: string, name: string): Options {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch (e) {
    throw invalid(`cannot read ${file}: ${(e as Error).message}`);
  }
  return service(text, name, file);
}

/**
 * The fields of a password file's line, unescaped: the first three split at each colon not escaped, the fourth the rest.
 *
 * @param line - the line
 * @returns each field, and whether it was written with no escape
 */
function fields(line: string): [string, boolean][] {
  const out: [string, boolean][] = [];
  let [field, escaped, plain] = ['', false, true];
  for (const c of line) {
    if (escaped) [field, escaped, plain] = [field + c, false, false];
    else if (c === ESCAPE) escaped = true;
    else if (c === SEPARATOR && out.length < FIELDS - 1) {
      out.push([field, plain]);
      [field, plain] = ['', true];
    } else field += c;
  }
  out.push([field, plain]);
  return out;
}

/**
 * Whether a field matches `wanted`: a `*` written plain matches anything.
 *
 * @param field - the field, and whether it was written plain
 * @param wanted - the value looked for
 * @returns true if it matches
 */
function matches(field: [string, boolean], wanted: string): boolean {
  const [value, plain] = field;
  return (plain && value === ANY) || value === wanted;
}

/**
 * The password a password file gives `user` at `host` and `port`: that of its first line matching all three.
 *
 * @param text - the file's text
 * @param host - the server's host, or a Unix socket's path
 * @param port - its port
 * @param user - the user
 * @returns the password, or undefined
 */
export function password(text: string, host: string, port: string, user: string): string | undefined {
  for (const line of text.split(/\r?\n/u)) {
    if (line.trimStart().startsWith(COMMENT)) continue;
    const f = fields(line);
    const [h, p, u, pw] = f;
    if (f.length === FIELDS && h !== undefined && p !== undefined && u !== undefined && pw !== undefined) {
      if (matches(h, host) && matches(p, port) && matches(u, user)) return pw[0];
    }
  }
  return undefined;
}

/**
 * The text of the file at `path`, if it is a regular file, a link followed to one, and can be read.
 *
 * @param path - the file's path
 * @returns its text, or undefined
 */
export function readRegular(path: string): string | undefined {
  try {
    return statSync(path).isFile() ? readFileSync(path, 'utf8') : undefined;
  } catch {
    return undefined;
  }
}
