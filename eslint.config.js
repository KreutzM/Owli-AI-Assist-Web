import js from '@eslint/js';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'dist',
      'dist-*',
      'coverage',
      'playwright-report',
      'test-results',
      '.ai/repo-index.json',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked.map((config) => ({
    ...config,
    files: ['**/*.{ts,tsx}'],
  })),
  {
    files: ['**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2024,
      globals: globals.node,
    },
    rules: {
      'no-console': 'off',
    },
  },
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2024,
      globals: { ...globals.browser, ...globals.node },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      'jsx-a11y': jsxA11y,
      'react-hooks': reactHooks,
    },
    rules: {
      ...jsxA11y.flatConfigs.recommended.rules,
      ...reactHooks.configs.flat.recommended.rules,
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/no-unnecessary-condition': 'warn',
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },
  {
    files: ['src/features/remote/StagingBrandedVideoExport.tsx'],
    rules: {
      '@typescript-eslint/no-unnecessary-condition': 'off',
    },
  },
  {
    files: ['**/*.test.{ts,tsx}', 'tests/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-base-to-string': 'off',
      '@typescript-eslint/require-await': 'off',
    },
  },
);
