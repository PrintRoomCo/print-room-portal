# IDE prompt — Execute the Xero draft-invoices (Initiative 1) plan, subagent-driven

> Paste everything below the line into a fresh in-repo IDE agent chat (run it inside `print-room-portal`).
> This is an *orchestration* prompt: it drives an already-written, task-by-task plan. Do not redesign anything — the design was brainstormed, grilled, and approved. Your job is to execute it faithfully.

---

## Objective

Implement **Initiative 1 of the Xero draft-invoice integration** by executing the committed plan, one task at a time, using the **`superpowers:subagent-driven-development`** skill (fresh subagent per task, two-stage review between tasks, commit per task).

**The plan is the source of truth. Read it in full before doing anything:**
`docs/superpowers/plans/2026-07-02-xero-draft-invoices-initiative-1.md`

Supporting design context (read if you need the "why"):
`docs/superpowers/specs/2026-07-02-xero-draft-invoices-on-order-design.md`

One-line summary of what you're building: when a customer places a portal order, `submitCustomerOrder` fires a **best-effort** side-effect that creates a **Xero ACCREC DRAFT** invoice for fully-billable orders and flags everything else (`test org / prepay org / any stock-draw line`) as `manual_review` for staff — never blocking or failing the order. It ships **deploy-dark** behind `XERO_ENABLED`.

## Branch setup (do this FIRST, before task 1)

The plan + spec were committed on `feat/reorder-monday-preproduction`, which is unrelated to this work. Give Xero its own branch off `main`, and carry the two doc files across so the plan travels with the code:

```bash
git fetch origin
git switch -c feat/xero-draft-invoices origin/main
git checkout feat/reorder-monday-preproduction -- \
  docs/superpowers/plans/2026-07-02-xero-draft-invoices-initiative-1.md \
  docs/superpowers/specs/2026-07-02-xero-draft-invoices-on-order-design.md
git commit -m "docs: bring Xero spec + Initiative 1 plan onto the feature branch"
```

If `feat/reorder-monday-preproduction` isn't present locally, `git fetch origin` first (or read the plan from the current working tree before switching). Then read the plan and begin Task 1.

## How to execute (subagent-driven)

1. Invoke the **`superpowers:subagent-driven-development`** skill and follow it.
2. Work Tasks 1 → 10 **in order**. Dispatch a **fresh subagent per task**, handing it that task's exact steps from the plan (the plan contains complete code + tests — the subagent should implement them verbatim, not improvise).
3. Between tasks, do the skill's review pass (does the code match the plan's intent + is it correct) before moving on.
4. **Commit after each task** using the commit message given in that task's final step. Do **not** squash tasks together.
5. TDD is baked in: for each code task, the subagent writes the failing test, runs it (confirm it fails), implements, runs it (confirm it passes), commits.

## Guardrails (non-negotiable)

- **Branch safety.** Commit only to `feat/xero-draft-invoices`. Run `git status -sb` before every commit and confirm the branch. **Never** commit to `main`. **Do not merge and do not `git push`** — leave the branch for Jon to review/PR/merge.
- **Don't re-litigate the design.** In particular: eligibility is keyed on **`input.lines[].fulfilment_type === 'stocked'`**, NOT on `quote_items.qty_from_stock`. This is a deliberate, verified correction documented at the top of the plan (the checkout RPC never persists per-line stock qty). Do not "fix" it back to `qty_from_stock`.
- **Deploy-dark.** The feature is inert unless `XERO_ENABLED` is truthy. **Do not set `XERO_ENABLED`.** All tests mock the Xero HTTP client (`lib/xero/client.ts`) and the Supabase admin — you need **no real Xero credentials** to build or test. Do not call the real Xero API from tests.
- **Follow the plan's file list.** Create/modify only the files the plan names. If reality diverges from the plan (a referenced line moved, a signature differs), adapt minimally and note it — don't invent new architecture.
- **Ignore markdown-lint warnings** on the doc files (MD032 etc.) — cosmetic, out of scope.

## Package manager & commands

This repo uses **pnpm** (see other IDE prompts). Substitute for the plan's `npx`/`npm`:

- Single test file: `pnpm exec vitest run <path>`
- Whole suite: `pnpm test`
- Typecheck: `pnpm exec tsc --noEmit`
- Build: `pnpm build`

## Gates (per the plan's Task 10)

- Every new test must pass.
- **Baseline caveat:** this project may carry pre-existing failing tests / `tsc` errors unrelated to Xero. The bar is **zero NEW failures** attributable to `lib/xero/**`, `lib/monday/updates.ts`, `lib/audit/actions.ts`, or the `submit.ts` step-5c block — not a fully green suite. Diff against the baseline before you start if unsure.
- Final gate before you stop: `pnpm test`, `pnpm build`, `pnpm exec tsc --noEmit` — report results honestly (paste failures; don't claim green if it isn't).

## Human gates — STOP and hand to Jon (do NOT do these autonomously)

- **Task 1 — prod migration apply.** Write the migration file (`supabase/migrations/20260702120000_xero_invoice_columns.sql`) and commit it, but **do not apply it to production**. Applying via the Supabase MCP touches the live DB — flag it for Jon to run/approve. (Code build + tests don't need the columns; they mock the DB. So you can complete Tasks 2–10 without the migration being applied.)
- **Task 10 — rollout.** Custom Connection setup, Vercel env vars, `XERO_ENABLED` flip, and Demo-Company smoke are owner/accounts steps. Do not attempt them. Just leave the rollout checklist from the plan intact.

## Done when

- [ ] Branch `feat/xero-draft-invoices` created off `main`; spec + plan carried across.
- [ ] Tasks 2–10 implemented exactly as the plan specifies, each committed separately with TDD.
- [ ] Migration file written + committed (Task 1), **not** applied to prod — flagged for Jon.
- [ ] `pnpm test` shows zero new failures vs baseline; `pnpm build` and `pnpm exec tsc --noEmit` report cleanly (or only pre-existing baseline issues, explicitly identified).
- [ ] Feature is inert (`XERO_ENABLED` unset) — nothing changes in prod behaviour until the flag is set.
- [ ] Nothing pushed, nothing merged; branch left ready for Jon to open a PR.
- [ ] A short final summary: what shipped, the exact gate output, and the two human gates still outstanding (migration apply + rollout).
