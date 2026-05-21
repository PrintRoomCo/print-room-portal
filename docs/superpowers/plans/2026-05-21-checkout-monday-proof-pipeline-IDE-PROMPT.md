# Checkout → Monday CRM Deals → Auto-Proof Pipeline — IDE prompt

Paste the block below into a fresh Claude Code session.

**Background:** Chris Brun's 2026-05-21 notes asked for orders to push to Monday immediately at customer checkout, with the AM as a notification recipient (not a gating approver). The portal as built today gates orders behind a staff-side approve route that pushes to Monday's Production board only after an AM confirms pricing + decoration. Jamie's call (2026-05-21): retire the AM gate, push to Monday CRM Deals board ("New Deals" group) at checkout, auto-generate the proof from product data, let staff edit + push the proof to the customer, and let the customer be the sole approval gate.

The spec + plan are written. ~70% of the pipeline already exists — proof autofill, AM email, customer proof viewer, amendments, staff push-to-customer route, customer notification email. This sprint wires the missing Monday push at checkout, retires the order-approve route, and moves the production-PDF render to the proof-approve route.

**This sprint touches BOTH repos.** Stages land per the plan.

Working directories (no worktrees — Jamie's standing instruction):
- Customer portal: `C:/Users/MSI/Documents/Projects/print-room-portal` (base: `main`)
- Staff portal: `C:/Users/MSI/Documents/Projects/print-room-staff-portal` (base: `master`)

Branches — one feature branch per repo, off the respective base, named exactly:
- `feat/checkout-monday-pipeline-2026-05-21`

DO NOT work on the base branch. NO git worktrees. All four stages live on the one branch per repo; Jamie controls PR shape at the end.

---

You are implementing the Checkout → Monday CRM Deals → Auto-Proof pipeline.

**Plan:** `C:/Users/MSI/Documents/Projects/print-room-portal/docs/superpowers/plans/2026-05-21-checkout-monday-proof-pipeline-plan.md` — read in full, in order. Every code block in the plan is the actual code to write; no `TBD`, no `similar to existing pattern`.

**Spec for context:** `C:/Users/MSI/Documents/Projects/print-room-portal/docs/superpowers/specs/2026-05-21-checkout-monday-proof-pipeline-design.md` — read once. Pay attention to Decisions 2 (board choice — Deals not Production), 4 (delete order-approve), 6 (subitem name format), 10 (subitems-on-Deals fallback path).

**Approach:** Use the `superpowers:subagent-driven-development` skill. Dispatch one fresh subagent per stage. Review the diff between stages. Each stage ends with a commit + named test/build gate. No pushes between stages; one push per repo at the end of Stage 4.

---

## Pre-flight (confirm BEFORE Stage 1)

Three Monday admin tasks for Jamie. None require code. If any are blocked, STOP and tell Jamie.

> 1. **Subitems column enabled** on Monday board `2046357917` (CRM Deals). Confirm via the board's Customise → Subitems panel.
> 2. **`"Portal - Order"` label pre-created** on the `deal_source` column (`color_mkzhwkjn`) of board `2046357917`, distinct colour from `"Portal - Reorder"`. The `create_labels_if_missing: true` mutation parameter is unreliable on first use of a new label.
> 3. **Confirm Monday board URL prefix.** Existing `lib/monday/subitems.ts:103` uses `https://theprint-room-group.monday.com`. If the production tenant uses a different subdomain, set `MONDAY_BOARD_URL_PREFIX` in both repos' env before Stage 3.

If all three confirmed — proceed with Stage 1.

---

## Stages (mirror plan §Stage 1–4)

```
Stage 1 (migration + labels) → Stage 2 (deal-item.ts extraction) → Stage 3 (checkout wiring) → Stage 4 (staff cleanup + proof-approve extension)
```

| Stage | Repos | What ships | Test gate |
|---|---|---|---|
| 1 | both | Supabase migration extending `orders.status` CHECK to allow `awaiting-proof-review` + `awaiting-customer-approval`. Status-label additions in both repos. Optional second migration if `quote_items.monday_subitem_id` doesn't exist (grep first). | Migration applied to dev; smoke insert one row of each new status. `npx tsc --noEmit` clean in both repos. No runtime behaviour change. |
| 2 | both | `lib/monday/deal-item.ts` in portal (verbatim copy of reorder.ts + new `order` mode with subitems). Mirror in staff portal. Portal's `app/api/reorder/route.ts` import updated. `lib/monday/reorder.ts` deleted from portal only (staff doesn't have it). New unit tests for `pushOrderDeal`. | `npx tsc --noEmit` clean both repos. New unit tests pass. **Manual reorder smoke against dev: submit one reorder via the existing UI, confirm Monday item lands in board 2046357917.** |
| 3 | customer portal only | `submit.ts` step 5 replaced with the Monday push block + new status flip. `ORDER_MONDAY_PUSH_FAILED` audit action constant. AM email enrichment in `autofill-for-order.ts` with Monday item link. Order-confirmation copy update. Submit unit test for Monday-push-failure path. | `npx tsc --noEmit` clean. New test passes. Existing checkout tests still pass (the pre-existing CheckoutClient.review-redirect test stays broken on the same CurrencyProvider mock gap — DO NOT touch it). **Manual smoke: submit one B2B order against dev, verify Monday item lands with subitems + AM email arrives with both links + status = `awaiting-proof-review`.** |
| 4 | staff portal only | Extend `POST /api/proofs/[id]/approve` to render production PDF + attach to Monday Deals item + flip `orders.status` to `awaiting-customer-approval`. Delete `POST /api/orders/[id]/approve`. Delete `retryOrderProductionPush` helper. Delete `production-job.ts` in both repos (after grep confirms zero callers). Add `POST /api/orders/[id]/retry-monday-push` + button on `OrderDetailClient.tsx`. Rename proof-editor button "Approve & send to customer" → "Push to customer". | `npx tsc --noEmit` clean both repos. **E2E smoke per plan Task 4.7:** customer submit → staff proof edit → staff push → customer proof approve → status transitions match plan diagram. Negative path: NULL out `monday_item_id`, retry button works. |

