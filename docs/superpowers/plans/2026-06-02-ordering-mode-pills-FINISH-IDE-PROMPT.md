You are an expert TypeScript / Next.js 16 engineer **resuming a partially-executed, locked implementation plan**. Tasks 1–5 are already committed and reviewed-green on the branch. Your job is to finish **Tasks 6, 7, and 8 only** — you are NOT redesigning anything or re-touching Tasks 1–5.

## The plan (read first, in full)

**Plan:** [`docs/superpowers/plans/2026-06-02-ordering-mode-pills-and-pdp-sizes.md`](./2026-06-02-ordering-mode-pills-and-pdp-sizes.md)

Read the whole plan for context — Goal, the `⚠️` banner, **⚠️ Flags & dependencies**, Self-Review — then execute **only Tasks 6 → 7 → 8**. The earlier execute prompt for the full plan is [`2026-06-02-ordering-mode-pills-EXECUTE-IDE-PROMPT.md`](./2026-06-02-ordering-mode-pills-EXECUTE-IDE-PROMPT.md); its constraints still bind, but its overlap/branch-setup steps are already done.

## Current state (verified 2026-06-03 — do not redo)

`print-room-portal` — `c:\Users\MSI\Documents\Projects\print-room-portal`. **Branch `feat/ordering-mode-pills` @ `59f12e1` already exists, is pushed (local == origin), clean tree, NOT merged.** It carries the 5 commits for Tasks 1–5:

- `2b0392f` Task 1 — `lib/shop/fulfilment-mode.ts` spine (`effectiveFulfilment`/`pillsFor`/`matchesMode`/`PILL_LABELS`).
- `16b403c` Task 2 — `mode` filter on `lib/shop/filter-params.ts`.
- `9adcd1d` Task 3 — catalogue listing query filtered by effective mode (`app/(portal)/catalogue/page.tsx`).
- `be5a574` Task 4 — mode filter UI in `components/shop/FilterRail.tsx` (uses the existing `FilterAutoSubmitSelect`, not bespoke pill buttons — keep that pattern).
- `59f12e1` Task 5 — `ProductDetailClient.tsx` relabelled `OrderIntentToggle` to From inventory / Reorder, `canChooseOrderIntent` gated on `mixed`, `isInventoryMode` forces inventory for `stocked`/non-admin viewers.

**Reviewed green:** 16/16 Plan C tests pass, `tsc --noEmit` is 0 errors, no `'buyer'` literal remains. **Check out `feat/ordering-mode-pills` and commit your Task 6–8 work directly on it** — do NOT branch off, do NOT rebase, do NOT touch the existing 5 commits.

## What's left — and why it matters

Spec **Item 3 is not yet satisfied.** `isInventoryMode` is computed in `ProductDetailClient` but never reaches `VariantPicker`, so in From-inventory mode the size picker still shows every size plus "{qty} in stock" / "Available to order" status text. Tasks 6–7 close that; Task 8 verifies the whole feature.

- **Task 6** — add an `inStockOnly` prop to `components/shop/VariantPicker.tsx`: show only sizes whose variant (for the selected colour) is tracked with `available_qty > 0`, and suppress the status chip + "{qty} in stock" text. Default (`false`) = unchanged.
- **Task 7** — pass `inStockOnly={isInventoryMode}` to every `<VariantPicker>` render in `ProductDetailClient.tsx` where the size picker shows.
- **Task 8** — full `npx vitest run && npm run build` green + the manual smoke checklist.

## Required sub-skill

Use **`superpowers:subagent-driven-development`**: fresh subagent per task (6, 7, 8), two-stage review between tasks, each following **`superpowers:test-driven-development`** (failing test → confirm fail → minimal impl → confirm green → commit). Honour **`superpowers:verification-before-completion`** — paste real passing output, never assert green without evidence. Track with **TodoWrite**, one todo per remaining task.

## Hard constraints (non-negotiable)

