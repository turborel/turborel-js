/**
 * The checks tool (RULES.md D4): the rules no linter holds. Every test
 * cites what it verifies by a tag of D6 (R-TRACE-1); every citation names
 * a heading, decision or rule that exists (R-TRACE-2); no open-work marker
 * is left (R-DOC-5); and the manual keeps Turborel's layout, its titles,
 * `[Contents](README.md)` lines and links (R-DOC-7). Run by
 * `npm run check`, and by `npm test` before the tests; it prints each
 * problem and fails if there is any.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CLIENT_HEADINGS, PROTOCOL_HEADINGS, TWICE_PRINTED } from './headings.js';

/** A problem found: the file, its line, and what is wrong. */
export interface Problem {
  /** The file, relative to the repository. */
  readonly file: string;
  /** The line, counting from 1. */
  readonly line: number;
  /** What is wrong. */
  readonly why: string;
}

/** What a repository's RULES.md defines: its decisions and its rules. */
export interface Defined {
  /** Each decision, as `D9`. */
  readonly decisions: ReadonlySet<string>;
  /** Each rule, as `R-ERR-1`. */
  readonly rules: ReadonlySet<string>;
}

/** The tags of D6 a test's citation begins with. */
const TAGS = /^Verifies: \[(?:PROTOCOL [^\]]+|CLIENT [^\]]+|DESIGN\] D\d+|TOOL\] R-[A-Z]+-\d+)/u;

/** A citation of a heading. */
const HEADING_CITATION = /\[(PROTOCOL|CLIENT) ([^\]]+)\]/gu;

/** A citation of a decision, as a tag or by RULES.md, not of Turborel's own RULES.md. */
const DECISION_CITATION = /(?<!Turborel's )(?:\[DESIGN\] |RULES\.md )(D\d+)/gu;

/** A citation of a rule. */
const RULE_CITATION = /\bR-[A-Z]+-\d+\b/gu;

/** The open-work markers no file keeps (R-DOC-5), spelt apart so this file holds none. */
const MARKERS = new RegExp(`\\b(${['TO' + 'DO', 'FIX' + 'ME', 'X' + 'XX'].join('|')})\\b(?!\\.md)`, 'u');

/** Directories never searched: dependencies, what the build makes, and git's own. */
const SKIPPED = new Set(['node_modules', 'build', 'dist', 'coverage', '.git', '.claude']);

/** A Markdown link's target. */
const LINK = /\]\(([^)\s]+)\)/gu;

/** The User's Guide's first chapter, whose name the documentation site relies on. */
const INSTALLING = '01-installing.md';

/** The line every page of a volume holds after its title. */
const CONTENTS = '[Contents](README.md)';

/**
 * The decisions and rules a RULES.md defines.
 *
 * @param rules - the text of RULES.md
 * @returns them
 */
