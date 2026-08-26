# Pooled manual_final items keep their OWN combined decoration figure

**Date:** 2026-08-26
**Status:** Built. Customer repo committed on `fix/pooled-manual-own-decoration-ladder`; staff repo committed on the same branch name, **migration authored but NOT pushed**.
**Amends:** [`docs/2026-08-13-pooled-decoration-pricing.md`](./2026-08-13-pooled-decoration-pricing.md) §3 (see the dated amendment section there).
**Requested by:** Jon, after the demo catalogue went pooled and the AM's Total-price lever stopped working.

---

## The rule

> For a `manual_final` catalogue item, a pooled line's decoration cost is the item's **own combined per-band `decoration_unit_price`**, band-selected at the **pooled band quantity** (the max rule: the largest pool among the line's own poolable decorations, never below its own group quantity).

Computed items are unchanged — they keep per-decoration ladders, each placement at its own pooled quantity.

Said plainly: **pooling changes the quantity and nothing else.**

## Why

§3 moved decoration price onto per-decoration ladders (`org_decoration_pricing_tiers`), calling them *"the single source of truth for decoration price everywhere — pooled or not"*. It gave two reasons. Only one survives for `manual_final`.

**Reason 1 — "one combined figure can't express a per-placement delta" — accepted.** A hood carrying left-chest *plus* back-print needs the back print to cost the marginal difference, and a single blended number cannot decompose into that. This is exactly why **computed items are out of scope** and keep per-decoration ladders.

**Reason 2 — "per-item decoration figures drift for the same logo" — does not apply to `manual_final`.** The cited evidence (AF Relax Socks `0.93/0.70/9.00` vs Stencil Hood `22.50/2.62/5.74/7.50`) reads as a data-quality defect only if you assume the number is a claim about what that logo costs to print. On a `manual_final` item it is not: the AM types one **all-in price per garment** and the decoration figure is a **back-solved residual** of it. A sock and a hoodie carrying the same logo *should* have different residuals. §3 retired the AM's primary pricing control to fix a problem `manual_final` does not have.

**Business consequence being fixed.** On a pooled catalogue the account manager lost the Total-price lever — edit the all-in figure, have it back-solve decoration and leave base cost untouched. That lever is the main reason `manual_final` exists.

Note also that the rest of the system never stopped believing the combined figure: the catalogue grid overlay (`lib/shop/catalogue-decoration-prices.ts`), the PDP's server-side orderability gate (`app/(portal)/catalogue/[productId]/page.tsx`, `price_mode === 'manual_final' && seed empty`) and the PDP's client-side country gate (`ProductDetailClient.tsx:822`) are all **price-mode keyed and pooling-agnostic**. Before this change they disagreed with what checkout actually billed on a pooled manual item. Now they agree.

---

## Phase 0 findings

### 1. Current-state tables — verified

Customer repo `print-room-portal` @ `0a4d686`. **Every row verified; every line number as stated.**

| Location | Verified |
|---|---|
| `lib/pricing/decoration-pooling.ts` | ✅ `poolKey`, `isPoolingLine`, `pooledQtyByDecoration`, `pooledDecorationQty`, `garmentBandQty`, `poolSizesForLine`, and the "band-selection quantity only" header |
| `ProductDetailClient.tsx:1179` / `:1205` / `:1212` | ✅ exact |
| `lib/cart/types.ts:345-352` (comment), `:353-357` (clearing), `:363` (`pickBracket(..., total)`) | ✅ exact |
| `lib/checkout/prepare.ts:1067`, `:1084-1091`, `:619`, `:1182`, call sites `:1219` / `:1379` | ✅ exact |
| `app/api/shop/decoration-pricing/route.ts:72` | ✅ `resolveManualCombined` |

Staff repo `print-room-staff-portal` @ `b42f251b`. Verified, with **one correction**: `amendment_decoration_unit_price_for_currency` starts at `:995`; its NZD branch is `:1013-1029` and the non-NZD manual branch `:1031-1037` (the brief said 1014-1030 / 1032-1037 — one line out). Call sites `:1310` / `:1356` and the max-rule expression `:1424` are exact.

### 2. Consumer inventory — every reader of the manual combined figure

Grepped both repos for `manualDecorationPerUnit`, `manualDecorationBrackets`, `catalogue_item_decoration_price(_for_currency|_bulk)`, `claimed_manual_decoration`, `isCombinedManualLine`, `manualByQty`, `decoration_unit_price`.

| Consumer | Needs the pooled band qty? | Action |
|---|---|---|
| `ProductDetailClient.tsx` snapshot (`:1179-1212`, written at `:1272/1344/1396`) | No — the PDP has no cross-product visibility (spec §8). It snapshots at its own qty; the **cart** re-picks the ladder at the pooled band, exactly as it already does for the garment. | **Changed** (price-mode only) |
| `app/(portal)/catalogue/[productId]/page.tsx:230-267` first-paint seed | No — same reason. | Unchanged |
| `app/api/shop/decoration-pricing/route.ts` `manualByQty` | No — returns a figure for **every** qty the client asks for. Verified it covers the whole probe set. | Unchanged |
| `lib/cart/types.ts` `recomputeProductTierPrices` | **Yes** | **Changed** |
| `lib/cart/types.ts` `decorationPerUnit` (`:188`) | Price-mode agnostic — the single fold point every display consumer goes through (`CartTable`, `CartDrawer`, `CheckoutClient`, `CheckoutReviewClient`, `ShipToRow`, `PriceBreakdown`, `order-picking-fee`). | Unchanged |
| `CheckoutReviewClient.tsx:362`, `useCheckoutPreview.ts:82` (`claimed_manual_decoration`) | Pass-through of `manualDecorationPerUnit`. | Unchanged |
| `lib/checkout/prepare.ts` `manualPairs` + `applyManualDecorationForLine` | **Yes** | **Changed** |
| `lib/shop/catalogue-decoration-prices.ts` (catalogue grid overlay) | No — a browse-price range at floor/entry qty with no cart context. Already price-mode keyed. | Unchanged |
| `db/perf-debt/D1_catalogue_decoration_prices_bulk.sql` | Batched form of the scalar RPC; qty comes from the caller. | Unchanged |
| `lib/reorder/rebuild.ts` | Deliberately omits brackets and manual figures, so a rebuilt line acts as a legacy line → `claimed_manual_decoration` null → the server silently re-prices at the pooled band. | Unchanged |
| `scripts/perf/checkout-fanout-harness.ts` | Sends `claimed_manual_decoration: -1` on purpose (guaranteed drift). | Unchanged |
| Staff `src/app/api/catalogues/.../tiers/**` | Authoring/seed paths for `decoration_unit_price`, not pricing. | Unchanged |
| Staff `src/lib/orders/quote-line-pooling.ts` | **No change needed** — returns a garment price only and already computes exactly this max-rule quantity. Documented in place. |
| Staff `amendment_decoration_unit_price_for_currency` + `plan_order_amendment` | **Yes** | **Changed** (migration `20260826120000`) |

### 3. The drift guards — exactly what is compared

Three guards sit on this path. Only the first two can fire for a manual line.

1. **`applyManualDecorationForLine` (`prepare.ts:1182`)** — `claimed = round2(line.claimed_manual_decoration)` vs `server = round2(catalogue_item_decoration_price(item, decorationQty))`. **Exact equality at 2dp, zero tolerance.** Mismatch pushes a `price_drift` entry named `Decoration (combined)` pointing at the first validated placement; `DecorationDriftError` throws at `:1399`. A **null** claim (legacy cart, reorder rebuild, unresolved PDP fetch) skips the comparison and silently re-prices. `claimed_manual_decoration` is populated from `manualDecorationPerUnit` in both `CheckoutReviewClient.tsx:362` and `useCheckoutPreview.ts:82`, so **the cart's re-pick quantity and the server's lookup quantity must be the same function**. That is the whole reason the three customer surfaces ship in one commit.
2. **`reviewed_decoration_price` (`prepare.ts:1421`)** — under SP3 only, `round2(reviewed)` vs `round2(perUnit)` where `perUnit` is the server's folded decoration. Throws at `:1442`.
3. **`UnitPriceDriftError` (`prepare.ts:855`)** — garment only; untouched.

Per-placement drift is **not** evaluated on a manual line: the loop pushes `unitPrice: 0` metadata and `continue`s before the comparison (`prepare.ts:1300-1327`). So the extra placements cannot generate a 409 either way.

### 4. "Four surfaces" — attempt to falsify

Checked reorder rebuild, ordering-period pricing, `quote_items` snapshot replay, the catalogue grid overlay, the staff quote-line endpoint, and the bulk RPCs.

**No fifth pricing surface exists.** Details:
- **Reorder rebuild** deliberately produces legacy-shaped lines → server re-prices, no claim, no drift.
- **Ordering-period pricing** overrides the **garment** price only (`prepare.ts:660-700`); its §5 exclusion from pooling was never wired to decoration, before or after this change.
- **`quote_items` replay** stores one folded `unit_price` plus a `decorations` jsonb; nothing re-derives price from it.
- **Catalogue grid overlay** is a browse-price range, already price-mode keyed.
- **Staff quote-line** returns a garment price only — the route contains no decoration pricing at all.
- **Bulk RPCs** are batched forms of the same scalar functions.

### 5. Customer-side schema — none needed

`catalogue_item_decoration_price(item, qty)` and `catalogue_item_decoration_price_for_currency(item, qty, ccy)` already exist and already read the item's per-band figure. Confirmed from `pg_get_functiondef`, and confirmed that `_for_currency` **delegates to** the legacy NZD function when the currency is `NZD` — which is why the new amendment branch is one call, not a currency split. The only DB work is the amendment function.

### 6. Readiness invariants vs `manual_final`

`enforce_catalogue_pooling_readiness`, `enforce_pooling_attachment_readiness`, `enforce_decoration_ladder_shape` and `replace_org_decoration_pricing_tiers` all demand an `org_decoration_pricing_tiers` ladder for **every** real decoration attached to an enabled pooled catalogue, regardless of the item's `price_mode`. Under the new rule a `manual_final` item does not consume that ladder.

Live check (read-only):
- Decorations attached to **both** a manual and a computed item **within one catalogue**: **zero today**.
- Catalogues mixing manual and computed items: **three** — Hydro Surf 19/6/2026 (20 manual / 1 computed), test catalogue (2/4), WHITEFOX Products (2/3). All pooling-off.

So the structure permits a decoration to serve both modes even though nothing does yet, and an AM could create one at any time by attaching an existing decoration to a computed item. A per-decoration relaxation would therefore need to test *every* item the decoration is attached to in that catalogue, and re-test on every attachment change — three triggers' worth of new logic to remove a requirement that costs nothing but a few rows. See Decision 4.

### 7. Live data (Print Room Demo, catalogue `4d21bd07-b5f8-4b9a-a71f-fe3e40b51bb6`)

The **only** catalogue in the system with `decoration_pooling_enabled = true`. Four items, **all four `manual_final`**, zero computed. Blast radius outside the demo store is zero.

Two brief figures needed correcting against the database:

| | qty 1 | 24 | 50 | 100 | 250 | 600 |
|---|---|---|---|---|---|---|
| Everyday Pullover Hoodie combined `decoration_unit_price` | 8.00 | 6.50 | 5.00 | **4.00** | 3.50 | 3.50 |
| `Screen print — Left Chest` per-decoration ladder | 10.00 | **10.00** | 6.50 | 5.00 | 5.00 | 5.00 |

The brief listed the item figure at qty 100 as 3.50 (that band starts at 250) and the ladder at qty 24 as 6.50 (band 1–24 is 10.00). Bands are `1-24 / 25-49 / 50-99 / 100+` for the ladder and `1-23 / 24-49 / 50-99 / 100-249 / 250-499` for the item — note the item ladder has **no open-ended tail**, so `catalogue_item_decoration_price` clamps qty 600 to the 250 band. Both the SQL function and the cart's `manualDecorationBrackets` reproduce that clamp (`buildManualDecorationBrackets` opens the tail).

### 7b. The change as money

Everyday Pullover Hoodie, on the pooled demo catalogue, carrying `Screen print — Left Chest`. **Decoration per garment**, ex-GST; the garment half does not move.

| Pooled band qty | Before (per-decoration ladder × 0.95) | After (item's own combined figure) | Delta |
|---|---|---|---|
| 1 | $9.50 | **$8.00** | −$1.50 |
| 24 | $9.50 | **$6.50** | −$3.00 |
| 50 | $6.17 | **$5.00** | −$1.17 |
| 100 | $4.75 | **$4.00** | −$0.75 |
| 600 (e.g. + a 500-tee sibling) | $4.75 | **$3.50** | −$1.25 |

Two things move at once, and both are the point. The **source** changes from `Screen print — Left Chest`'s ladder (`10.00 / 10.00 / 6.50 / 5.00 / 5.00` at those quantities) to the hoodie's own `decoration_unit_price` (`8.00 / 6.50 / 5.00 / 4.00 / 3.50`). And the **tier multiplier drops out**: Print Room Demo is on Tier 1 (×0.95), which `effectiveDecorationPrice` applies to computed decorations but which `catalogue_item_decoration_price` deliberately does not — a `manual_final` figure is the final typed price, already net of whatever the AM decided. Both were true of non-pooled manual items all along; pooling had been the only thing making a manual item behave otherwise.

### 7c. The tier multiplier does not apply — verified, and it never should have

`manual_final` means "the figure the AM typed is final". The **garment** half has enforced that since long before pooling: both `effective_unit_price_for_item` and `effective_unit_price_for_item_currency` contain, verbatim,

```sql
  select price_mode into v_price_mode from public.b2b_catalogue_items where id = p_catalogue_item_id;
  if v_price_mode = 'manual_final' then
    v_effective_mult := 1.0;
  end if;
```

Confirmed empirically on Print Room Demo (Tier 1, ×0.95) — the hoodie's billed garment price equals the authored figure exactly at every band, not the discounted one:

| qty | authored | `effective_unit_price_for_item` | ×0.95 would be |
|---|---|---|---|
| 24 | 70.28 | **70.28** | 66.77 |
| 50 | 61.08 | **61.08** | 58.03 |
| 100 | 53.89 | **53.89** | 51.20 |

The decoration half now behaves the same way. Traced on all six readers:

| Reader | Multiplier on a manual line? |
|---|---|
| `app/api/shop/decoration-pricing/route.ts` | No — `tierMult` is a parameter of `priceLink` (the computed path) only; `resolveManualCombined` never receives it |
| `app/(portal)/catalogue/[productId]/page.tsx` seed | No — direct RPC |
| `lib/cart/types.ts` | No — re-picks a bracket from the snapshotted ladder; no arithmetic |
| `lib/checkout/prepare.ts` | No — `manualPriceByPair` stores the RPC value raw. `tierMultiplier` reaches only the two `effectiveDecorationPrice` calls, and is not even loaded when `computedPairs.size === 0` |
| `lib/shop/catalogue-decoration-prices.ts` | No — `computeBand` is the sole multiplier site; `manualPriceById` reads raw |
| `amendment_decoration_unit_price_for_currency` | No — calls `catalogue_item_decoration_price_for_currency` directly |

And none of the four SQL price functions reads `customer_pricing_tiers` at all (`catalogue_item_decoration_price`, `..._for_currency`, `effective_decoration_unit_price`, `..._for_currency` — all verified against `pg_get_functiondef`). The ×tier on computed decorations is applied by the **caller**, in TypeScript.

**So the ×0.95 in the "before" column above was the anomaly, not the "after".** Routing pooled manual lines onto the computed decoration path was the only place in the system where a tier discount touched a `manual_final` item's price at all — its garment half was immune, its decoration half was not, on the same line. That is a second, independent argument for this change, found while checking the money.

**Incidental finding, out of scope:** the amendment RPC does not apply the tier multiplier to **computed** decorations either, while the customer checkout does (`effectiveDecorationPrice` multiplies; the NZD amendment branch returns `coalesce(effective_decoration_unit_price(...), override, static)` unmultiplied). That divergence predates this work, affects computed items only, and is untouched here — but it means a staff amendment of a computed-decoration order can re-price a line upward by 1/0.95. Worth a separate look.

The band boundaries also move back to the item's own: at qty 24 the ladder is still in its `1-24` band while the item ladder has already stepped to `24-49`, which is the single biggest gap in the table.

Also live and load-bearing:
- `Faded Wash Trucker Cap` and `Recycled Weekender Duffel` have `decoration_unit_price = NULL` in **every** band → the NULL case of Decision 5 is real in this catalogue today.
- On the hoodie, **both** links have `sort_order = 0`, so ordering by `(sort_order, id)` makes the `$0 Custom decoration` placeholder (`2e20148d…`) the "first" link, ahead of the real screen print (`a7ebfac4…`). This is what made the `p_is_first` defect in the amendment RPC a live risk rather than a theoretical one.

### 8. Pre-existing issues found (both fixed here)

1. **The NZD/non-NZD split in `amendment_decoration_unit_price_for_currency` is real.** For a pooled `manual_final` line, NZD priced per-placement (its branch never consulted `p_price_mode`), while non-NZD priced the combined figure at the **un-pooled** `p_qty`. **Resolved**, not preserved.
2. **`p_is_first` was anchored to the wrong set.** It resolved to the item's first published link, but the existing-line branch prices only the links present in `v_existing.decorations`. When those do not include the item's first link — the normal case on the demo hoodie, whose first link is the `$0` placeholder — **no** placement is "first" and the line is billed **zero** decoration. Latent while only non-NZD manual lines took that branch; extending the manual rule to NZD would have made it live. **Fixed** by requiring the first link to be on the line.

### 9. Known transition edge (not a blocker, documented deliberately)

A cart line snapshotted **before** this change on the pooled demo catalogue carries `manualDecorationPerUnit: null` plus real per-placement prices and ladders. After deploy, that line still *displays* the per-placement sum while the server bills the combined figure. It is **not** a drift block — the claim is null, so the server silently re-prices — and under SP3 the checkout review shows the server figure. The direction is customer-favourable (displayed ≥ charged: hoodie at qty 24 displays 10.00, is charged 6.50). It self-heals as soon as the line is re-added. Clearing the demo cart before the demo is the simplest mitigation.

---

## Decisions

### 1. Which quantity does the manual combined figure band-select at?

**The max-rule band quantity** (`garmentBandQty`), exposed as `manualCombinedBandQty` in `lib/pricing/decoration-pooling.ts`.

A `manual_final` line is **one** all-in price, so its decoration half must move with the band its garment half moves with — a blended figure has no meaningful per-decoration quantity. The helper delegates to `garmentBandQty` rather than restating the rule, so there is exactly one implementation.

The `ownGroupQty` floor stays **each caller's existing pre-pooling aggregate**: the cart's `productId::decorationSignature` total, and checkout's `totalQtyByDecorationTierKey` (`tierAggregationKey`). Those two are the same key, which is what makes cart and server agree. Checkout's *garment* aggregate is keyed on `catalogueItemId` instead, so it can differ from the decoration aggregate when two catalogue items share a source product — that difference is pre-existing and deliberately left alone. Keeping each half floored at its own aggregate is also what makes flag-off parity byte-identical by construction: with no pools, `manualCombinedBandQty` returns `ownGroupQty` unchanged.

All four surfaces implement the same expression. In SQL it is `greatest(v_group_qty, coalesce(v_max_pool_qty, 0))` — literally the expression the garment band already used, now computed once before the decoration build and read by both.

### 2. What happens to the per-decoration `unitPrice` snapshot on a pooled manual line?

**It stays `0`, with no `brackets`** — the safety property is preserved and now extends to pooled manual lines.

`manualDecorationActive` becomes price-mode-only, which means a pooled manual PDP writes `unitPrice: 0` and omits `brackets` exactly as a non-pooled one always has. An accidental fallback to the per-placement sum then yields `0`, never a wrong positive number. Checkout matches: the manual branch pushes `unitPrice: 0` metadata and skips per-placement pricing and drift entirely.

### 3. The "Same artwork savings" pill (§8)

**Still truthful, and now more so.**

- `poolSizesForLine` still rides `pooledQty` onto each decoration for display; that path is independent of price and unchanged.
- `sameArtworkSavings` names the band from `pickBracket(line.brackets, pooledQty)` — the garment ladder. Under the new rule the manual line's garment band **and** its combined decoration band are the same quantity, so the stated band is now correct for both halves. Previously it was correct for the garment half only.
- **No per-placement money leaks into the UI.** The placements carry `unitPrice: 0` and no ladder, `decorationPerUnit()` returns the combined figure, and nothing in `components/cart/` or `components/checkout/` renders a per-decoration price.
- One small correctness fix: `nextArtworkBand` now also measures `line.manualDecorationBrackets`. A manual item's decoration ladder shares band boundaries with its garment ladder but not its *price changes* — live, the demo hoodie is `70.28` flat from qty 1–49 while its decoration drops `8.00 → 6.50` at 24. Without this the nudge would say "add 30 more" when the real next break is 4 away. Flag-gated by construction: `nextArtworkBand` returns null unless a `pooledQty` is present, which only pooled lines have.

### 4. The readiness gate

**Left as-is for v1**, deliberately.

It over-demands an `org_decoration_pricing_tiers` ladder for decorations that only ever appear on `manual_final` items. That is conservative and harmless: authoring a ladder that nothing reads costs a few rows and no money, and it keeps the catalogue ready if an AM later flips an item to computed. Relaxing it is not a per-decoration test (see finding 6) — mixed-mode catalogues already exist, so a decoration can legitimately need a ladder for one item and not another *in the same catalogue*, and all three triggers plus `replace_org_decoration_pricing_tiers` would have to agree on that. Not worth it to remove a requirement whose only cost is data entry.

### 5. NULL bands

**A `manual_final` item with no decoration figure at the selected band yields `0`, and that stays distinct from the `$0` placeholder path.**

- Customer checkout: `manualPriceByPair` coerces a null RPC result to `0` (`prepare.ts:1136`), unchanged.
- Amendments, NZD: the function returns the raw NULL, and `plan_order_amendment`'s `sum((d->>'unitPrice')::numeric * qty)` skips NULLs — so the line's decoration total is `0`. Same outcome, existing mechanism.
- Amendments, non-NZD: NULL trips the existing `country_price_unavailable` guard. An exact-currency quote may never silently invent a price. Also existing behaviour.
- The `$0`/`custom` placeholder is a **separate, structural** path: `pooled_decoration_qty` excludes it (`artwork_id is not null and decoration_method <> 'custom'`), `poolable` is false on the client, and the flat-`$0`-in-any-currency fix from `0a4d686` is untouched. `ProductDetailClient.country-pricing-pending.test.tsx` and `app/api/shop/decoration-pricing/__tests__/route.test.ts` both stayed green unmodified.

---

## What changed

### Customer repo — one commit, three surfaces (`fix/pooled-manual-own-decoration-ladder`)

They are inseparable: a half-deploy makes the cart's claim and the server's re-derivation disagree, and the zero-tolerance drift guard turns that into a 409 no customer can clear.

- `lib/pricing/decoration-pooling.ts` — `manualCombinedBandQty`, delegating to `garmentBandQty`; module header now states three rules.
- `lib/checkout/prepare.ts` — `isCombinedManualLine` stops excluding pooled lines (`isPooledLine` removed, now unused); new `manualDecorationBandQtyForLine` feeds `manualPairs` and both `applyManualDecorationForLine` call sites; the block comment now argues for the rule that exists.
- `lib/cart/types.ts` — stop clearing `manualDecorationPerUnit`; `pickBracket(l.manualDecorationBrackets, manualBandQty)`.
- `components/shop/ProductDetailClient.tsx` — `manualDecorationActive = isManualPricing`; `poolingActive` now drives the static §8 note only.
- `lib/pricing/same-artwork-savings.ts` — Decision 3's nudge fix.

### Staff repo — same branch name

- `supabase/migrations/20260826120000_pooled_manual_decoration_own_ladder.sql` — **authored, NOT pushed.**
- `src/components/catalogues/sections/PricingSection.tsx` — the amber note is now mode-aware.
- `src/lib/orders/quote-line-pooling.ts` — comment only; no behaviour change needed.

---

## Applying the migration

`supabase db push` is a human-in-the-loop step. **Never** apply this via the Supabase dashboard or the MCP `apply_migration` tool.

```bash
cd ~/Documents/print-room-staff-portal
supabase db push
```

It is idempotent and re-runnable: one `drop function if exists` for the changed 10-argument signature, then `create or replace` for both functions.

**Order matters.** Deploy the **customer** repo first or simultaneously; the amendment RPC is a staff-side re-price and is not compared against the cart, so it cannot block a checkout either way — but until it is pushed, a staff amendment of a pooled manual order will still price NZD lines per-placement.

### Verification after pushing

```sql
-- Should be 11 arguments, with p_band_qty fifth.
select pg_get_function_identity_arguments(p.oid)
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname = 'amendment_decoration_unit_price_for_currency';

-- The hoodie's own combined figure at the pooled band. Expect 3.50 at 600.
select public.catalogue_item_decoration_price(
  '9c565135-c69c-484d-9d49-57d163e3045a', 600);
```

Then a browser pass on the demo store: add 500 Demo Store Tee + 100 Everyday Pullover Hoodie with the shared left-chest print, confirm both lines show the 600-band decoration from their own ladders, and complete checkout without a drift error.

---

## Verification run (2026-08-26)

| Gate | Baseline | After | Verdict |
|---|---|---|---|
| Customer `npm test` | 3 files / 5 tests failed, 1692 passed | 3 files / 5 tests failed, **1711 passed** | Same 3 pre-existing files (`OrdersTable.test.tsx`, `TeamClient.branch.test.tsx`, `CartProvider.test.tsx`); +19 new tests |
| Customer `npx tsc --noEmit` | 14 errors, 2 files | **14 errors, same 2 files** | `lib/__tests__/next-config-redirects.test.ts` (1), `lib/email/__tests__/tracker-notification.test.ts` (13) |
| Customer `npm run lint` | 200 problems (0 errors) | **200 problems (0 errors)** | Identical; confirmed by `git stash` |
| Customer `lib/cart/flag-off-parity.test.ts` | green | **green, file unmodified** | Flag-off parity intact |
| Staff `npm test` | 2 files / 5 tests failed, 3324 passed | 2 files / 5 tests failed, **3339 passed** | Same pre-existing `localStorage` failures; +15 new tests |
| Staff `npx tsc --noEmit` | 0 errors | **0 errors** | |
| Staff `npm run lint` | 9507 problems (1279 errors) | **9507 problems (1279 errors)** | Identical; all from `.worktrees/`. `npx eslint` on the four changed files: clean |
| Migration SQL | — | **compiles + 10/10 branch cases pass** | Throwaway local Postgres container (`public.ecr.aws/supabase/postgres:17.4.1.048`), never the shared project |

**Correction to the brief's known-failing list:** the staff baseline is **5** failures across **2** files, not 4 across 1. `src/components/layout/Sidebar.test.tsx` fails alongside `swatch-edit-hint.test.ts` with the same `localStorage is undefined` cause. Both pre-existing on a clean tree.

The migration was verified by compiling both functions in a disposable local Postgres container (with stub tables for the `%ROWTYPE` declarations) and running a 10-case branch matrix over `amendment_decoration_unit_price_for_currency` with stubbed price sources: pooled manual × {NZD, AUD} × {first, not-first}, pooled computed × {NZD, AUD}, and all four non-pooled combinations asserted byte-identical to `20260824140000`. All 10 passed. The shared Supabase project was only ever read from.

## Blockers found

None. The most likely candidate — a catalogue mixing `manual_final` and `computed` items where one `org_decorations` row must price two ways in one order — was checked against live data and is **structurally fine**: the two modes read different price sources (`catalogue_item_decoration_price` vs `effective_decoration_unit_price`) but the **same** pool, so a shared decoration simply contributes quantity to both and each line prices its own way. Nothing forces one row to yield one price. Three mixed-mode catalogues exist today; none currently shares a decoration across the modes; all have pooling off.
