You are an expert TypeScript / Next.js 16 engineer **executing a locked, written implementation plan**. You are implementing it task-by-task with tests — you are NOT redesigning it. Every design decision is already settled in the plan; do not re-open them.

## The plan (read first, in full)

**Execute:** [`docs/superpowers/plans/2026-06-02-ordering-mode-pills-and-pdp-sizes.md`](./2026-06-02-ordering-mode-pills-and-pdp-sizes.md)

This drives the customer ordering experience off a catalogue item's **effective fulfilment mode**: two pills **From inventory** / **Reorder** (mixed → both, role-gated), a catalogue mode filter, and a PDP size picker that in From-inventory mode shows only in-stock sizes with no status text. Read the whole plan — Goal, the `⚠️` banner at the top, **⚠️ Flags & dependencies**, File Structure, and Self-Review — before touching anything.

## Repo

`print-room-portal` — `c:\Users\MSI\Documents\Projects\print-room-portal`. **Single repo, customer portal.** **Branch:** `feat/ordering-mode-pills` (Task 1 Step 5 creates it).

## ⚠️ BEFORE YOU START — check for overlap (mandatory first action)

A branch **`feat/product-fulfilment-type`** (and/or `merge/pdp-mixed-fulfilment-pill`) already exists and **may already implement part of Items 2/3** (the PDP pill work). Before Task 1:

```bash
git fetch --all
git log --oneline -20 feat/product-fulfilment-type 2>/dev/null
git log --oneline -20 merge/pdp-mixed-fulfilment-pill 2>/dev/null
git diff main...feat/product-fulfilment-type -- components/shop/ProductDetailClient.tsx "app/(portal)/catalogue" lib/shop 2>/dev/null
```

If that branch already does the PDP relabel/gating or the override threading, **STOP and surface it to Jamie** — do not duplicate or fork the work. Branch off it, or fold this plan into it, per Jamie's call. Only proceed on a fresh `feat/ordering-mode-pills` off `main` once you've confirmed there's no conflicting in-flight work.

## Required sub-skill

Use **`superpowers:subagent-driven-development`**: fresh subagent per task (Tasks 1–8), two-stage review between tasks, each subagent following **`superpowers:test-driven-development`** (failing test → confirm fail → minimal impl → confirm green → commit). Honour **`superpowers:verification-before-completion`** — paste real passing output, never assert green without evidence. Track with **TodoWrite**, one todo per task.

## Hard constraints (non-negotiable)

- **NO migration, NO writes to prod.** This plan only *reads* `b2b_catalogue_items.fulfilment_type_override` (column exists in prod) and `products.fulfilment_type`. Do **not** author DDL, do **not** call `apply_migration`. Read-only `execute_sql` is allowed once for a sanity check if you want it — no writes, no edge deploys. Shared **PRODUCTION** Supabase, no staging.
- **Build ON the existing toggle — do NOT greenfield it.** `OrderIntentToggle` in `components/shop/ProductDetailClient.tsx` already renders two pills ("From Stock"/"Made to Order"), already gated to org_admin, already mapping to the cart's `'stocked' | 'make_to_stock'` fulfilment. Task 5 **relabels and re-gates** it — it does not replace it. If you find yourself writing a new toggle component, stop.
- **Plan A is SHIPPED + MERGED.** The role rename is live on `main`: `ProductDetailClient.tsx` already declares `type CustomerRole = 'org_admin' | 'staff'` and uses `customerRole === 'staff'`. Use `customerRole === 'org_admin'` (derived `isOrgAdminViewer`) for gating and **never reintroduce the `'buyer'` literal**. Task 5 Step 4d's `grep -n "'buyer'"` must return nothing.
- **Cart oversell guard is untouched.** `CartTable` stays the safety net (spec Item 3). This plan does not edit it.
- **Portal UI conventions.** Follow the existing shop-filter / pill / segmented-control styling already in the catalogue filter UI and `OrderIntentToggle` — the new mode pills and filter pills inherit that treatment. Do **not** invent a new visual language (and per repo memory, no page sub-headers / eyebrows).
- **Follow the plan's code verbatim.** On genuine drift (a line moved, a prop shape differs, a fixture needs new fields), adapt minimally and **note it in your task report**.

