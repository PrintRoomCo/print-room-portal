# Pooled Decoration Pricing ("Same Artwork Savings")

**Date:** 2026-08-13
**Status:** Spec agreed (Jamie + Claude design session; supersedes the planned Loom walkthrough)
**Requested by:** Chris (account management), driven by workwear customers (Trade Services / Otago)
**Repos affected:** `print-room-portal` (customer), `print-room-staff-portal` (staff + shared DB migrations)

---

## 1. Problem

Volume-break quantity is currently scoped to a single catalogue item. Pooling exists only across colour/size lines of the **same** garment listing. A workwear customer ordering 500 t-shirts + 100 hoodies with the identical left-chest logo gets two separate band lookups (500 and 100) instead of the combined 600 they expect — "we're putting the same logo on 600 garments, price us like it."

Real-world driver: Trade Services ordered 4 polos + 4 hoodies with one embroidered logo = 8 decorated garments, but each item priced in its 1–7 band.

## 2. The rule (agreed)

> **Lines in the same catalogue that share a decoration pool their quantities. Every pooled line band-selects at the combined quantity, but each line reads the selected band from its own item's price ladder.**

### Worked example A — identical decoration set

500 tees + 100 hoods, both carrying the same left-chest print (same `org_decorations` row):

| Line | Qty ordered | Band selected | Garment price from | Decoration price from |
|---|---|---|---|---|
| Tee | 500 | **600+** | Tee's own ladder, 600+ row | Left-chest decoration ladder @ 600 |
| Hood | 100 | **600+** | Hood's own ladder, 600+ row | Left-chest decoration ladder @ 600 |

The hood is **not** priced "as a tee." It jumps to the band the combined order earns, but the price in that band is the hood ladder's own figure. Whether the 600+ hood price is commercially acceptable at 100 units is a margin decision AMs own when they author the ladder — the engine just applies it.

### Worked example B — mismatched decoration sets (the "ambiguous" case)

Tee ×500 (left-chest A), Hood ×100 (left-chest A **+** back-print B), Cap ×50 (back-print B only):

- Pool for decoration A = 500 + 100 = **600**
- Pool for decoration B = 100 + 50 = **150**

| Line | Decoration pricing | Garment band qty (max rule) |
|---|---|---|
| Tee | ladder(A, 600) | **600** |
| Hood | ladder(A, 600) + ladder(B, 150) | **600** (max of 600, 150) |
| Cap | ladder(B, 150) | **150** |

Two rules make mismatched sets "just work" with no special-case code:

