You are an expert TypeScript / Next.js 16 engineer **debugging two related defects in the B2B "fulfilment mode" feature**, across the customer portal and the staff portal. Find the **root cause before any fix** — symptom-patching is failure.

## Repos

- **Customer portal:** `print-room-portal` — `c:\Users\MSI\Documents\Projects\print-room-portal`. The customer PDP (`/catalogue/[productId]`) that renders the From inventory / Reorder pill.
- **Staff portal:** `print-room-staff-portal` — `c:\Users\MSI\Documents\Projects\print-room-staff-portal`. The catalogue-item editor that *authors* a product's fulfilment mode.
- Both are Next.js 16 App Router + TypeScript + Vitest, on **one shared PRODUCTION Supabase** (`bthsxgmcnbvwwgvdveek`, **no staging** — every write is live). You may run **read-only** `execute_sql` for diagnosis. **Never** `apply_migration`, write SQL, or deploy edge functions — a human runs those.

## Required skills (use them, in order)

1. **`superpowers:systematic-debugging`** — root cause FIRST. Reproduce, trace data flow across the gate→mode→render boundaries, form a single hypothesis, test minimally.
2. **`superpowers:test-driven-development`** — every fix starts with a failing test that reproduces the defect.
3. **`superpowers:verification-before-completion`** — paste real passing output; never claim green without evidence.

Track with **TodoWrite**.

## The two symptoms (reproduce both before fixing anything)

**Symptom 1 — "Reorder" doesn't reveal sizes.** On the customer PDP, after the user clicks the **Reorder** option on the order-mode pill, the size picker does **not** show the available sizes to reorder. (Expected: Reorder/bulk mode lets you order any size for a production run — all sizes should be selectable.)

**Symptom 2 — a "Stocked" item behaves oddly.** A staff user has set a catalogue item's **Fulfilment mode = Stocked** in the editor (confirmed: exactly **1** item currently has `fulfilment_type_override = 'stocked'`). The reporter is unsure whether the customer PDP handles a Stocked item correctly. Investigate the full Stocked path end-to-end.

**Symptom 3 — no inventory numbers in From-inventory mode.** When the user selects **From inventory**, the available stock quantities do **not** show next to the sizes. This is the *opposite* of what's wanted: in From-inventory mode the customer needs to see how much stock is available per size. **This is almost certainly Plan C's Item 3 behaving as written** — Task 6/7 deliberately set `VariantPicker`'s `inStockOnly` to suppress the "{qty} in stock" status text and drop the "Available" column **in inventory mode**. Treat the requirement as **inverted**: From-inventory mode should *show* available quantities (and still restrict to orderable/in-stock sizes); it should NOT hide the numbers. Confirm the exact suppression points (`VariantPicker.tsx` status block under `inStockOnly`, and the `visibleSizeRows` / "Available" column drop in `ProductDetailClient.tsx`) and restore the quantity display for inventory mode.

These three may share root causes or be distinct — determine that by reproduction, don't assume. They all live in the **same blast radius: the inventory/reorder mode rendering added by Plan C (Tasks 5–7).**

## Background — how the feature works (so you can trace, not guess)

