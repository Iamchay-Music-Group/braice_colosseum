/**
 * ESLint configuration.
 *
 * Deliberately narrow: the TypeScript compiler already runs as `pnpm typecheck`
 * on every change and owns type correctness, so the lint rules here are for the
 * things a type system cannot see — unused bindings, accidental globals, and the
 * footguns that make a strict codebase drift.
 *
 * No type-aware rules. They would require `parserOptions.project`, which couples
 * lint to the build and makes every new file fail until the tsconfig knows
 * about it. Rules that earn their keep here do not need the checker.
 */
module.exports = {
  // Stops ESLint walking above apps/api looking for a second config.
  root: true,

  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2021,
    sourceType: 'module',
  },

  plugins: ['@typescript-eslint'],

  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
  ],

  env: {
    node: true,
    jest: true,
    es2021: true,
  },

  ignorePatterns: ['dist', 'node_modules', 'coverage', '*.js'],

  rules: {
    /**
     * Unused bindings, with two relaxations that are not stylistic.
     *
     * `argsIgnorePattern` covers framework and interface positions: an override
     * that must match a wider signature, or a Nest lifecycle hook whose arity
     * the framework decides. Prefixing with `_` is the existing convention in
     * this repo, and it keeps the rule on for everything else.
     *
     * `caughtErrors` is left at its default because swallowing an error silently
     * is exactly the kind of thing this codebase's audit trail exists to catch.
     */
    '@typescript-eslint/no-unused-vars': [
      'error',
      {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
      },
    ],

    /**
     * Floating promises are silent data-loss bugs in an async service: an audit
     * write that is not awaited does not fail loudly, it just never lands.
     * `void` is the explicit way to say "deliberately not awaited".
     */
    'no-void': ['error', { allowAsStatement: true }],
  },

  overrides: [
    {
      /**
       * Tests are held to a different standard than production code, on
       * purpose. Production has zero `any` and keeps it that way; a test double
       * does not, because the whole point of a mock is to stand in for a
       * collaborator whose type is not what is under test. Spending the
       * repository's type-safety budget on `mockRepo()` buys nothing and would
       * make the tests harder to read than the code they cover.
       *
       * `no-require-imports` is relaxed for the same reason: `import request =
       * require('supertest')` is how supertest is called under this tsconfig,
       * and rewriting it would be churn in files that are otherwise correct.
       */
      files: ['**/*.spec.ts', '**/test/**/*.ts'],
      rules: {
        '@typescript-eslint/no-explicit-any': 'off',
        '@typescript-eslint/no-require-imports': 'off',
        '@typescript-eslint/no-this-alias': 'off',
      },
    },
  ],
};
