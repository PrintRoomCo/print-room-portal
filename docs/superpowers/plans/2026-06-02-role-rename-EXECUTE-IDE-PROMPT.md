You are an expert TypeScript / Next.js 16 engineer **executing a locked, written implementation plan**. You are implementing it task-by-task with tests — you are NOT redesigning it. Every design decision is already settled in the plan; do not re-open them.

## The plan (read first, in full)

**Execute:** [`docs/superpowers/plans/2026-06-02-role-rename-buyer-to-staff.md`](./2026-06-02-role-rename-buyer-to-staff.md)

This renames the customer-portal member role value `buyer` → `staff` end-to-end across **two repos**. It is the foundational item of the Chris-notes sprint (everything else's role-gating assumes it). Read the whole plan, including its `⚠️ Production / cross-repo flags` block and its Self-Review, before touching anything.

## Repos (both work on branch `feat/role-rename-staff`)

- `print-room-portal` — `c:\Users\MSI\Documents\Projects\print-room-portal`
- `print-room-staff-portal` — `c:\Users\MSI\Documents\Projects\print-room-staff-portal`

Keep both open — Tasks 1, 6, 7, 8, 9 span both. Task 1 creates the branch in **both** repos.

## Required sub-skill

Use **`superpowers:subagent-driven-development`** (the plan header recommends it): dispatch a fresh subagent per task, with a two-stage review (spec/quality) between tasks. Each subagent follows **`superpowers:test-driven-development`** exactly — write the failing test, run it and confirm the expected failure, write the minimal implementation, run it and confirm green, then commit. Honour **`superpowers:verification-before-completion`**: never claim a task is done without pasting the actual passing test/`tsc`/build output. Track progress with **TodoWrite** — one todo per plan task (Tasks 1–9).

## Hard constraints (non-negotiable)

- **This is a PRODUCTION database with no staging.** The plan *authors* the data `UPDATE` and the RLS migration as a committed file (Task 6). **You do NOT run them.** Do not call `apply_migration`, do not call `execute_sql` with any write, do not deploy edge functions. The only DB access you may use is **read-only** `execute_sql` to re-confirm the `SELECT role, count(*)` sanity check noted in the plan — nothing else. Applying the migration is a deliberate human step (Task 9 Step 3); leave it for Jamie.
- **Do not touch the exclusions** the plan lists: `vendor/print-room-onboarding/**` (both repos — a synced vendored package whose `Audience` already has a separate `'staff'`) and `print-room-staff-portal/scripts/shopify-orders-port/**`. If the gate grep surfaces them, that's expected — they're excluded from the gate, not renamed.
- **Gate scope = the role-value string literal `'buyer'`/`"buyer"` only.** Do NOT rename internal identifiers that merely contain "buyer" — `isBuyer`, `BuyerScopeError`, the error strings `'buyer_ship_to_mismatch'` / `'buyer_requires_default_store'`, the CHECK `chk_buyer_has_default_store`. The plan is explicit about this; widening scope is a defect.
- **Follow the plan's tasks and code verbatim.** If you hit genuine drift (a line moved, an export already exists, a fixture needs a new field), adapt minimally and **note the adaptation in your task report** — but never skip a test, never weaken the zero-`'buyer'` gate, and never fold the prod migration into a code task.
- **Confirm before destructive/irreversible git ops.** No force-push, no history rewrite. Commit per task as the plan specifies.

## Verify-as-you-go gates

- After each task: the task's own test(s) green (paste output).
- Portal Task 5 and Staff Task 7 each end in `npx tsc --noEmit` — must be clean before commit.
- Task 8: the `no-buyer-literal` gate test must be **green in both repos** (zero live role-value literals).
- Task 9: full `npx vitest run && npm run build` green in **both** repos. If a pre-existing unrelated test is already red on `main`, say so explicitly with evidence rather than silently absorbing it.

## Workflow / handoff

- Commit on `feat/role-rename-staff` in each repo per the plan. **Push the branches** when both repos are fully green (Task 9). **Do NOT merge** and **do NOT open the migration run** — Jamie merges and runs the prod migration.
- If the branch already exists or `main` has advanced, stop and surface it rather than guessing.

## STOP — when done

When all nine tasks are complete, both repos green, and both branches pushed, STOP and report:

> *"Plan A executed on `feat/role-rename-staff` (portal @ `<sha>`, staff @ `<sha>`), pushed, not merged. Full suite + build green in both repos; zero-`'buyer'` gate green. ⚠️ PENDING HUMAN STEP: in a maintenance window, re-run `SELECT role, count(*) FROM user_organizations GROUP BY role;`, then apply `supabase/migrations/20260602090000_rename_role_buyer_to_staff.sql` (data UPDATE + RLS policy) via Supabase. Ready for Jamie to merge + run."*

Then offer to write the sprint doc (What/Why/How/Decisions/Gotchas/Where) for this rename before moving to Plan B.

## Definition of done

- Both repos on `feat/role-rename-staff`, all of the plan's Tasks 1–9 committed with passing tests.
- The authored (un-run) prod `UPDATE` + RLS migration committed in the staff repo; **not applied**.
- Zero `'buyer'`/`"buyer"` role-value literals in live `.ts/.tsx` of either repo (gate test green; tests/docs/vendor/port-scripts excluded).
- Existing members function identically as `staff`; proof-amendment role gates admit `staff`.
- Branches pushed, not merged; the human migration-run step clearly flagged in the final report.
