# IDE prompt — verify & harden the pooled-decoration-pricing implementation plan against the real source

> Paste everything below the line into your in-repo IDE agent (run it inside `print-room-portal`; you will also need read access to the sibling repo `/Users/jamierogangeorge/Documents/print-room-staff-portal`).
> **Docs-only task.** You are reviewing and editing two planning documents — you are NOT building the feature. Do not modify any application code, migrations, or tests in either repo.

---

## Objective

Act as a senior engineer doing a pre-build review of an implementation plan. The plan was written against a code survey and cites specific files, line numbers, function names, RPC signatures, and schema. Your job is to (1) **verify every code-level claim against the actual source in both repos**, (2) **adversarially review the architectural choices** for fit with how the code actually works, and (3) **edit the plan in place** wherever it is wrong, imprecise, or where you find a materially better approach — so that the engineer who picks it up can trust every sentence.

The documents (both in this repo):

- `docs/2026-08-13-pooled-decoration-pricing.md` — the agreed product/design spec. Treat its **decisions as fixed** (see "What is NOT up for review" below). Correct it only where it misstates a code fact.
- `docs/2026-08-13-pooled-decoration-pricing-implementation-plan.md` — the implementation plan. This is your primary edit target.

## What the feature is (one paragraph of context)

Cross-garment volume pooling: cart/checkout lines in the same B2B catalogue that share a real library decoration (`org_decorations` row) pool their quantities. Every pooled line band-selects at the combined quantity but reads the selected band from its own item's price ladder; a line's decoration cost is the sum over its decorations of a new per-decoration quantity ladder evaluated at that decoration's pooled qty; a line's garment band qty is the **max** pool among its decorations (never below its own qty). Gated per catalogue by a new `b2b_catalogues.decoration_pooling_enabled` flag, default off; with the flag off, pricing must be byte-identical to today.

## What is NOT up for review

These are locked product decisions — do not relitigate them, only implement-check them:

- Pooled band **selection** with own-ladder prices (no price inheritance between garments); the max rule; per-decoration ladders as the single decoration-price source; eligibility rules ($0/`custom` placeholders never pool, stocked lines excluded both directions, prepaid lines contribute qty, same-catalogue only); amendments fully recompute (up **and** down) with a staff re-band warning; per-catalogue opt-in after AM ladder sign-off; ordering-period pricing out of scope; Trade Services pilot.

Everything else — sequencing, module boundaries, migration contents, function-level approach, test strategy, the accuracy of every code citation — IS up for review.

## Claims to verify (the load-bearing ones — check each against source, then sweep the rest)

Customer repo (`print-room-portal`):

1. `lib/cart/types.ts` — `decorationSignature` (~:181) sorts `decorationId`s; `pickBracket` (~:221); `recomputeProductTierPrices` (~:247) aggregates by `` `${productId}::${decorationSignature}` `` and operates **purely on ladder data snapshotted onto the line at add-time** (`brackets`, `decorations[].brackets`, `manualDecorationBrackets`) with no fetches. Confirm the `CartLine` fields the plan relies on (`catalogueItemId`, `fulfilmentType: 'stocked'`, `billingMode`, `decorations[].decorationId`) and that the proposed new snapshot fields (`catalogueId`, `poolingEnabled`, per-decoration `poolable`) don't collide with anything.
2. `lib/checkout/submit.ts` — `tierAggregationKey` (~:485, product-keyed) vs `garmentPriceAggregationKey` (~:504, item-aware `item:<id>::sig`); `pricing_pool_lines` (~:120-130) seeding `poolLines` (~:750); `decorationQtyForLine` (~:1026); drift guards `UnitPriceDriftError` (~:895), `DecorationDriftError` (~:1271), and the manual-final drift path in `applyManualDecorationForLine`; the manual path calling `catalogue_item_decoration_price` with pooled qty; garment RPCs (`effective_unit_price_for_item` / `period_unit_price` / legacy `effective_unit_price`) fed by `garmentPriceGroups` totals. Confirm where the plan says "fetch the catalogue flag once per checkout" can actually hook in (the `loadTierMultiplier` once-per-checkout pattern).
3. Tests the plan promises to extend: `lib/checkout/__tests__/submit.pricing-pool.test.ts`, `submit.tier-aggregation-key.test.ts`, `submit.drift-characterization.test.ts`, `submit.roundtrip-regression.test.ts` (query-count budgets), `lib/cart/__tests__/types.test.ts`. Confirm names, and whether the claimed duplicate cart test file (`lib/cart/types.test.ts` AND `lib/cart/__tests__/types.test.ts`) really exists — if so the plan should say which to extend.
4. PDP loader `app/api/shop/products/[id]/route.ts` joins `b2b_catalogues!inner(...)` (so adding `decoration_pooling_enabled` + catalogue id to the response is cheap) and `lib/shop/decorations.ts loadCatalogueItemDecorations` already ships per-decoration prices + `recalcInputs` to the client.

Staff repo (`print-room-staff-portal`):

