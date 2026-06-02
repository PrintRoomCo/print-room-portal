# IDE Prompt — Complete the Reorder + Inventory Plans

> Paste everything below the line into a fresh coding-agent session in the IDE, with the
> **print-room-portal** repo open. The two plans are pre-written, self-reviewed, and grilled —
> this prompt is execution only.

---

You are an expert TypeScript / Next.js 16 engineer completing **two pre-written, self-reviewed TDD implementation plans** in the **print-room-portal** repo (`c:\Users\MSI\Documents\Projects\print-room-portal`). Both were grilled and locked on 2026-06-02 — every design decision is already made. Your job is **execution**: turn each plan into working, committed software, task by task. Do not redesign.

> There are two repos under the parent folder. Work **only** in `print-room-portal` for these plans. Run all commands from the `print-room-portal/` root.

## Plans (do in this order — they are independent, no shared files)

1. **Reorder normalization** — `docs/superpowers/plans/2026-06-02-reorder-normalization.md` → branch `feat/reorder-normalization`
2. **Org inventory + audit view** — `docs/superpowers/plans/2026-06-02-org-inventory-audit-view.md` → branch `feat/org-inventory-audit`

Begin each plan by **reading it top to bottom**, then work its tasks in order. (If you want to claim Inventory nav/page ownership early — see "ship today" below — you may do Plan 2 first; either order is fine.)

## Required sub-skill

Each plan header says: **REQUIRED SUB-SKILL — `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans`.** Invoke it and follow it. Track tasks with **TodoWrite** (one todo per task).

## Working agreement (non-negotiable)

- **TDD exactly as written:** write the failing test → run it (`npm test -- <path>`) and confirm it fails *for the stated reason* → write the minimal implementation → run again and confirm green → commit with the plan's commit message.
- **One task = one commit.** Don't batch tasks, don't reorder steps.
- At the task boundaries the plan specifies, run the **full** suite (`npm test`, which is `vitest run`) **and** `npm run build`. Both green before moving on.
- **No new scope, no placeholders.** Implement what the plan says — nothing more, nothing less.
- **Line numbers in the plans are anchors** from when they were written (e.g. `JobTrackerOrderCard.tsx`, `Sidebar.tsx` references). Confirm them against the live file before editing; if they've drifted, find the equivalent code and adapt — never blind-edit by number.
- Match the surrounding code's style and conventions.
- Commit on the feature branch and **push the branch** when its code tasks are done. **Do not merge to master** — Jamie merges.

## Already decided — do NOT re-open

- Both features **ship today**, and **first-come owns the Inventory nav + `/inventory` page.** Honour the collision guards in Plan 2 Task 1 + Task 4: if a sprint build has already added the Inventory nav entry or created the page, **extend it — don't duplicate**.
- The Reorder button is **org_admin-only** (the gate covers BOTH the cart-rebuild and the legacy-Monday branches) — already in Plan 1 Task 3.
- The reorder route re-prices via `effective_unit_price` keyed by `product::decorationSignature` — already in Plan 1 Task 2.
- The audit feed shows **all** stock movements labelled by source (order vs. Print Room manual) — already in Plan 2.

## Verified preconditions — trust these (read from the live code on 2026-06-02, not assumed)

- `effective_unit_price(p_product_id, p_org_id, p_qty)` is already catalogue-aware (matches live `lib/checkout/submit.ts:440`).
- `recomputeProductTierPrices` (`lib/cart/types.ts`) **keeps a line's `unitPrice` when it has no `brackets`** → the reorder plan's deliberate `brackets` omission is safe, not a zero-price bug.
- `requireB2BCustomerApi()` (`lib/checkout/server.ts`) returns `{ admin, context }` — with `context.organizationId` and `context.role: 'org_admin' | 'buyer'` — or `{ error }`.
- `/api/inventory` returns `{ rows }` of `CustomerInventoryRow` and is already org-scoped via membership.
- `getCompanyAccess` is exported from `lib/company.ts:18` and returns `isOrgAdmin` + `tenantType`.
- `decorationSignature` is exported from `lib/cart/types.ts:116`; `useCompany()` (`contexts/CompanyContext`) returns `{ access }` where `access?.isOrgAdmin` is the gate.

If any of these turns out **false** in the live code, **STOP and report** — do not invent a workaround.

## STOP and hand back to Jamie (do not fabricate, do not auto-run)

- **Manual verification gates:** Plan 1 **Task 4** and Plan 2 **Task 5** are human-driven browser + Supabase-MCP checks. They **write to the shared PRODUCTION Supabase (no staging)** — they must be run by a human, not the agent. When you reach a manual-gate task: commit all preceding code tasks, then **STOP** and report:
  > *"Code tasks complete on `<branch>` (`npm test` green, `npm run build` clean). Manual gate (Plan 1 Task 4 / Plan 2 Task 5) pending — over to you."*
  Jamie runs the gates and writes the testing doc.
- **A red test that won't pass** after a genuine fix attempt → STOP and paste the failing output. **Never** delete/skip a test or weaken an assertion to force green.
- **A precondition that doesn't hold** in code → STOP and surface it.

## Definition of done

- All **code** tasks in both plans committed (and branches pushed); `npm test` green; `npm run build` clean.
- The two **manual-gate** tasks left untouched for Jamie.
- Final report: a one-line status per plan, the two branch names, and a list of anything you had to adapt (drifted line numbers, renamed symbols, etc.).