- **NO migration, NO prod writes.** Read-only of `fulfilment_type_override` / `products.fulfilment_type` only (already wired in Tasks 3/5). Shared **PRODUCTION** Supabase, no staging. No `apply_migration`, no edge deploys.
- **`CartTable` is the oversell net — do NOT edit it.** `inStockOnly` only hides un-orderable sizes in the picker; the cart guard stays the source of truth (spec Item 3).
- **Default mode unchanged.** `inStockOnly` defaults to `false`; the Reorder / non-inventory path must render exactly as today. Task 6's second test asserts this — keep it, and re-run the existing `components/shop/__tests__/VariantPicker.keyboard.test.tsx` (must stay green).
- **No `'buyer'` literal.** Plan A is merged; gating is on `isOrgAdminViewer` / `=== 'staff'`. Don't reintroduce it.
- **Portal UI conventions.** No new visual language; no page sub-headers/eyebrows. The suppression is removal-only — don't add new chrome.
- **Follow the plan's code verbatim.** On genuine drift, adapt minimally and note it in the task report.

## Known soft spots — confirm against live code (the plan flags these)

- **Task 6 test queries** assume the size control renders as `role="radio"` with accessible name exactly `S`/`M`/`L`. Read `VariantPicker.tsx`'s actual size markup first; if the role/name differs, match the query to reality (the plan says relax `getByRole('radio', …)` → `getByText('M')` if needed). The `availability` shape is `Record<variantId, { available_qty, allow_order_without_stock }>` — confirm the real key/field names before writing the fixture.
- **Task 7 — second size surface.** There may be a non-`VariantPicker` size grid (e.g. `VariantlessSizeGrid` or an inline per-variant qty grid for `multi_size_with_variants`). The spec's named anchor is `VariantPicker`, but Item 3's acceptance is **mode-wide**: `grep -n "<VariantPicker\|SizeGrid\|size" components/shop/ProductDetailClient.tsx` around the size render, and if a second surface shows sizes + availability text, apply the same `isInventoryMode` suppression there too (hide zero-stock/untracked, drop status text). Note in your report which surfaces you touched.

## Verify-as-you-go gates

- Task 6: new `VariantPicker.inStockOnly.test.tsx` green (paste output) + `VariantPicker.keyboard.test.tsx` still green.
- Task 7: `npx tsc --noEmit` clean + `npx vitest run components/shop` green.
- Task 8: full `npx vitest run && npm run build` green. **Baseline:** Tasks 1–5 left `tsc` at **0 errors** and the Plan C suite green — if anything is red now, it's yours; fix it, don't absorb it. If a *pre-existing, unrelated* test is red on `main`, say so with evidence.

## Workflow / handoff

- Commit per task **on the existing `feat/ordering-mode-pills`**. **Push** when Task 8 is green. **Do NOT merge** — Jamie merges. No force-push, no history rewrite.
- If the branch tip is no longer `59f12e1` or the tree is dirty when you start, **stop and surface it** before committing.

## STOP — when done

When Tasks 6–8 are complete, suite + build green, branch pushed, STOP and report:

> *"Plan C finished on `feat/ordering-mode-pills` @ `<sha>`, pushed, not merged. Tasks 6–8 added: `VariantPicker.inStockOnly` (in-stock-only sizes, status text suppressed) wired from PDP `isInventoryMode`[, plus <second size surface> if touched]. Default/Reorder mode unchanged; CartTable untouched. Full suite + build green; `tsc` 0 errors. Ready for Jamie to merge."*

Then offer to write the sprint doc (What/Why/How/Decisions/Gotchas/Where).

## Definition of done

- Tasks 6, 7, 8 committed on `feat/ordering-mode-pills`, branch pushed (not merged).
- In From-inventory mode the PDP size picker shows **only** in-stock sizes, with **no** "Available to order" chip and **no** "{qty} in stock" status text — across **every** size surface on the PDP.
- Reorder / default mode renders exactly as before (regression test + keyboard test green).
- No migration, no prod writes; `CartTable` untouched; `'buyer'` literal absent; `tsc` 0 errors; full suite + build green.