### Stage prerequisites

```
Stage 1 → Stage 2: independent (could swap order — but execute as listed for least churn)
Stage 1 + Stage 2 → Stage 3
Stage 3 → Stage 4
```

Recommended dispatch order: **1 → 2 → 3 → 4.**

---

## Per-stage subagent brief template

> Implement Stage {N} from `C:/Users/MSI/Documents/Projects/print-room-portal/docs/superpowers/plans/2026-05-21-checkout-monday-proof-pipeline-plan.md`.
>
> Working directory: `{absolute path to repo for this stage — both for Stages 1, 2; portal only for Stage 3; staff only for Stage 4}`. Confirm with `pwd`. Branch: `feat/checkout-monday-pipeline-2026-05-21` (created off `{main|master}`). Confirm with `git branch --show-current`.
>
> Read the spec once (`specs/2026-05-21-checkout-monday-proof-pipeline-design.md`) and only the stage section of the plan you're implementing — not other stages.
>
> Every code block in the plan is the literal code to write. Do not improvise the helper signatures, the SQL CHECK list, the subitem name format, or the audit-action constant names — they're load-bearing across stages.
>
> Each stage ends with a commit using the message from the plan's "Commit:" line. Run the stage's test gate BEFORE committing. `npx tsc --noEmit` MUST be clean. `npm test` (where applicable) MUST exit 0 against the new + existing tests.
>
> If you find a Next.js API behaving unexpectedly, READ `node_modules/next/dist/docs/` before guessing — both repos are on Next.js 16, which has breaking changes from older versions.
>
> Report back: files changed, test/lint/build results, commit SHA, and any deviation from the plan (with reason). Nothing else.

---

## Repo facts the subagents need

- **Customer portal**: Next.js 16, vitest via `pnpm vitest`, default branch `main`, package manager `pnpm`. Buyer auth: `requireB2BCustomer()` from `@/lib/checkout/server`. Verification gate: `pnpm tsc --noEmit` + targeted `pnpm vitest run` per stage.
- **Staff portal**: Next.js 16 (see `AGENTS.md` for breaking changes), default branch `master`, package manager `npm`. Staff auth: `requireProofsStaffAccess()` / `requireOrdersStaffAccess()` from `@/lib/proofs/server` and `@/lib/orders/server`. Verification gate: `npx tsc --noEmit` + `npm test`.
- **Supabase MCP project**: `bthsxgmcnbvwwgvdveek`. One DB shared between repos; no staging. Apply migrations via `mcp__supabase__apply_migration`.
- **Monday board**: CRM Deals = `2046357917`. Group ID for new deals: `'topics'` (already hardcoded in the existing reorder helper). Existing column IDs all live in `lib/monday/reorder.ts` and move with the rename.
- **Conventional commits**: `feat` for new functionality, `chore` for migrations + status-label additions, `refactor` for the deal-item.ts rename. Scopes: `checkout`, `monday`, `proofs`, `orders`.
- **One push per repo at the end of Stage 4.** No pushes between stages.

---

## Review between stages

After each subagent reports completion:

