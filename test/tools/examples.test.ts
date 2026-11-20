/**
 * Tests of the examples tool's reading of a page: each JavaScript example,
 * and the output its last comment lines give (RULES.md R-TEST-2).
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { examplesOf } from '../../tools/examples.js';

/** Verifies: [DESIGN] D22 a page's examples are its fenced JavaScript blocks, each's expected output its last comment lines, a block of none expecting nothing. */
test("a page's examples", () => {
  const page = [
    '# A page',
    '',
    '```js',
    "console.log('a');",
    '// a',
    '//',
    '// b',
    '```',
    '',
    '```ts',
    'const x: number = 1;',
    '```',
    '',
    '```js',
    '// a comment, not the end',
    'void 0;',
    '```',
    '',
  ].join('\n');
  assert.deepEqual(examplesOf(page), [
    { code: "console.log('a');\n// a\n//\n// b\n", expected: 'a\n\nb' },
    { code: '// a comment, not the end\nvoid 0;\n', expected: undefined },
  ]);
});