1. **Per-decoration pooling for decoration price.** A line's decoration cost is the sum over its decorations of `ladder(decoration, that decoration's pooled qty)`. The hood's extra back print is automatically the "sequential difference added on."
2. **Max rule for garment band.** A line's garment band quantity = the **largest** pool among its decorations (never below its own line qty). This deliberately avoids transitive contagion: the cap does not inherit the 600 band just because the hood bridges groups A and B.

## 3. Price source: per-decoration ladders (the structural change)

Today `b2b_catalogue_item_pricing_tiers.decoration_unit_price` is **one combined per-band figure typed per garment**, and figures drift between items sharing a logo (live data: AF Relax Socks 0.93/0.70/9.00 vs Stencil Hood 22.50/2.62/5.74/7.50 for comparable bands, including entry anomalies). One combined number can't price a per-placement delta, and per-item ladders evaluated at pooled qty can disagree on the same logo.

**Decision:** decoration pricing moves to a **quantity→price ladder authored once per decoration** (new table, e.g. `org_decoration_pricing_tiers`: `org_decoration_id`, `min_quantity`, `max_quantity`, `unit_price`). This ladder is the **single source of truth for decoration price everywhere** — pooled or not, customer or staff. `b2b_catalogue_item_pricing_tiers.unit_price` remains the garment-only price; the per-band `decoration_unit_price` column is retired after backfill.

- **Computed screenprint** stays engine-priced (`calculate_screenprint_pricing_api`) — it is already qty-fed; it simply receives the pooled qty.
- **Computed embroidery** stays stitch-ladder priced (`emb_unit_price_for_inputs`) — qty-independent by design, unaffected by pooling. Volume breaks on embroidery exist only via a manual ladder.
- **Backfill:** generate each decoration's ladder from the existing per-item band figures of the items it's attached to; where donor items disagree, flag for AM resolution. Per-catalogue AM sign-off required before pooling activates (see §7).

## 4. Staff-side authoring: merged Artwork + Decorations feature

Per Chris: the org-page **Artwork** and **Decorations** features merge into one. At catalogue build, the AM defines the artwork/decoration once (file + method + placement + its price ladder) and assigns it to the applicable garments. Identity for pooling stays the **decoration** (`org_decorations` row = artwork + method + location), not the raw `artwork_id`, even if the UI presents them as one thing — a left-chest embroidery and an A3 back screenprint of the same file must not pool.

## 5. Eligibility (what pools, what doesn't)

- **Real library decorations only.** The $0 `method='custom'` "Custom decoration" placeholder never pools (it is attached catalogue-wide: MTF ×28 items, Anytime Fitness ×15, Trades Services ×12, Reburger ×7 — naive pooling by `org_decoration_id` would pool entire catalogues). Exclude `$0`/`custom` placeholders structurally.
- **Same catalogue only.** No cross-catalogue pooling.
- **Stock-on-hand lines neither contribute nor receive.** Stock lines are pre-decorated units at a fixed stock price ([stock-on-hand is stock-only rule]); they don't add to pools and don't re-band.
- **Prepaid / all-in lines contribute quantity** to the pools (they are genuinely decorated garments) but their own line pricing stays per the prepaid rules ($0 / all-in unchanged).
- **Ordering-period pricing is out of scope** (periods pool per-item across orders on their own frozen-price system; crossing the two is a separate design).

## 6. Where quantities are read and recomputed

- **Customer cart (live recompute):** drop `productId` from the decoration aggregation key in `recomputeProductTierPrices` (`lib/cart/types.ts:247–248`, key currently `${productId}::${decorationSignature}`) and pool by `org_decoration_id` within the catalogue; apply the max rule for garment band selection.
- **Checkout server (authoritative re-derivation):** same change in `tierAggregationKey` / `totalQtyByDecorationTierKey` / `garmentPriceAggregationKey` (`lib/checkout/submit.ts:485/751/504`). The server re-derives every price and throws `UnitPriceDriftError` / `DecorationDriftError` on mismatch — **cart and server must ship in lockstep**. `pricing_pool_lines` (`submit.ts:129`) already threads pool-wider-than-submission context through checkout partitioning.
- **Order snapshot:** `quote_items` stores one folded `unit_price` + `decorations` jsonb including `decorationId` (= `org_decorations.id`), so pool identity survives post-checkout. No snapshot schema change.
- **Amendments — full recompute:** staff add/remove/resize recomputes all pools in the order; lines re-band **up or down** (removing the tees can raise the hood price). The amendment RPCs currently pool per `catalogue_item_id` via `v_group_qty` (`20260805120000_atomic_order_amendments.sql:388–390,481`; `20260807120000_xero_amendment_effect.sql:342,360`) and need the same cross-item key change. Staff UI shows a **"this change re-bands N other lines"** warning before commit, and staff manual price override remains the goodwill valve when honouring the original price.
- **Staff order editor parity:** the staff quote-line endpoint (`LineItemRow.tsx:192–273` → `POST /api/pricing/quote-line`) prices per-line today and must learn the same pooling, or a staff-keyed copy of a customer's basket prices differently. In scope for v1.

## 7. Rollout

- **One release** covering customer cart + checkout + amendment RPCs + staff editor (the drift guards make the seam non-incremental).
- **Per-catalogue opt-in.** Pooling activates for a catalogue only after its decoration ladders are backfilled and the AM signs off. Until then, pricing behaves exactly as today — which also quarantines the placeholder-polluted catalogues until cleaned up.
- **Pilot: Trade Services (Otago)** — the driving customer; 12 items, one org — once their real embroidery decoration replaces the $0 placeholder.

## 8. Customer-facing display

- **Cart + checkout review:** "Same artwork savings" pill on each pooled line, tooltip: *"This artwork appears on 600 garments in your order, so this line is priced at the 600+ rate. Removing other garments may change this price."* Outcome, not formula — no itemised per-placement math.
- **Next-band nudge:** "Add N more garments with this artwork to reach the next price break" (reuses the `period_savings` messaging pattern).
- **PDP:** static note only ("quantities combine across garments sharing this artwork"); no live cross-product simulation on the product page.

## 9. Out of scope (v1)

- Ordering-period pricing interaction.
- Cross-catalogue or cross-order pooling.
- Any change to computed-embroidery stitch pricing.
- Automated cleanup of $0 placeholder decorations (prerequisite per catalogue, done as data work during activation).

## 10. Risks / open items

- **Margin exposure** is now an authoring concern: a small add-on line rides the big line's band by design. AMs must price ladder tails knowing this.
- **Backfill disagreements** (per-item figures that conflict for a shared logo) need AM decisions per catalogue — this is the activation gate, not a blocker to shipping the engine dark.
- **Ladder validation:** current tier writes have no overlap/ordering guard beyond the per-row `qty_range` CHECK (`min_quantity > 0` and `max_quantity is null or max_quantity >= min_quantity`, baseline :8332); the new decoration-ladder editor should validate contiguous, non-overlapping bands.
- **Placeholder cleanup** for pilot org (Trade Services) must land before activation.

---

## Amendment — 2026-08-26: §3 applies to COMPUTED items only

**Status:** Built. Full reasoning, findings and decisions: [`docs/2026-08-26-pooled-manual-decoration-own-ladder.md`](./2026-08-26-pooled-manual-decoration-own-ladder.md).

§3 above declares the per-decoration ladder *"the single source of truth for decoration price everywhere — pooled or not"*. **That is now scoped to `price_mode = 'computed'` items.** For `price_mode = 'manual_final'` items the rule is:

> A pooled `manual_final` line's decoration cost is the item's **own combined per-band `decoration_unit_price`**, band-selected at the **pooled band quantity** (the max rule of §2.2 — the largest pool among the line's own poolable decorations, never below its own group quantity).

In other words, for `manual_final`, **pooling changes the quantity and nothing else** — which is precisely §2's agreed rule ("every pooled line band-selects at the combined quantity, but each line reads the selected band from its own item's price ladder"), applied to the decoration half as well as the garment half. §3 was the section that quietly stopped that from being true.

### Why one of §3's two reasons does not survive

§3 gave two reasons for moving decoration price onto `org_decoration_pricing_tiers`.

1. **"One combined figure can't express a per-placement delta."** **Accepted, unchanged.** A hood carrying left-chest *plus* back-print needs the back print to cost the marginal difference, and a single blended number cannot decompose into that. This is exactly why computed items keep per-decoration ladders and are untouched by the amendment.

2. **"Per-item decoration figures drift for the same logo"** (AF Relax Socks `0.93/0.70/9.00` vs Stencil Hood `22.50/2.62/5.74/7.50`). **Does not apply to `manual_final`.** That reads as a data-quality defect only if the number is a claim about what the logo costs to print. On a `manual_final` item it is not: the AM types one **all-in price per garment**, and the decoration figure is a **back-solved residual** of it. A sock and a hoodie carrying the same logo *should* produce different residuals — that is what all-in pricing means. §3 retired the AM's primary pricing control to fix a problem `manual_final` does not have.

The business cost was concrete: on a pooled catalogue the account manager lost the Total-price lever (edit the all-in figure; it back-solves decoration and leaves base cost untouched), which is the main reason `manual_final` exists.

### What this changes in the sections above

- **§3** — "single source of truth for decoration price everywhere" now reads "…for **computed** items". `b2b_catalogue_item_pricing_tiers.decoration_unit_price` is **not** retired: it remains the authored, charged price for `manual_final` items, pooled or not. The staff pricing editor keeps it editable, and its warning note now says so.
- **§6** — the amendment RPCs also apply the per-decoration/combined split by `price_mode`. `amendment_decoration_unit_price_for_currency` gained a `p_band_qty` argument and a leading pooled-`manual_final` branch that fires in **every** currency, resolving a pre-existing split where NZD priced pooled manual lines per-placement while non-NZD priced the combined figure at the *un-pooled* quantity.
- **§7** — the per-catalogue opt-in and the ladder-readiness gate are unchanged. The gate still demands an `org_decoration_pricing_tiers` ladder for every real decoration on an enabled pooled catalogue even where only `manual_final` items use it; that over-demand is deliberate and documented (a decoration can serve both modes in one catalogue, so a per-decoration relaxation is not a simple test).
- **§8** — the "Same artwork savings" pill is unaffected and is now *more* accurate for manual lines: the band it names is the band both halves of the price actually read.

Everything else in this spec stands: pool identity, the max rule and its deliberate non-transitivity, eligibility (§5), per-catalogue opt-in, and the invariant that a pooled quantity is a **band-selection** quantity only.