export function defined(rules: string): Defined {
  const decisions = new Set([...rules.matchAll(/^#### (D\d+)\./gmu)].map((m) => m[1] ?? ''));
  const ids = new Set([...rules.matchAll(/^\| (R-[A-Z]+-\d+) \|/gmu)].map((m) => m[1] ?? ''));
  return { decisions, rules: ids };
}

/**
 * The problems of the citations in a source file: each heading, decision
 * and rule it names must exist (R-TRACE-2), and Lob 'L' must say whether
 * it is the request or the reply.
 *
 * @param file - its path, for the problems
 * @param text - its text
 * @param known - what RULES.md defines
 * @returns the problems
 */
export function citationProblems(file: string, text: string, known: Defined): Problem[] {
  const problems: Problem[] = [];
  text.split('\n').forEach((line, i) => {
    const at = (why: string): void => {
      problems.push({ file, line: i + 1, why });
    };
    for (const [, book, heading] of line.matchAll(HEADING_CITATION)) {
      const headings = book === 'PROTOCOL' ? PROTOCOL_HEADINGS : CLIENT_HEADINGS;
      if (!headings.includes(heading ?? '')) at(`[${book ?? ''} ${heading ?? ''}] names no heading`);
      if (heading === TWICE_PRINTED && !/request|reply/u.test(line))
        at(`${TWICE_PRINTED} says neither request nor reply`);
    }
    for (const [, decision] of line.matchAll(DECISION_CITATION)) {
      if (!known.decisions.has(decision ?? '')) at(`${decision ?? ''} is no decision of RULES.md`);
    }
    for (const [rule] of line.matchAll(RULE_CITATION)) {
      if (!known.rules.has(rule)) at(`${rule} is no rule of RULES.md`);
    }
  });
  return problems;
}

/**
 * The problems of a test file's tests: each `test(` must follow a doc
 * comment beginning `Verifies:` and a tag of D6 (R-TRACE-1).
 *
 * @param file - its path
 * @param text - its text
 * @returns the problems
 */
export function traceProblems(file: string, text: string): Problem[] {
  const problems: Problem[] = [];
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    if (!line.startsWith('test(')) return;
    let j = i - 1;
    while (j >= 0 && !(lines[j] ?? '').trimStart().startsWith('/**')) j -= 1;
    const comment = lines
      .slice(Math.max(j, 0), i)
      .map((l) => l.replace(/^\s*\/?\*+\/?\s?/u, '').replace(/\*\/\s*$/u, ''))
      .join(' ')
      .trim();
    const closes = (lines[i - 1] ?? '').trimEnd().endsWith('*/');
    if (j < 0 || !closes || !TAGS.test(comment)) {
      problems.push({
        file,
        line: i + 1,
        why: 'a test cites nothing: its doc comment begins `Verifies:` and a tag of D6',
      });
    }
  });
  return problems;
}

/**
 * The problems of open-work markers in a file (R-DOC-5).
 *
 * @param file - its path
 * @param text - its text
 * @returns the problems
 */
export function markerProblems(file: string, text: string): Problem[] {
  const problems: Problem[] = [];
  text.split('\n').forEach((line, i) => {
    const found = MARKERS.exec(line);
    if (found !== null) problems.push({ file, line: i + 1, why: `${found[1] ?? ''} left: open work goes in TODO.md` });
  });
  return problems;
}

/** Where a link to Turborel's own manual points: its GitHub address on main. */
const TURBOREL_MANUAL = 'https://github.com/turborel/turborel/blob/main/doc/';

/** A link to Turborel's repository, of its manual if it holds `/doc/`. */
const TURBOREL_LINK = /^https:\/\/github\.com\/turborel\/turborel\/.*\/doc\//u;

/**
 * The problems of a Markdown file's links: each relative link resolves; in
 * `doc/`, no image is shown, and a link to Turborel's own manual is its
 * GitHub address under `TURBOREL_MANUAL` (R-DOC-7).
 *
 * @param root - the repository
 * @param file - its path, relative to the repository
 * @param text - its text
 * @returns the problems
 */
export function linkProblems(root: string, file: string, text: string): Problem[] {
  const problems: Problem[] = [];
  const inDoc = file.startsWith(`doc${sep}`);
  text
    .replace(/```[\s\S]*?```/gu, (block) => block.replace(/[^\n]/gu, ''))
    .split('\n')
    .forEach((line, i) => {
      if (inDoc && line.includes('![')) problems.push({ file, line: i + 1, why: 'doc/ holds no images' });
      for (const [, target] of line.matchAll(LINK)) {
        const why = linkFault(root, file, target ?? '', inDoc);
        if (why !== undefined) problems.push({ file, line: i + 1, why });
      }
    });
  return problems;
}

/**
 * What is wrong with one link, if anything.
 *
 * @param root - the repository
 * @param file - the file it is in
 * @param target - where it points
 * @param inDoc - whether the file is in `doc/`
 * @returns the fault, or undefined
 */
function linkFault(root: string, file: string, target: string, inDoc: boolean): string | undefined {
  if (inDoc && TURBOREL_LINK.test(target) && !target.startsWith(TURBOREL_MANUAL)) {
    return `${target} links to Turborel's manual other than under ${TURBOREL_MANUAL}`;
  }
  if (/^https?:\/\//u.test(target) || target.startsWith('#') || target.startsWith('mailto:')) return undefined;
  const path = resolve(root, dirname(file), target.split('#')[0] ?? '');
  return existsSync(path) ? undefined : `${target} resolves to nothing`;
}

/**
 * The problems of a volume of the manual: each page opens with its
 * `# Title` and a line holding only `[Contents](README.md)`, and the
 * volume's README.md lists it (R-DOC-7).
 *
 * @param volume - the volume's path, relative to the repository
 * @param pages - each page's file name and text, README.md among them
 * @returns the problems
 */
export function volumeProblems(volume: string, pages: ReadonlyMap<string, string>): Problem[] {
  const problems: Problem[] = [];
  const readme = pages.get('README.md') ?? '';
  if (!readme.startsWith('# '))
    problems.push({ file: join(volume, 'README.md'), line: 1, why: 'a volume opens with its # Title' });
  for (const [name, text] of pages) {
    if (name === 'README.md') continue;
    const [title, blank, contents] = text.split('\n');
    const file = join(volume, name);
    if (!(title ?? '').startsWith('# ') || blank !== '' || contents !== CONTENTS) {
      problems.push({ file, line: 1, why: `a page opens with its # Title, a blank line, then ${CONTENTS}` });
    }
    if (!readme.includes(`(${name})`))
      problems.push({ file, line: 1, why: `the volume's README.md does not list ${name}` });
  }
  return problems;
}

/**
 * Every file under `dir` whose name `wanted` takes, relative to `root`.
 *
 * @param root - the repository
 * @param dir - the directory, relative to the repository
 * @param wanted - whether a file name is wanted
 * @returns their paths
 */
function files(root: string, dir: string, wanted: (name: string) => boolean): string[] {
  const full = join(root, dir);
  if (!existsSync(full)) return [];
  return readdirSync(full).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(join(root, path)).isDirectory()) return SKIPPED.has(name) ? [] : files(root, path, wanted);
    return wanted(name) ? [path] : [];
  });
}

