/**
 * Tests of the checks tool's own rules (RULES.md D4): each rule it holds
 * finds what breaks it, and passes what keeps it.
 */

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  check,
  citationProblems,
  defined,
  linkProblems,
  markerProblems,
  traceProblems,
  volumeProblems,
} from '../../tools/check.js';

const RULES = `#### D1. One\n#### D12. Twelve\n| R-ERR-1 | a rule | review |\n| R-TRACE-2 | another | tool |\n`;
const KNOWN = defined(RULES);

/** Verifies: [TOOL] R-TRACE-2 a heading, decision or rule cited must exist, and Lob 'L' must say which it is. */
test('a citation names what exists', () => {
  const good = "[PROTOCOL Frames] [CLIENT Pools] [DESIGN] D12 RULES.md D1 R-ERR-1 [PROTOCOL Lob 'L'], the reply";
  assert.deepEqual(citationProblems('a.ts', good, KNOWN), []);
  // Spelt apart, so the repository's own check of this file finds none of them.
  const [protocol, client, design] = ['[PRO' + 'TOCOL ', '[CLI' + 'ENT ', '[DE' + 'SIGN] '];
  const rule = 'R-' + 'ERR-9';
  const text = `${protocol}Frame]\n${client}Nope] ${design}D9\n${rule} ${protocol}Lob 'L']`;
  const bad = citationProblems('a.ts', text, KNOWN);
  assert.deepEqual(
    bad.map((p) => [p.line, p.why]),
    [
      [1, `${protocol}Frame] names no heading`],
      [2, `${client}Nope] names no heading`],
      [2, 'D9 is no decision of RULES.md'],
      [3, "Lob 'L' says neither request nor reply"],
      [3, `${rule} is no rule of RULES.md`],
    ],
  );
  assert.deepEqual(citationProblems('a.md', "Turborel's RULES.md D89", KNOWN), [], "Turborel's own decisions");
});

/** Verifies: [TOOL] R-TRACE-1 every test follows a doc comment beginning Verifies: and a tag of D6. */
test('every test cites what it verifies', () => {
  const tests = [
    "/** Verifies: [PROTOCOL Frames] one. */\ntest('a', () => {});",
    "/**\n * Verifies: [DESIGN] D1 two,\n * on two lines.\n */\ntest('b', () => {});",
    "/** Verifies: [TOOL] R-ERR-1 three. */\ntest('c', () => {});",
    "/** Verifies: [CLIENT Pools] four. */\ntest('d', () => {});",
  ];
  assert.deepEqual(traceProblems('t.ts', tests.join('\n\n')), []);
  const missing = [
    "test('e', () => {});",
    "/** Says nothing. */\ntest('f', () => {});",
    "/** Verifies: nothing. */\ntest('g', () => {});",
  ];
  assert.deepEqual(
    traceProblems('t.ts', missing.join('\n')).map((p) => p.line),
    [1, 3, 5],
  );
  assert.equal(
    traceProblems('t.ts', "/** Verifies: [PROTOCOL Frames] x. */\nconst y = 1;\ntest('h', () => {});").length,
    1,
  );
});

/** Verifies: [TOOL] R-DOC-5 an open-work marker is found, and a mention of the open-work file is not one. */
test('open-work markers are found', () => {
  const marker = 'TO' + 'DO';
  assert.equal(markerProblems('a.ts', `// ${marker} later`).length, 1);
  assert.equal(markerProblems('a.ts', `see ${marker}.md`).length, 0);
  assert.equal(markerProblems('a.ts', 'nothing open').length, 0);
});

/** Verifies: [TOOL] R-DOC-7 each page of a volume opens with its title and Contents line, and its README lists it. */
test('the manual keeps its layout', () => {
  const pages = new Map([
    ['README.md', '# Volume\n\n- [Page](01-page.md)\n'],
    ['01-page.md', '# Page\n\n[Contents](README.md)\n\nText.\n'],
    ['02-loose.md', '# Loose\n\nNo contents line.\n'],
  ]);
  assert.deepEqual(
    volumeProblems('doc/user', pages).map((p) => [p.file, p.why.slice(0, 20)]),
    [
      [join('doc/user', '02-loose.md'), 'a page opens with it'],
      [join('doc/user', '02-loose.md'), "the volume's README."],
    ],
  );
  assert.equal(volumeProblems('doc/user', new Map([['README.md', 'no title']])).length, 1);
});

/** Verifies: [TOOL] R-DOC-7 a relative link resolves; doc/ shows no image, and links to Turborel's manual by its GitHub address. */
test('links resolve, and the manual links as the site reads it', () => {
  const root = mkdtempSync(join(tmpdir(), 'turborel-js-check-'));
  try {
    mkdirSync(join(root, 'doc', 'user'), { recursive: true });
    writeFileSync(join(root, 'README.md'), '# R\n');
    writeFileSync(join(root, 'doc', 'user', 'a.md'), '# A\n');
    const doc = join('doc', 'user', 'b.md');
    const manual = 'https://github.com/turborel/turborel/blob/main/doc/README.md';
    const text = [
      `[a](a.md) [up](../../README.md) [web](https://example.org) [x](#here) [m](${manual})`,
      '```\n[skip](nope.md)\n```',
      '[gone](c.md) ![logo](a.md)',
      '[old](https://github.com/turborel/turborel/tree/v1/doc/README.md)',
    ].join('\n');
    assert.deepEqual(
      linkProblems(root, doc, text).map((p) => [p.line, p.why.slice(0, 24)]),
      [
        [5, 'doc/ holds no images'],
        [5, 'c.md resolves to nothing'],
        [6, 'https://github.com/turbo'],
      ],
    );
    assert.deepEqual(linkProblems(root, 'README.md', '[a](doc/user/a.md) ![logo](README.md)'), [], 'outside doc/');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

/** Verifies: [TOOL] R-TRACE-2 the repository itself passes every check. */
test('the repository passes its own checks', () => {
  assert.deepEqual(check(join(import.meta.dirname, '..', '..', '..')), []);
});
