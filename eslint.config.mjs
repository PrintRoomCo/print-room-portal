// Flat ESLint config for Next 16 (next lint was dropped in Next 16).
//
// Strategy: rule-level downgrade (Strategy A from sprint H). Most pre-existing
// violations cluster on a handful of rules — we downgrade those to `warn` and
// pin `--max-warnings` in package.json so the baseline holds without blanket
// file ignores. New files (lib/email/send-proof-email.ts, the amendment-
// requests route) stay under FULL lint coverage and are clean today.
//
// TODO(sprint cleanup): re-enable the downgraded rules as 'error' once
// pre-existing violations are cleaned up. Each downgrade is tagged below.

import nextCoreWebVitals from 'eslint-config-next/core-web-vitals'
import nextTypescript from 'eslint-config-next/typescript'
// jsx-a11y is already registered by eslint-config-next/core-web-vitals;
// we import only the recommended ruleset to layer on top.
import jsxA11y from 'eslint-plugin-jsx-a11y'

export default [
  {
    // Sensible ignores — generated, vendored, and config artefacts.
    ignores: [
      'node_modules/**',
      '.next/**',
      'out/**',
      'public/**',
      'next-env.d.ts',
      '**/*.config.*',
    ],
  },
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    rules: {
      // TODO(sprint cleanup): re-enable as 'error'. Pre-existing `any` usage
      // is widespread; cleanup is its own sprint.
      '@typescript-eslint/no-explicit-any': 'warn',
      // TODO(sprint cleanup): re-enable as 'error'.
      '@typescript-eslint/no-unused-vars': 'warn',
      // TODO(sprint cleanup): re-enable as 'error'. React hook dep arrays.
      'react-hooks/exhaustive-deps': 'warn',
      // TODO(sprint cleanup): re-enable as 'error'. <img> vs next/image.
      '@next/next/no-img-element': 'warn',
      // TODO(sprint cleanup): re-enable as 'error'. Plain <a href> for
      // internal nav vs <Link>.
      '@next/next/no-html-link-for-pages': 'warn',
      // TODO(sprint cleanup): re-enable as 'error'.
      'react/no-unescaped-entities': 'warn',
      // TODO(sprint cleanup): re-enable as 'error'.
      '@typescript-eslint/no-empty-object-type': 'warn',
      // TODO(sprint cleanup): re-enable as 'error'. 16 pre-existing
      // occurrences across auth pages, sidebar, contexts. New React rule
      // landed in eslint-plugin-react-hooks v7.
      'react-hooks/set-state-in-effect': 'warn',
      // TODO(sprint cleanup): re-enable as 'error'. One occurrence in
      // app/(portal)/account/actions.ts.
      'prefer-const': 'warn',
    },
  },
  // WCAG 2.2 AA — jsx-a11y on warn (Strategy A). Pre-existing violations
  // cleaned up sprint-by-sprint; the warn level keeps the baseline visible.
  // The jsx-a11y plugin itself is registered by eslint-config-next; this block
  // layers the full recommended ruleset on top of next/core-web-vitals' subset.
  {
    files: ['app/**/*.{ts,tsx}', 'components/**/*.{ts,tsx}'],
    rules: {
      ...Object.fromEntries(
        Object.entries(jsxA11y.configs.recommended.rules).map(([rule, level]) => [
          rule,
          // Force everything to 'warn' regardless of recommended severity, to
          // match Strategy A. Errors block CI; warns ride on --max-warnings.
          level === 'off' || level === 0 ? level : 'warn',
        ]),
      ),
    },
  },
]