/**
 * Every problem of the repository at `root`.
 *
 * @param root - the repository
 * @returns the problems
 */
export function check(root: string): Problem[] {
  const read = (file: string): string => readFileSync(join(root, file), 'utf8');
  const known = defined(read('RULES.md'));
  const code = ['src', 'test', 'tools'].flatMap((d) => files(root, d, (n) => n.endsWith('.ts')));
  const markdown = files(root, '.', (n) => n.endsWith('.md'));
  const manual = markdown.filter((f) => f.startsWith(`doc${sep}`));
  const problems = [
    ...[...code, 'eslint.config.js'].flatMap((f) => citationProblems(f, read(f), known)),
    ...manual.flatMap((f) => citationProblems(f, read(f), known)),
    ...code.filter((f) => f.endsWith('.test.ts')).flatMap((f) => traceProblems(f, read(f))),
    ...[...code, ...manual].flatMap((f) => markerProblems(f, read(f))),
    ...markdown.flatMap((f) => linkProblems(root, f, read(f))),
  ];
  if (!existsSync(join(root, 'doc', 'user', INSTALLING))) {
    problems.push({ file: join('doc', 'user', INSTALLING), line: 1, why: 'the installing chapter keeps its name' });
  }
  for (const volume of ['user', 'client', 'appendix']) {
    const dir = join('doc', volume);
    const pages = new Map(files(root, dir, (n) => n.endsWith('.md')).map((f) => [relative(dir, f), read(f)]));
    problems.push(...volumeProblems(dir, pages));
  }
  return problems;
}

/** Runs the checks on the repository this file is built in, and fails if any finds a problem. */
function main(): void {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const problems = check(root);
  for (const p of problems) console.error(`${p.file}:${String(p.line)}: ${p.why}`);
  if (problems.length > 0) process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
