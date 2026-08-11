# Checkout Terms & Conditions agreement + honeypot — SDD Progress

Plan: `docs/superpowers/plans/2026-08-11-checkout-terms-agreement.md`
Spec: `docs/superpowers/specs/2026-08-11-checkout-terms-agreement-design.md`
Branch: `feat/checkout-terms-agreement` (from `main` @ 9ff2fec)
Base commit (BASE for review-package): 9ff2fec
Repo: print-room-portal. Test runner: `pnpm test` (= vitest run). Single: `pnpm exec vitest run <path>`.

Global constraints (binding): NO schema change / no RPC param; TERMS_VERSION = 'v1-2026-08-11';
new audit action is customer-only (no staff mirror); post-commit consent writes are best-effort
(log-not-throw); terms copy is provisional-but-real (not lorem ipsum); honeypot is client-only,
off-screen + aria-hidden + tabIndex=-1 (NOT sr-only).

## Env note (all tasks)
Canonical test command = `./node_modules/.bin/vitest run <path>` (full suite: `./node_modules/.bin/vitest run`).
DO NOT use `pnpm exec` / `pnpm test`: pnpm's dep precheck aborts (ERR_PNPM_IGNORED_BUILDS: esbuild/sharp/unrs-resolver)
AND mutates pnpm-lock.yaml + creates pnpm-workspace.yaml. The direct binary (vitest 2.1.9) is lockfile-safe.

## Task status
- [x] Task 1: terms.ts + TermsContent.tsx + TermsModal.tsx (+ TermsModal.test.tsx)
- [x] Task 2: audit action + submit.ts consent recording (+ submit.terms.test.ts)
- [x] Task 3: route.ts server gate + thread fields (+ route.terms.test.ts; fix 2 sibling tests)
- [x] Task 4: CheckoutReviewClient.tsx checkbox/modal/honeypot/guards/POST (+ terms.test.tsx)

## FINAL STATUS: all 4 tasks complete + reviewed clean. Whole-branch review (opus) = READY TO MERGE (Yes),
##   no Critical/no Important. Branch feat/checkout-terms-agreement @ 3ad41ed (5 commits), base 9ff2fec.
##   Final verification: suite 1308 pass / 4 fail (ALL 4 pre-existing — proven at base 9ff2fec, unrelated files);
##   tsc 14 errors ALL pre-existing (tracker-notification + next-config-redirects), zero from feature.
## HARD MERGE GATE (Jon only): Decision 7 — Jon reviews the provisional TermsContent.tsx wording before merge
##   (the version string legally binds to that exact text). NOT pushed / no PR (per Jon's instruction).
## Optional trivial follow-ups APPLIED (2026-08-12, Jon requested):
##   - absent-key gate test (twice-flagged: Task3 + final) — added to route.terms.test.ts (now 5 tests);
##     exercises the typeof!=='string' branch (absent key => undefined). route.terms 5/5 pass.
##   - submit.ts CheckoutInput doc comment now states terms_accepted is intentionally never re-read here
##     (route already proved it true); only terms_version is consumed for the audit trail. submit.terms 3/3 pass.
##   Comment-only + additive-test; tsc unchanged at 14 pre-existing errors. Committed on feat branch.

## Completed
Task 4: complete (commit 3ad41ed, base 330a083 — review clean, Spec ✅, Approved). Honeypot off-screen inline
  style + aria-hidden + tabIndex=-1 (NOT sr-only), never in POST body; guards honeypot(silent)→terms(banner)
  before missingShipTo; ephemeral state not persisted; link opens modal w/o ticking; JSX balanced (verified vs
  live file); CTA untouched. Sibling CheckoutReviewClient.conflict.test.tsx: additive tickTerms() helper only,
  assertions unchanged. terms test 4/4; components/checkout/__tests__ dir 7 files/33 tests pass.
Task 3: complete (commit 330a083, base 5ad61c2 — review clean, Spec ✅, Approved). Gate exact
  (terms_accepted!==true || typeof terms_version!=='string' || trim===''), before all order creation, both
  partitions threaded, version NOT hardcoded; sibling bodies (route.split x2 inline, route.permission-denied
  VALID_BODY) additive-only. route.terms 4/4, siblings pass, 14/14 dir.
Task 2: complete (commits 323732c..5ad61c2 — review clean, Spec ✅, Approved). 7fa7b0c = feature; 5ad61c2 =
  review-driven failure-path test (mutation-checked: removing submit.ts try/catch makes it fail; source
  byte-identical to 7fa7b0c). Reviewer Minor note (accepted): merged standalone, every order writes a
  TERMS_ACCEPTED row with terms_version=null until Task 3/4 wiring populates it (spec-sanctioned null fallback).
Task 1: complete (commits 9ff2fec..323732c, review clean — Spec ✅, quality Approved).
  Deviation from plan: TermsModal.test.tsx assertion `getByText(/Payment/i)` → `getByRole('heading', {name:/Payment/i})`
  because the plan's test was internally impossible (terms copy says "Payment" in both a heading and a paragraph).
  Source files (terms.ts, TermsContent.tsx, TermsModal.tsx) are verbatim from the brief.

## Minor findings roll-up (for final whole-branch review + Jon triage)
- [Task 1, Important plan-mandated → accepted] TermsModal.test.tsx covers only the Close-button onClose path;
  Escape + overlay-click are untested. Behavior is Radix framework-default (no override in TermsModal), risk low;
  not added because jsdom simulation of Radix pointer-dismiss is flaky (would be a net-negative test). FOR JON: decide
  at merge whether to add these before shipping the legal consent modal.
- [Task 1, Minor] TermsModal focus-restore boilerplate (previousFocusRef + onCloseAutoFocus) duplicates
  RequestReorderModal.tsx; extract a shared helper only when a 3rd modal appears (premature now).
- [Task 1, Minor] TermsContent.tsx has no `'use client'`; safe today (only consumer is the client TermsModal), but a
  future server component could import it and pull TERMS_VERSION server-side. Consider a lint guard/comment later.
- [Task 3, Minor] route.terms.test.ts "missing or empty" case only exercises whitespace terms_version, not the
  truly-absent key (terms_accepted:true, terms_version omitted). Gate's `typeof !== 'string'` branch is correct but
  untested. FOR JON: one-test-case win on the legal gate — trivial to backfill before merge if wanted.
- [Task 4, Minor] CheckoutReviewClient.tsx new <section> children indented 10 spaces vs the file's 8-space step.
  Cosmetic only; no prettier/format:check in CI to enforce. Reflow if desired; zero functional impact.
