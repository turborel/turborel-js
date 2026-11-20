/**
 * The examples tool (RULES.md D22, R-DOC-7): every JavaScript example of
 * the manual run against the live tests' server, each page's in order
 * against a server of its own, and what each prints compared with the
 * output its last comment lines give. A page's examples are written as a
 * reader runs them, one after another; the port 7422 is the live server's,
 * the file `/etc/turborel/ca.pem` its test authority's, and the password
 * `pencil` ANN's. Run by `npm run examples`, with TURBOREL_TEST_SERVER
 * naming the server; it prints each example that fails, and fails if one
 * does.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Trust } from '../src/auth/mechanism.js';
import { connectTo } from '../src/session/connect.js';
import { tcp } from '../src/transport/target.js';
import { PORT, TEST_SERVER, USERS, startLive } from '../test/server/server.js';

/** The repository, two directories above the compiled tool. */
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
/** An example: a fenced block of JavaScript. */
const BLOCK = /^```js\n([\s\S]*?)^```$/gmu;
/** How long an example may run. */
const WITHIN = 60_000;

/** An example of a page, and the output it should print. */
interface Example {
  readonly code: string;
  readonly expected: string | undefined;
}

/**
 * The examples of a page.
 *
 * @param text - the page
 * @returns its examples, in order
 */
export function examplesOf(text: string): Example[] {
  return [...text.matchAll(BLOCK)].map(([, body = '']) => {
    const lines = body.trimEnd().split('\n');
    let first = lines.length;
    while (first > 0 && lines[first - 1]?.startsWith('//') === true) first -= 1;
    const output = lines.slice(first);
    const expected = output.length === 0 ? undefined : output.map((line) => line.replace(/^\/\/ ?/u, '')).join('\n');
    return { code: body, expected };
  });
}

/**
 * The pages of the manual, in order.
 *
 * @param dir - the manual's directory
 * @returns each page's path
 */
function pages(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((e) => (e.isDirectory() ? pages(join(dir, e.name)) : e.name.endsWith('.md') ? [join(dir, e.name)] : []));
}

/**
 * Runs a page's examples against a server of its own.
 *
 * @param page - the page's path
 * @param examples - its examples
 * @returns why each that failed did
 */
async function runPage(page: string, examples: readonly Example[]): Promise<string[]> {
  const live = await startLive();
  if (live === undefined) throw new Error(`set ${TEST_SERVER} to run the examples`);
  const work = mkdtempSync(join(tmpdir(), 'turborel-js-examples-'));
  const failures: string[] = [];
  try {
    const owner = await connectTo(tcp('127.0.0.1', PORT), 'ann', new Trust());
    await owner.query('CREATE SCHEMA AUTHORIZATION ANN');
    await owner.query('COMMIT');
    await owner.terminate();
    mkdirSync(join(work, 'node_modules'));
    symlinkSync(ROOT, join(work, 'node_modules', 'turborel'), 'junction');
    for (const [i, example] of examples.entries()) {
      const code = example.code
        .replaceAll('7422', String(PORT))
        .replaceAll('/etc/turborel/ca.pem', live.pki.ca.replaceAll('\\', '\\\\'))
        .replaceAll("'pencil'", `'${USERS.ann}'`);
      const file = join(work, `example-${String(i + 1)}.${code.includes('require(') ? 'cjs' : 'mjs'}`);
      writeFileSync(file, code);
      let printed: string;
      try {
        printed = execFileSync(process.execPath, [file], {
          cwd: work,
          timeout: WITHIN,
          encoding: 'utf8',
          stdio: 'pipe',
        });
      } catch (e) {
        failures.push(
          `${relative(ROOT, page)}, example ${String(i + 1)}: it failed: ${(e as { stderr?: string }).stderr ?? String(e)}`,
        );
        continue;
      }
      const shown = printed
        .trimEnd()
        .split('\n')
        .map((l) => l.trimEnd())
        .join('\n');
      if (example.expected !== undefined && shown !== example.expected) {
        failures.push(
          `${relative(ROOT, page)}, example ${String(i + 1)}: it printed\n${shown}\nnot\n${example.expected}`,
        );
      }
    }
  } finally {
    await live.stop();
    rmSync(work, { recursive: true, force: true });
  }
  return failures;
}

/** Runs every page's examples, and fails if one fails. */
async function main(): Promise<void> {
  const failures: string[] = [];
  let ran = 0;
  for (const page of pages(join(ROOT, 'doc'))) {
    const examples = examplesOf(readFileSync(page, 'utf8'));
    if (examples.length === 0) continue;
    ran += examples.length;
    failures.push(...(await runPage(page, examples)));
  }
  for (const failure of failures) console.error(failure);
  console.log(`${String(ran)} examples, ${String(failures.length)} failed`);
  if (failures.length > 0) process.exitCode = 1;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e: unknown) => {
    console.error(e);
    process.exitCode = 1;
  });
}