5. Baseline schema `supabase/migrations/20260720000001_baseline_schema.sql` — `org_decorations` (~:10404; `decoration_method IN (screenprint, embroidery, heatpress, supacolour, dtf, custom)`, `artwork_id` nullable), `b2b_catalogue_item_decorations` (~:8248), `b2b_catalogue_item_pricing_tiers` (~:8324; per-band `decoration_unit_price` comment "frozen on save"), `b2b_catalogues` (~:8418; only boolean is `is_active`).
6. `effective_decoration_unit_price(p_org_decoration_id, p_qty)` (~:3282) is genuinely the chokepoint the plan claims: confirm its callers include the checkout path (`lib/checkout/decoration-effective-price.ts` in the customer repo), `plan_order_amendment`, and the bulk RPCs (`effective_decoration_unit_prices_bulk`). Confirm prepending a ladder lookup there changes all of them and nothing else. **If you find a decoration-price consumer that does NOT route through it** (e.g. `catalogue_item_decoration_price` for manual items, the PDP static price via `COALESCE(link.unit_price_override, org_decorations.unit_price)`, seed routes), the plan must name it and state how it's handled — check the plan does, and fix where it doesn't.
7. `plan_order_amendment` — defined in `20260805120000_atomic_order_amendments.sql` AND replaced in `20260807120000_xero_amendment_effect.sql`; `v_group_qty` summed per `catalogue_item_id` from `p_intended_state->'lines'` (~:335-337 in the 0807 file). Confirm the 0807 version is the live one and that **no other function** in either file aggregates quantity (the plan claims pooling lives only in this function — falsify that if you can; grep every RPC touching `quantity` in amendment/teardown/submit migrations, including anything applied after 2026-08-07).
8. `/api/pricing/quote-line` (`src/app/api/pricing/quote-line/route.ts`) prices one line with no sibling-line context (`resolveOrderAmendmentScope` fetches only the org). Confirm the plan's "derive pools server-side from order_id" is achievable with the data available in that route.
9. Tiers write path: `.../items/[itemId]/tiers/route.ts` PUT is delete-then-insert with no transaction and no structural ladder validation (`resolve-pricing-tier-writes.ts` doc comment says so explicitly). The plan's new org-decoration ladder route promises to fix both — sanity-check the proposed fix against how the repo actually does transactional writes (is there an existing RPC-wrapped write pattern to copy?).
10. Migration conventions: `db/pending-migrations/` holding pattern exists with a README; AGENTS.md forbids dashboard/MCP schema changes. Confirm the plan's migration file naming/sequencing matches current practice, and that new-table RLS in the plan's Phase 0 DDL matches the conventions established by the 2026-08-12 auth-hardening migrations (`20260812110000` / `20260812120000`).

## Architectural review — questions to actively try to break

- **Chokepoint blast radius:** ladder-first inside `effective_decoration_unit_price` means a signed-off ladder reprices that decoration in every catalogue it's attached to, including flag-off ones. The plan accepts this (spec: single source of truth; sign-off is the gate). Does anything in the code make this worse than the plan admits — e.g. PDP price displays or catalogue-grid overlays (`lib/shop/catalogue-decoration-prices.ts`) that would show ladder prices in flag-off catalogues while checkout charges the same? If display and charge stay consistent, fine — verify they do.
- **Flag-off byte-parity:** is it actually achievable in `recomputeProductTierPrices` and `submitCustomerOrder` as structured, or does the plan's branching force a refactor the plan doesn't budget for?
- **Max rule vs item-aware garment groups:** the plan keeps `garmentPriceGroups` keyed as-is and changes only the qty fed to the RPCs. Check for consumers of the group's `totalQty` beyond price lookup (MOQ checks ~:626-711, order-type classification, billed-total/picking-fee/prepaid logic in `lib/pricing/order-billing-shape.ts`, `order-picking-fee.ts`) that would be wrongly affected if qty is inflated by the max rule — the pooled qty must feed **band selection only**, never billed quantities. If the plan doesn't state that guard explicitly enough for each consumer, strengthen it.
- **Cart staleness:** pooling makes line prices depend on *other lines*; today's recompute already handles that per-product — confirm the recompute is invoked on every mutation path (add, remove, qty edit, merge, restore-from-storage) so cross-line pooling can't go stale on a path the per-product version tolerated.
- **`pricing_pool_lines` under pooling:** the F1 mixed-cart split partitions stocked vs made-to-order. Stocked lines are pooling-excluded — confirm the split still composes (pool seeds must exclude stocked lines even when they appear in `pricing_pool_lines`).
- **Anything simpler:** if the source reveals a materially simpler seam for any phase (an existing RPC, an existing config pattern, an existing recompute hook), propose it in the plan with a short justification.

## How to edit

- Fix wrong line numbers/names/signatures silently (they're citations, not content).
- For substantive corrections or architecture changes, edit the plan text directly AND add a `## Review changelog (2026-08-13)` section at the bottom of the plan listing each change as one line: *what the plan said → what the code says → what you changed*.
- If you find a genuine blocker (something the locked design cannot survive as specced), do NOT silently redesign around it: record it under a `## Blockers found` heading in the plan with the evidence, and leave the affected plan section marked `⚠ BLOCKED`.
- Keep the plan's voice: terse, file-grounded, no filler.

## Deliverable

The two edited docs, plus a final chat summary: claims verified clean (count), citations corrected (count), substantive changes (list), blockers (list or "none"). Do not start building anything.
