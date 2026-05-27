# Cart aggregation tier pricing — Spec

**Date:** 2026-05-28
**Status:** Draft (Jamie approving before any code)
**Companion plan:** `docs/superpowers/plans/2026-05-28-cart-aggregation-tier-pricing-plan.md` (after spec sign-off)

## Problem

The cart shows partial / wrong tier pricing for multi-line orders of the same product. Two symptoms:

1. **Garment never re-tiers on aggregate qty** when the product uses the markup ladder (no manual `b2b_catalogue_item_pricing_tiers` rows). PDP page reads brackets from the manual ladder table directly, so the cart line gets `brackets: []` and `recomputeProductTierPrices` skips garment re-tiering. Symptom: in a cart with Staple Tee × 25 + Staple Tee × 1000, line 1 shows garment at qty-25 tier ($12.74), line 2 shows qty-1000 tier ($7.92). Both should show qty-1000 tier ($7.92) because aggregate cart qty = 1025.

2. **Decoration re-tiers but garment doesn't.** Decoration brackets come from `/api/shop/decoration-pricing` (new pipeline, probes [1, 24, 50, 100, 250, 500, 1000]) — they work. Garment brackets come from the legacy direct-table read — they don't cover the markup ladder. Customer sees a half-aggregated price like $12.74 + $2.72 = $15.46, which matches neither standalone tier nor aggregate tier.

3. **Aggregation key is too broad.** Even after fixing brackets, `recomputeProductTierPrices` aggregates by `productId` alone. Two lines of the same product with different decoration methods would pool qty for tier pricing, which is commercially wrong — different decoration methods have different setup-fee amortization curves.

## Goal

Cart tier pricing aggregates qty across cart lines using a specific, well-defined match key. Both garment and decoration unit prices re-derive from the aggregate qty on every cart mutation. Server drift guard recomputes the same way so split-line orders don't false-positive `UnitPriceDriftError`.

## Aggregation rule (formal)

Two cart lines aggregate qty for tier-band lookup when **both** conditions hold:

1. Same `product_id`.
2. Same `decorationSignature(decorations)` — sorted, pipe-joined list of `linkId`s from the line's decorations. Existing helper at [lib/cart/types.ts:98-105](print-room-portal/lib/cart/types.ts#L98-L105).

The aggregate qty is the SUM of `qty` across all matching lines.

Lookup behaviour per line:

- **Garment** unit price = `pickBracket(line.brackets, aggregate_qty).unitPrice`. If brackets missing or no band matches, keep `line.unitPrice` as-is.
- **Each decoration** unit price = `pickBracket(decoration.brackets, aggregate_qty).unitPrice`. Same fallback rule per decoration.
- **Line total** = `line.qty × (garment_unit + sum_of_decoration_units)`. Aggregate qty is ONLY used for the band lookup — never multiplied.

## Match key vs merge key