**Staff authors the mode (already shipped, branch merged):** `src/components/catalogues/CatalogueItemEditor.tsx` has a "Fulfilment mode" `Dropdown` (the one in the reporter's HTML: `id="cie-fulfilment-mode"`, a custom Radix-style button, **not** a native `<select>`). Blank = "Inherit master". It writes `b2b_catalogue_items.fulfilment_type_override` (nullable enum `product_fulfilment_type` = `stocked | made_to_order | mixed`) via `PATCH /api/catalogues/[id]/items/[itemId]` → `buildItemPatch()` in `src/app/api/catalogues/[id]/items/[itemId]/route.ts`. The master `products` row is never written.

**Customer portal consumes it (shipped on `main`):**
- `lib/shop/fulfilment-mode.ts` — the spine: `effectiveFulfilment(override, base) = override ?? base ?? 'made_to_order'`, `pillsFor()`, `matchesMode()`, `PILL_LABELS`.
- `app/(portal)/catalogue/[productId]/page.tsx` — reads `fulfilment_type_override` for the item + `fulfilment_type` from the master, passes the **effective** mode into the client as `product.fulfilment_type`.
- `components/shop/ProductDetailClient.tsx` — the PDP. Key state/derivations (line numbers approximate — confirm live):
  - `const [orderIntent, setOrderIntent] = useState<OrderIntent>('inventory')` (~line 115) — `'inventory' | 'bulk'`, **defaults to `'inventory'`**.
  - `isOrgAdminViewer = customerRole === 'org_admin'`.
  - `canChooseOrderIntent` (~218) — whether the toggle renders.
  - `isInventoryMode` (~230) — whether the PDP is in draw-from-stock mode:
    ```ts
    const isInventoryMode =
      !isOrgAdminViewer ||
      product.fulfilment_type === 'stocked' ||              // <-- forces inventory for stocked
      (currentSelectionHasInventory && brackets.length === 0) ||
      (canChooseOrderIntent && orderIntent === 'inventory')
    ```
  - `visibleSizeRows` (~240) — `isInventoryMode ? sizeRowsForColour.filter(in-stock) : sizeRowsForColour`. This drives the inline multi-size table.
  - `<VariantPicker ... inStockOnly={isInventoryMode} />` (~817) — in `multi_size_with_variants` the VariantPicker renders **colour-only** (`showSizePicker={false}`); sizes come from the inline table driven by `visibleSizeRows`. Confirm which surface the reporter sees empty.
  - `OrderIntentToggle` (~1140) — the pill; labels from `PILL_LABELS` (`From inventory` / `Reorder`); calls `setOrderIntent`.
- `components/shop/VariantPicker.tsx` — `inStockOnly` prop hides zero-stock/untracked sizes + status text.

**⚠️ There is an UNMERGED customer-side fix you must build on, not duplicate:** branch **`fix/pdp-toggle-mixed-gate`** (@ `1282e9a`, pushed, NOT merged). It removed a `product.fulfilment_type === 'mixed'` condition that had been hiding the toggle from almost everything, so `canChooseOrderIntent` is now:
```ts
const canChooseOrderIntent =
  isOrgAdminViewer &&
  currentSelectionHasInventory &&
  brackets.length > 0
```
The reporter is testing *with this branch's behavior* (the pill is visible again). **Base your customer-portal work on `fix/pdp-toggle-mixed-gate`** (branch off it), so the restored toggle is included. Jamie will merge the combined result. Confirm the branch is the intended baseline before starting; if `main` already contains an equivalent toggle-restore, reconcile rather than fork.

## Current production data (verified read-only 2026-06-03 — re-confirm if stale)

- `b2b_catalogue_items.fulfilment_type_override`: **156 NULL (inherit)**, **13 `mixed`** (all in "Shopify Port Catalogue", 12 of them with zero in-stock variants), **1 `stocked`**.
- **All 141** master products exposed in active catalogues are `made_to_order` (0 stocked, 0 mixed at the master level).
- So a product's **effective** mode is `made_to_order` unless it's one of the 13 mixed or the 1 stocked override.

## Leading hypotheses — VERIFY each by reproduction, do not assume

1. **Stocked forces inventory mode, making the toggle inert (likely Symptom 1 + 2 for the stocked item).** For a `stocked` product, `isInventoryMode` is hard-forced `true` by the `product.fulfilment_type === 'stocked'` clause. But `fix/pdp-toggle-mixed-gate`'s `canChooseOrderIntent` (`isOrgAdminViewer && currentSelectionHasInventory && brackets.length > 0`) is **true** for a stocked item that has stock + tiers — so the **Reorder pill renders, but clicking it can't change anything** (isInventoryMode stays true), and sizes stay filtered to in-stock-only → "Reorder doesn't show sizes." Per spec, **stocked = inventory-only, no toggle at all.** Candidate fix: add `product.fulfilment_type !== 'stocked'` to `canChooseOrderIntent` so stocked shows no toggle. Verify this resolves both symptoms *for the stocked item*.
2. **A genuine reorder-mode size bug independent of stocked.** Reproduce Symptom 1 on a **non-stocked** product — a `mixed` item (or a `made_to_order` item with stock + tiers) viewed as `org_admin`. Click Reorder (`orderIntent='bulk'`). Trace whether `isInventoryMode` actually flips to `false`, whether `visibleSizeRows` becomes the full set, and whether the inline size table / VariantPicker re-renders. If sizes are still hidden when `isInventoryMode === false`, there is a second, separate defect in the size-render path — find it. Add diagnostic logging at the gate→mode→visibleSizeRows boundary if needed to see where it breaks.
3. **Staff side: confirm authoring is correct, decide if Stocked should be offered.** Round-trip the staff editor (read-only verify): does setting Stocked persist `fulfilment_type_override='stocked'` and only that (master untouched)? Does the dropdown correctly show "Inherit master (…)" when the override is NULL vs. the explicit value when set? If the staff editor is correct, the staff-side "fix" may be purely confirming it + ensuring the customer side handles every authorable value (`stocked`/`made_to_order`/`mixed`/inherit) coherently. If Stocked is genuinely unsupported end-to-end, the staff-side decision (warn? disable? fully support?) is the reporter's call — surface it, don't silently remove the option.

## Reproduction matrix (build this first)

For `customerRole = org_admin`, reproduce the PDP behavior for each effective mode and record gate/mode/visible-sizes at each step:

| Effective mode | Has stock? | Has tiers? | Toggle shows? | Default mode | Click Reorder → sizes shown? | Correct? |
|---|---|---|---|---|---|---|
| stocked | yes | yes | ? | ? | ? | spec: inventory-only, NO toggle |
| mixed | yes | yes | ? | ? | ? | spec: both pills, Reorder→all sizes |
| made_to_order | yes | yes | ? | ? | ? | toggle ok, Reorder→all sizes |
| made_to_order | no | yes | ? | ? | n/a | reorder-only, all sizes |

Use the unit/component test harness (`components/shop/__tests__/ProductDetailClient.pills.test.tsx` and `ProductDetailClient.inventory-sizes.test.tsx` are the existing fixtures — mirror their mock surface) to reproduce deterministically, plus a real browser check against a **test catalogue** item for confidence.

## Hard constraints

- **No prod writes / no migrations / no edge deploys.** Read-only `execute_sql` for diagnosis only.
- **Don't reintroduce the `'buyer'` role literal** (renamed to `'staff'`, merged). Gating is on `isOrgAdminViewer` / `=== 'staff'`.
- **`CartTable` is the oversell net — don't edit it.**
- **Portal UI conventions** — no new visual language; no page sub-headers/eyebrows.
- **Keep the restored toggle** (`fix/pdp-toggle-mixed-gate`) intact; refine its gate, don't revert it.
- Follow each repo's `AGENTS.md`; the staff editor must follow `docs/ui/oem-rules.md`.

## Fix discipline (once root cause is proven)

- Write a failing test that reproduces the defect (component test for the PDP gate/mode/size-render; route/coerce test if the staff side needs a change). Watch it fail for the right reason.
- Minimal fix at the **root cause**, not the symptom. If the fix is the stocked-guard on `canChooseOrderIntent`, also re-check `isInventoryMode`'s stocked clause and the `visibleSizeRows`/`inStockOnly` wiring for consistency (stocked → inventory-only sizes, made_to_order/mixed Reorder → all sizes).
- Re-run the full shop suite (`npx vitest run components/shop`) + `npx tsc --noEmit` + the relevant staff suite. Baseline before your work: portal `tsc` 0 errors and full suite green; staff has ~20 pre-existing `tsc` errors in `views/confirm`+`views/publish` `route.test.ts` only — anything else red is yours.

## Branches / handoff

- **Customer:** branch off `fix/pdp-toggle-mixed-gate` (e.g. `fix/pdp-stocked-and-reorder-sizes`). Commit per fix, push, **do NOT merge** — Jamie merges.
- **Staff:** if a code change is needed, branch off `master` (e.g. `fix/catalogue-fulfilment-stocked`); otherwise report "no staff code change needed, verified" with evidence. Push, don't merge.
- No force-push, no history rewrite. If a branch already exists or `main`/`master` moved, stop and surface it.

## STOP — when done

Report, with pasted evidence:
1. **Root cause** of each symptom (one or two causes — say which), traced to the exact gate/mode/render line.
2. The reproduction matrix, filled in (before vs. after).
3. What changed in each repo (or "no change needed, verified") + branch@sha, pushed-not-merged.
4. Confirmation: stocked → inventory-only with no inert toggle; mixed/made_to_order Reorder → all sizes shown; full suite + `tsc` green; `'buyer'` absent.
5. Any product decision left for Jamie (e.g. whether "Stocked" should be a first-class customer-facing mode, or the `pillsFor()` single-pill display for non-mixed products — currently unwired).

## Definition of done

- Both symptoms reproduced, root-caused, and fixed at the source (or explicitly deferred with Jamie's decision).
- Customer: stocked item shows **no** order-mode toggle and inventory-only sizes; non-stocked items' **Reorder** shows all orderable sizes. Built on `fix/pdp-toggle-mixed-gate`, pushed, not merged.
- Staff: authoring verified correct (or fixed), pushed, not merged.
- No prod writes/migrations; `CartTable` untouched; `'buyer'` literal absent; portal `tsc` 0 errors + full suite green.