## Known soft spots — confirm against live code (the plan flags these)

These weren't pinned during grounding; the plan tells you to **locate by grep**, not trust a hard-coded path:

- **Task 4 Step 1** — the catalogue filter-UI host component (where `ShopFilters` is read and the URL query is written). Grep for it, then add the mode pills *alongside* the existing brand/category controls, reusing their setter (the one that updates one URL key while preserving the rest) and their pill styling.
- **Task 5 Step 1** — the PDP page's catalogue-item resolution. Confirm whether the page already resolves the catalogue-item row; add `fulfilment_type_override` to its `.select(...)` and pass the **effective** mode (`effectiveFulfilment(override, row.fulfilment_type)`) into the client `product.fulfilment_type`.
- **Task 5 Step 2** — `ProductDetailClient.pills.test.tsx`: the toggle only mounts when both options are choosable (mixed + org_admin + `currentSelectionHasInventory` + `brackets.length > 0`). Read the final gating in Step 4 and shape the fixture (`availability`/`variants`/`brackets`) so the toggle actually renders before asserting on it. Mock hooks per the repo's existing PDP test setup.
- **Task 7 Step 1** — there may be a **second size surface** (e.g. `VariantlessSizeGrid` or an inline per-variant qty grid for `multi_size_with_variants`) that isn't `VariantPicker`. The spec's named anchor is `VariantPicker`, but Item 3's acceptance is **mode-wide**: if a non-`VariantPicker` grid shows sizes + availability text, apply the same `isInventoryMode` suppression there too (hide zero-stock/untracked, drop status text).

## Verify-as-you-go gates

- Each task: its own test(s) green (paste output). Pure-logic tasks (1, 2) and component tasks (5, 6) have real failing→passing tests; the server-component tasks (3, 4) gate on `npx tsc --noEmit` + the unit-covered logic from Task 1 (behavioural check is the Task 8 manual smoke).
- Tasks 3, 4, 5, 7 end before commit with `npx tsc --noEmit` clean.
- Task 6 Step 4: re-run the existing `VariantPicker.keyboard.test.tsx` — must stay green (no regression).
- Task 8: full `npx vitest run && npm run build` green. If a pre-existing unrelated test is already red on `main`, say so **with evidence** rather than absorbing it into this work.

## Workflow / handoff

- Commit per task on `feat/ordering-mode-pills`. **Push the branch** when green (Task 8). **Do NOT merge** — Jamie merges.
- **Dependencies:** Rename-independent (Plan A merged). **Soft-depends on Plan B's authored *data*, not its code** — with no override authored yet, effective mode falls back to `products.fulfilment_type` (default `made_to_order`), so every product reads as "Reorder" until an AM sets a mode. The pills/filter/picker all still work; this is expected, not a bug. No code dependency on Plan B — it can ship before or after.
- If `main` has advanced or the branch already exists, stop and surface it. No force-push, no history rewrite.

## STOP — when done

When Tasks 1–8 are complete, the suite + build are green, and the branch is pushed, STOP and report:

> *"Plan C executed on `feat/ordering-mode-pills` @ `<sha>`, pushed, not merged. Effective-mode spine (`lib/shop/fulfilment-mode.ts`) drives: relabelled From inventory / Reorder pills gated by effective mode × role, a catalogue mode filter, and VariantPicker in-stock-only sizing. Reads `fulfilment_type_override` (no writes, no migration). Full suite + build green; `'buyer'` literal absent. Ready for Jamie to merge."*

Then offer to write the sprint doc (What/Why/How/Decisions/Gotchas/Where) before moving on.

## Definition of done

- `feat/ordering-mode-pills` with Tasks 1–8 committed, passing tests, `tsc` clean, build green, branch pushed (not merged).
- PDP toggle reads **From inventory** / **Reorder**; both pills only for `mixed` + org_admin; restricted (`staff`) members never see Reorder.
- Catalogue listing filters by All / From inventory / Reorder off **effective** mode (`override ?? base`).
- In From-inventory mode the PDP size picker shows only in-stock sizes with no "Available to order" chip and no "{qty} in stock" status text; Reorder/default mode unchanged.
- No DDL authored or applied; no prod writes; `CartTable` untouched; `'buyer'` literal absent.