| Concept | Where | Key | Purpose |
|---|---|---|---|
| **Cart line merge** (existing) | `lineSignature` at [lib/cart/types.ts:113-121](print-room-portal/lib/cart/types.ts#L113-L121) | `product + variant + variantLabel + fulfilmentType + decorationSignature` | When user adds the *exact* same line twice, sum qty into one line instead of two. |
| **Tier aggregation** (NEW) | `recomputeProductTierPrices` | `product + decorationSignature` | When two distinct cart lines share product + decoration set, both re-tier on the sum. Variant + fulfilment differences DO aggregate. |

Aggregation key is a strict subset of merge key — anything that merges into one line also aggregates with itself trivially, but distinct lines that vary only by `variant` / `variantLabel` / `fulfilmentType` still aggregate.

## Edge cases

| Case | Rule | Reason |
|---|---|---|
| Two sizes of same product, same decoration | **Aggregate** | The original Jamie requirement. Product + signature match. |
| Same product, decoration A vs decoration B (different methods) | **Don't aggregate** | Decoration signatures differ. Engine setup-fee amortization is per-method-per-artwork and shouldn't pool across methods. |
| Same product, same method, different artwork | **Don't aggregate** | Different `linkId`s in the signature → signatures differ. Each artwork has its own engine setup. |
| Same product, same artwork, different placement (LC vs Back) | **Don't aggregate** | Different `org_decoration` IDs → different `linkId`s → signatures differ. Engine treats placements independently. |
| Same product, multi-decoration combo on both lines (LC + Back) | **Aggregate** if both lines have the exact same set; **don't** if either has a subset/superset | Signature is a SORTED join of linkIds — must be byte-identical. |
| Two lines of same product, both no decorations (garment-only) | **Aggregate** | Signatures match (both empty strings). |
| Same product+signature but different `variantLabel` (Bone/XS vs Bone/2XL) | **Aggregate** | Variant identity is NOT part of the aggregation key. |
| Same product+signature but one `stocked` + one `make_to_stock` | **Aggregate** | Fulfilment type is operational; per-unit price doesn't depend on it. (Note: this is a Jamie-confirm point — see Open Questions.) |
| Different products, same artwork applied to both | **Don't aggregate** | Different `product_id`s. Garment markup ladders are per-product. Skip cross-product engine amortization for v1 simplicity. |
| Decoration with `brackets: undefined` (heatpress, DTF, leavers, legacy) | **Decoration price stays frozen at snapshot** | No re-tier. Already current behaviour at [lib/cart/types.ts:169](print-room-portal/lib/cart/types.ts#L169). |
| Brackets snapshot doesn't include the aggregate-qty band | **Keep snapshot price** | `pickBracket` returns null → unchanged. This is the current Bug 1 root cause. Fix: PDP must probe all canonical breakpoints `[1, 24, 50, 100, 250, 500, 1000]` for garment AND decoration. |
| Sparse `decoration_price_overrides` band on a decoration | **Engine RPC handles it** | `effective_decoration_unit_price` picks override or engine based on the qty passed in. Pass aggregate qty → it returns the right band. |
| Aggregate qty crosses a tier boundary mid-mutation | **Re-tier fires on every mutation** | `CartProvider` already calls `recomputeProductTierPrices` on add / update / remove / persist load. No new wiring. |
| GST / currency conversion | **Applied on top of aggregated unit price** | Aggregation only changes the base unit price; tax + FX layers compose unchanged. |
| Catalogue card "From $X" advertisement | **Unchanged** | Card already shows qty-1000 floor post-Task-3.5. Aggregation is a cart-level concept. |
| Cart loaded from `localStorage` (returning user) | **Re-aggregate on hydrate** | Already happens at [CartProvider.tsx:134](print-room-portal/components/cart/CartProvider.tsx#L134). |
| Drift guard during `submitCustomerOrder` | **Mirrors aggregation key** | Server-side recompute groups lines by `(product_id, decoration_signature)`, sums qty, calls `effective_unit_price` / `effective_decoration_unit_price` with the aggregate. Each line's expected unit price = that band's value. |
| Cross-line decoration setup-fee amortization across products | **Out of scope v1** | If we want a screenprint run of Logo A on tees + caps + hoodies to share setup fees, that's a separate Spec B. Today the engine sees only this product's aggregate qty. |

## Non-goals (v1)

- Cross-product setup-fee amortization. A future "job-level" pricing model could let one screenprint setup amortize across multiple products in the same cart; not this sprint.
- Showing customers a "tier discount applied" pill on the cart line. Per Jamie's `feedback_include_jon_via_questions` direction, keep the UI quiet — the number speaks.
- Backfilling org_decorations to dedupe across products (the "one org artwork applied to many products" data-model cleanup Jamie noted). That's an orthogonal data-modelling spec.
- Aggregating across organizations (cart is per-org by construction).

## Surfaces affected

| Surface | Change |
|---|---|
| `app/(portal)/catalogue/[productId]/page.tsx` | Brackets prop source: replace `b2b_catalogue_item_pricing_tiers` table read with N `effective_unit_price` RPC calls at canonical breakpoints `[1, 24, 50, 100, 250, 500, 1000]`. |
| `lib/cart/types.ts` (`recomputeProductTierPrices`) | Aggregation key changes from `productId` to `${productId}::${decorationSignature(decorations)}`. |
| `lib/cart/__tests__/types.test.ts` | Add cases for: same product different decorations don't aggregate; same product same signature different variant aggregate; multi-decoration combos. |
| `lib/checkout/submit.ts` (drift guard) | Group submitted lines by `(product_id, decoration_signature)`, sum qty, recompute expected prices against the aggregate. Mirror the cart's lookup behaviour exactly. |
| Sweep — anywhere reading `b2b_catalogue_item_pricing_tiers.unit_price` directly | Replace with `effective_unit_price` RPC call. Anti-pattern from pre-pipeline era. |

## Open questions (Jamie to lock before plan)

1. **Fulfilment type in aggregation key?** Current draft says fulfilment type does NOT split aggregation (a `stocked` line and a `make_to_stock` line of the same product+signature pool for tier band). Confirm or split. *Default if no answer: don't split — per-unit price is identical regardless of fulfilment route.*

2. **What if the aggregate qty exceeds the highest seeded band (2499 today)?** Tail band stays open-ended in current data (1000-2499 max_qty=2499 but the markup ladder seed has `max_qty=2499`). At qty 2500+ no band matches → unitPrice unchanged. *Default if no answer: leave as-is; if Print Room starts running 2500+ unit jobs, extend the ladder via `/settings/pricing` admin page.*

3. **Cross-line setup-fee amortization across products** — confirmed out of scope for v1. Note as a v2 candidate?

4. **Drift-guard tolerance** — current `UnitPriceDriftError` requires exact match. If aggregation produces a different price than per-line, the guard will fire on every legacy in-flight order placed before merge. *Default if no answer: ship the fix; in-flight orders are submitted promptly and the window is narrow.*

## Acceptance criteria

1. Cart with Staple Tee BONE/XS × 25 + Staple Tee BONE/2XL × 1000 on TPRC: both lines show **$10.64/unit** (aggregate qty 1025 lands in the 1000-2499 band).
2. Cart with Staple Tee × 50 (screenprint LC) + Staple Tee × 50 (embroidery LC): each line uses its own qty-50 tier (decorations differ, no aggregation).
3. Cart with Staple Tee × 1000 + Box Hood × 1000: each line uses its own product's qty-1000 tier (different products, no aggregation).
4. Cart with Staple Tee × 50 garment-only + Staple Tee × 50 garment-only (somehow split into two lines): aggregate to 100 → both at qty-100 tier.
5. Removing a line re-tiers the remaining lines down (1025 → 25 = back to qty-24-49 tier on the survivor).
6. `submitCustomerOrder` doesn't throw `UnitPriceDriftError` on any of the above scenarios — server agrees with cart.
7. Vitest coverage for `recomputeProductTierPrices` includes all the edge cases in the table above.
8. No direct reads of `b2b_catalogue_item_pricing_tiers.unit_price` remain in `app/` or `lib/` (sweep confirms zero hits except via the RPC).