1. `git status` in the relevant repo — confirm only the files in the plan stage were changed.
2. `git show HEAD` — read the diff.
3. Run the stage's test gate yourself in a fresh shell to verify.

**After Stage 2** (both repos):
```bash
# Portal: reorder.ts must be gone
grep -rn "lib/monday/reorder" print-room-portal/ --include="*.ts" --include="*.tsx"
# Both repos: deal-item.ts must exist
ls print-room-portal/lib/monday/deal-item.ts print-room-staff-portal/src/lib/monday/deal-item.ts
```
First grep must return zero hits. Both `ls` calls must succeed.

**After Stage 3** (portal):
```bash
grep -rn "awaiting-approval" print-room-portal/lib/checkout/ print-room-portal/app/api/checkout/
```
Should return zero hits outside test fixtures and comments. The string is dead at the checkout submit path; only the historical CHECK list keeps it valid in Supabase.

Also check: `lib/checkout/submit.ts` step 5 calls `pushOrderDeal`, not `pushProductionJob`. The `Object.assign(subitemIdByQuoteItemId, ...)` line must be present so the per-line writes happen.

**After Stage 4** (both repos):
```bash
# production-job.ts must be gone from both
ls print-room-portal/lib/monday/production-job.ts print-room-staff-portal/src/lib/monday/production-job.ts 2>&1 | grep -E "No such|cannot find"
# order-approve route must be gone
ls print-room-staff-portal/src/app/api/orders/*/approve/
```
First check expects "No such file" on both paths. Second expects directory empty or non-existent.

Also check: the proof-approve route in staff portal now reads `orders.monday_item_id` and calls `attachPdfToMondayItem`. The `prepareOrderProofForApproval` import survives, called from within the proof-approve route.

---

## Stop conditions

- **Stop** if pre-flight items 1–3 aren't all confirmed by Jamie before Stage 1.
- **Stop** if the migration in Stage 1 reveals existing `orders.status` values not covered by the spec's CHECK list. Run `SELECT DISTINCT status FROM orders` first; add anything found to the new CHECK alongside the two new states.
- **Stop** if Stage 2's reorder smoke test fails. The whole rename premise is "reorder behaviour unchanged"; if that breaks, the `order` mode build is moot.
- **Stop** if a subagent proposes adding shipping tier rules in any stage — that's Chris-owes-Jamie and out of scope (Chris is sending the myPR table separately).
- **Stop** if a subagent proposes to keep `POST /api/orders/[id]/approve` "for safety" in Stage 4. The route is dead code after Stage 3 ships and must be deleted; the retry-Monday-push route covers the only legitimate use case (re-running a failed checkout push).
- **Stop** if a subagent tries to fix the pre-existing `CheckoutClient.review-redirect.test.tsx` CurrencyProvider mock failure — that's known-broken on `main` and predates this branch. Touching it is out of scope.
- **Stop** if a subagent proposes "Monday person-assignment" or "AM Monday-user lookup" — that's deferred per Decision 7 of the spec.
- **Stop after Stage 4** — manual smoke is Jamie's, not the subagent's.

---

## Final handoff (after Stage 4)

- Customer portal: `git log --oneline -8` showing Stage 1 + Stage 2 + Stage 3 commits + (if needed) the `chore(monday): delete production-job.ts` commit from Stage 4 portal-side.
- Staff portal: `git log --oneline -8` showing Stage 1 + Stage 2 + Stage 4 commits.
- Both repos: gates one last time (`tsc --noEmit` + tests).
- The grep checks above.
- Sprint doc per Jamie's `feedback_end_of_sprint_doc.md`: `docs/superpowers/sprint-docs/2026-05-{ship}-checkout-monday-proof-pipeline.md` (in portal repo). Cover: What shipped, the AM-gate retirement rationale, the two new statuses, the retry surface, the deferred Monday person-assignment follow-up, the subitems-on-Deals-board enabled flag.
- `git push -u origin feat/checkout-monday-pipeline-2026-05-21` on each repo.
- Do **not** open PRs — Jamie owns the PR copy.

Then tell Jamie:

> "Checkout → Monday → Auto-Proof pipeline done. Branches `feat/checkout-monday-pipeline-2026-05-21` pushed on both repos. Manual smoke for you: submit one B2B order against dev, walk it from checkout → AM email → staff proof edit → staff push → customer proof approve. Verify Monday item lands in CRM Deals 'New Deals' with subitems + PDF after staff push. Merge order: portal first (Stages 1–3 are portal-side), then staff (Stage 4)."

Begin by confirming pre-flight items 1–3 with Jamie, then dispatch Stage 1.
