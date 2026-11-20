// The lint of every TypeScript and JavaScript file (RULES.md D14): ESLint's
// recommended rules, typescript-eslint's strict-type-checked and
// stylistic-type-checked, and the rules below that hold RULES.md §3 where a
// tool can. `npm run lint` fails on any warning.
import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import jsdoc from 'eslint-plugin-jsdoc';
import tsdoc from 'eslint-plugin-tsdoc';
import tseslint from 'typescript-eslint';

/** Where every public item must carry a doc comment (R-DOC-1). */
const documented = [
  'TSInterfaceDeclaration',
  'TSTypeAliasDeclaration',
  'TSPropertySignature',
  'TSMethodSignature',
  'PropertyDefinition',
  'ExportNamedDeclaration > VariableDeclaration',
];

export default defineConfig(
  globalIgnores(['build/', 'dist/', 'coverage/', 'node_modules/']),
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: { allowDefaultProject: ['eslint.config.js'] },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    linterOptions: { reportUnusedDisableDirectives: 'error' },
  },
  {
    files: ['src/**/*.ts', 'test/**/*.ts', 'tools/**/*.ts'],
    plugins: { jsdoc, tsdoc },
    rules: {
      // R-SIZE-1 to R-SIZE-3.
      'max-lines': ['error', { max: 600, skipBlankLines: false, skipComments: false }],
      'max-lines-per-function': ['error', { max: 50, skipBlankLines: true, skipComments: true }],
      '@typescript-eslint/max-params': ['error', { max: 5 }],
      // R-SIZE-5.
      complexity: ['error', { max: 15 }],
      'max-depth': ['error', { max: 5 }],
      '@typescript-eslint/switch-exhaustiveness-check': [
        'error',
        { allowDefaultCaseForExhaustiveSwitch: false, requireDefaultForNonUnion: true },
      ],
      // R-DOC-1, R-DOC-5.
      'tsdoc/syntax': 'error',
      'jsdoc/require-jsdoc': [
        'error',
        {
          publicOnly: true,
          require: { FunctionDeclaration: true, ClassDeclaration: true, MethodDefinition: true },
          contexts: documented,
        },
      ],
      'jsdoc/no-blank-blocks': ['error', { enableFixer: false }],
      'no-warning-comments': ['error', { terms: ['todo', 'fixme', 'xxx', 'hack'], location: 'anywhere' }],
      // R-STYLE-2, R-TYPE-1, R-TYPE-2.
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/consistent-type-exports': 'error',
      '@typescript-eslint/explicit-module-boundary-types': 'error',
      '@typescript-eslint/strict-boolean-expressions': [
        'error',
        { allowString: false, allowNumber: false, allowNullableObject: true },
      ],
      '@typescript-eslint/prefer-readonly': 'error',
      eqeqeq: ['error', 'always'],
      'no-restricted-exports': [
        'error',
        {
          restrictDefaultExports: {
            direct: true,
            named: true,
            defaultFrom: true,
            namedFrom: true,
            namespaceFrom: true,
          },
        },
      ],
      // R-SAFE-2, R-ERR-1, R-ASYNC-3.
      'no-eval': 'error',
      'no-implied-eval': 'off',
      '@typescript-eslint/no-implied-eval': 'error',
      'no-new-func': 'error',
      'no-restricted-properties': [
        'error',
        { object: 'process', property: 'exit', message: 'Library code never ends the process (R-ERR-1).' },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: 'AwaitExpression:not(:function AwaitExpression)',
          message: 'No top-level await: require(esm) cannot load a module that has one (D9).',
        },
        {
          selector: 'ForOfStatement[await=true]:not(:function ForOfStatement)',
          message: 'No top-level await: require(esm) cannot load a module that has one (D9).',
        },
      ],
    },
  },
  {
    // Production code alone: no magic numbers, no printing (R-CONST-1,
    // R-STYLE-3). Tests may use literal fixtures (R-CONST-5).
    files: ['src/**/*.ts'],
    rules: {
      'no-console': 'error',
      'no-magic-numbers': 'off',
      '@typescript-eslint/no-magic-numbers': [
        'error',
        {
          ignore: [0, 1, '0n', '1n'],
          ignoreArrayIndexes: false,
          enforceConst: true,
          detectObjects: false,
          ignoreEnums: false,
          ignoreNumericLiteralTypes: true,
          ignoreReadonlyClassProperties: true,
          ignoreTypeIndexes: true,
        },
      ],
    },
  },
  {
    // node:test's test() returns a promise its runner awaits itself.
    files: ['test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-floating-promises': [
        'error',
        {
          allowForKnownSafeCalls: [
            { from: 'package', name: ['test', 'describe', 'it', 'suite'], package: 'node:test' },
          ],
        },
      ],
    },
  },
  {
    // The configuration files are JavaScript, outside the type check, and
    // an ESLint configuration is a default export by ESLint's own rule.
    files: ['**/*.js'],
    extends: [tseslint.configs.disableTypeChecked],
    rules: { 'no-restricted-exports': 'off' },
  },
);
