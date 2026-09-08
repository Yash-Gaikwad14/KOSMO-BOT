import js from '@eslint/js';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import globals from 'globals';

export default [
  // 1. Global ignores
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'coverage/**',
      '*.log',
      '*.ps1',
      'jest.config.js',
    ],
  },

  // 2. Base ESLint recommended
  js.configs.recommended,

  // 3. TypeScript recommended rules
  ...tsPlugin.configs['flat/recommended'],

  // 4. Project-wide rules for all TypeScript files
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
      globals: {
        ...globals.node,
        ...globals.es2022,
      },
    },
    rules: {
      // Allow empty catch blocks for secondary error suppression / graceful degradation
      'no-empty': ['error', { allowEmptyCatch: true }],

      // Enforce const for variables never reassigned
      'prefer-const': 'error',

      // Disallow lexical declarations in case blocks without block scope
      'no-case-declarations': 'error',

      // CommonJS dynamic require is intentional in this codebase (CommonJS target)
      '@typescript-eslint/no-require-imports': 'off',

      // Widespread type assertion / any cleanup is explicitly deferred to H-08
      '@typescript-eslint/no-explicit-any': 'off',

      // Warn on unused variables, ignoring those prefixed with underscore
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  },

  // 5. Test files configuration
  {
    files: ['src/tests/**/*.ts'],
    languageOptions: {
      globals: {
        ...globals.jest,
      },
    },
    rules: {
      // Test mocks and fixtures frequently define parameters or setup objects
      '@typescript-eslint/no-unused-vars': 'off',
    },
  },
];
