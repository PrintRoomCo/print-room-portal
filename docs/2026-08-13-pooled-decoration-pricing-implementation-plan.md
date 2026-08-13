# Pooled Decoration Pricing — Implementation Plan

**Date:** 2026-08-13
**Spec:** `docs/2026-08-13-pooled-decoration-pricing.md` (agreed 2026-08-13; this plan implements it)
**Repos:** `print-room-portal` (customer), `print-room-staff-portal` (staff + shared-DB migrations)
**Status:** Plan — nothing built.

---

## 0. Guiding constraints (read first)

1. **The drift-guard seam is non-incremental.** `lib/checkout/submit.ts` re-derives every price and 409s on mismatch (`UnitPriceDriftError` at :895, `DecorationDriftError` at :1271, manual-final drift inside `applyManualDecorationForLine` :1092-1121 — the `catalogue_item_decoration_price` batch it compares against is resolved separately at :1067-1073). Cart recompute (`lib/cart/types.ts recomputeProductTierPrices`) and server aggregation must change **in the same deploy**, and the amendment RPC + staff quote-line endpoint in the same release window.
2. **Everything new is gated by a per-catalogue flag** (`b2b_catalogues.decoration_pooling_enabled`, default `false`). With the flag off, every code path must produce byte-identical prices to today. This is what makes the release safe to ship dark and lets the placeholder-polluted catalogues (MTF ×28, AF ×15, Trades Services ×12, Reburger ×7 attached to the $0 `custom` placeholder) stay quarantined.
3. **Migration protocol (staff repo):** every schema change is a file in `supabase/migrations/`, applied with `supabase db push` — never via dashboard or MCP `apply_migration` (AGENTS.md). Naming is `<timestamp>_<name>.sql` per CONTRIBUTING.md:11. Anything staged-but-held goes in `db/pending-migrations/` (existing pattern, see its README).
4. **One chokepoint for decoration price.** `effective_decoration_unit_price(p_org_decoration_id, p_qty)` (baseline :3282) is called by checkout (`lib/checkout/decoration-effective-price.ts:56`), the PDP live re-price (`app/api/shop/decoration-pricing/route.ts:117`), the catalogue-grid overlay (`lib/shop/catalogue-decoration-prices.ts:70/:89`, via `effective_decoration_unit_prices_bulk`, which calls the scalar row-by-row), `plan_order_amendment` (0807 file :342/:360), and the manual-final tier-seed route (`tiers/seed/route.ts:123`). Teaching *it* to read the new ladder first means all of those inherit ladder pricing with no per-caller work. Do not build a parallel price function. Two facts the implementation must respect:
   - The function has **no flat-price fallback inside it** — it returns NULL for heatpress/supacolour/dtf/custom and callers coalesce to `unit_price_override` / `org_decorations.unit_price` (its own COMMENT, baseline :3346). A new ladder therefore also starts pricing methods that today fall through to the flat price, and it changes what wins against `unit_price_override` (see 1a checklist item (d) and the 2d precedence fix).
   - Known consumers that do NOT route through it, each handled elsewhere in this plan: PDP first-paint static price (`lib/shop/decorations.ts:216-221` — fixed in 2b), staff `PricingSection.tsx:116` computed-mode preview (display-only), staff `/api/pricing/decoration-quote` (pre-creation preview; no `org_decoration_id` exists yet, so a ladder can't apply), the manual-final combined price via `catalogue_item_decoration_price` (retired for pooled items in 2c), and the ordering-period system (`recompute_period_pricing` reads its own frozen `b2b_ordering_period_item_pricing.decoration_unit_price` — spec-excluded, untouched).

---

## Phase 0 — Schema foundation (staff repo, ships dark)

**Migration `20260814TTTTTT_org_decoration_pricing_tiers.sql`:**

```sql
create table public.org_decoration_pricing_tiers (
  id uuid primary key default gen_random_uuid(),
  org_decoration_id uuid not null references public.org_decorations(id) on delete cascade,
  min_quantity integer not null check (min_quantity > 0),
  max_quantity integer check (max_quantity is null or max_quantity >= min_quantity),
  unit_price numeric(10,2) not null check (unit_price >= 0),
  created_at timestamptz not null default now(),
  unique (org_decoration_id, min_quantity)
);
-- RLS: enable; staff-only policy per the auth-hardening template
-- (b2b_member_store_grants_staff, 20260812110000:95-97):
--   FOR ALL TO authenticated USING (auth_is_staff()) WITH CHECK (auth_is_staff())
-- Customer portal reads only through server routes (service role), so no anon/customer grant.

alter table public.b2b_catalogues
  add column decoration_pooling_enabled boolean not null default false;
```

Same migration also creates `replace_org_decoration_pricing_tiers(p_org_decoration_id uuid, p_tiers jsonb)` — an atomic delete+insert swap cloned from `replace_b2b_catalogue_item_base_cost_tiers` (baseline :5920-5946; its route pairing is `.../items/[itemId]/base-cost-tiers/route.ts:75-90`). The 1a ladder route writes through this, never sequential delete/insert.

Follow the Phase-1 RLS conventions from the auth-hardening epic (no `USING (true)`, no anon exposure; helpers `auth_is_staff()` / `auth_user_in_org()`) and run `get_advisors` after applying.

**Same migration, `CREATE OR REPLACE effective_decoration_unit_price`:** prepend a ladder lookup —

```sql
select unit_price into v_ladder
  from org_decoration_pricing_tiers
 where org_decoration_id = p_org_decoration_id
   and min_quantity <= p_qty
   and (max_quantity is null or p_qty <= max_quantity)
 order by min_quantity desc limit 1;
if found then return v_ladder; end if;
-- (clamp: if ladders exist but p_qty is below the lowest band, use the lowest band —
--  mirrors catalogue_item_decoration_price's clamp behaviour)
-- ...then the existing screenprint/embroidery engine logic unchanged...
```

**Why this is safe dark:** no ladder rows exist until Phase 1 authoring/backfill, so the `if found` branch never fires; the flag defaults false so no app code path changes. Deployable immediately, independently of everything else. One deliberate consequence to hold onto: once a ladder exists it wins for **every** method — including heatpress/supacolour/dtf/custom, where the function currently returns NULL and callers fall back to the flat price. Never author ladders on `custom`/null-artwork placeholder decorations (the 1a editor refuses them; eligibility excludes them from pooling regardless).

**Also in Phase 0:** thread `decoration_pooling_enabled` and the catalogue id into the customer PDP. The live loader is `lib/shop/resolve-catalogue-item.ts:36` — its select already joins `b2b_catalogues!inner(organization_id, is_active)`; add `id, decoration_pooling_enabled` there and thread through the PDP page's `product` payload (`app/(portal)/catalogue/[productId]/page.tsx` ~:566-604, which already threads item-level fields like `catalogueItemId`/`priceMode`; this is the first catalogue-level field exposed, but the plumbing is identical). Note `app/api/shop/products/[id]/route.ts` also joins `b2b_catalogues!inner` (:21) but has no callers — only its `/availability` sub-route is fetched (`CartTable.tsx:72`); don't touch it. Cart line snapshot: `CartLine` gains `catalogueId?` and `poolingEnabled?`; `CartLineDecoration` gains `poolable: boolean` = server-computed `artwork_id is not null && decoration_method !== 'custom'`, computed inside `loadCatalogueItemDecorations` where the joined artwork object and `decoration_method` are already in scope (`lib/shop/decorations.ts:213/:252`). No name collisions (verified repo-wide: `poolingEnabled`/`poolable` zero hits; `catalogueId` only a local in `lib/shop/member-access.ts`). Snapshot-at-add-time is the existing cart pattern (brackets are already snapshotted), so no new fetch paths. Old persisted carts without the new fields simply never pool — correct degradation.

**Estimate:** 1–2 days including RLS review and advisor pass.

---

## Phase 1 — Staff authoring + backfill (staff repo, still dark)

### 1a. Ladder editor in the org decoration library

- API: `GET/PUT /api/orgs/[orgId]/decorations/[decorationId]/tiers` (net-new — no tiers sub-route exists under the org decorations routes today; `org_decorations` has only a flat `unit_price`) — modelled on the item-tiers route (`src/app/api/catalogues/[id]/items/[itemId]/tiers/route.ts` PUT :81-156, delete-then-insert) **but with three fixes the old route deliberately lacks**:
  - structural validation in a new pure resolver (sibling of `resolve-pricing-tier-writes.ts`, whose doc comment at :12-14 explicitly disclaims structural rules): bands sorted, non-overlapping, contiguous or explicitly gapped-to-clamp, first `min_quantity >= 1`, at most one open tail (`max_quantity is null` only on the last row);
  - writes go through the Phase-0 `replace_org_decoration_pricing_tiers` RPC — atomic, so a mid-write failure can't leave a decoration with zero bands. Copy `base-cost-tiers/route.ts:75-90` (RPC call + prior-rows SELECT for the audit diff); the sibling garment-tiers route's sequential delete/insert is the anti-pattern;
  - the route refuses ladders on `custom`-method or null-`artwork_id` decorations (placeholders never pool and must never acquire a ladder).
- Audit: the item-tiers route fires `recordAuditEvent` (`AUDIT_ACTIONS.PRICING_TIER_CHANGE`, `tiers/route.ts:60-76/:137-153`) but the existing decoration routes fire **none** — a gap, not a pattern to copy. The new ladder route records an audit event on every PUT.
- UI: extend `DecorationFormDialog.tsx` / the org decorations page (`src/app/(portal)/b2b-accounts/[orgId]/decorations/`) with a ladder table (From/To/Unit price), reusing `PricingSection.tsx`'s row-editing interaction. The dialog already embeds the read-only `DecorationPricingTierTable` (screenprint tier display, `DecorationFormDialog.tsx:673`) — reuse it as the display primitive; the editable rows are net-new. This is the seed of the merged Artwork+Decorations feature; full UI merge can trail the pricing engine — the load-bearing part is that the ladder is authored **on the decoration**, once.
- `PricingSection.tsx` (catalogue item): when the item's catalogue has pooling enabled, render the Decoration column read-only ("priced by decoration ladder") instead of an input; unchanged otherwise.
- Catalogue settings: the `decoration_pooling_enabled` toggle, with a pre-activation checklist rendered live: (a) every attached non-placeholder decoration has a ladder; (b) list of attached `$0`/`custom` placeholder links (must be zero or acknowledged as never-pooling); (c) manual_final items whose band `decoration_unit_price` will be superseded; (d) links with `unit_price_override` set on poolable decorations — a ladder supersedes the override at checkout (RPC-first fallback chain, `decoration-effective-price.ts:61-69`), so each must be folded into the ladder or acknowledged.

### 1b. Backfill tooling

- Script (staff repo `scripts/`, service-role, same pattern as prior backfills): for each `org_decoration` attached to ≥1 `manual_final` item with band `decoration_unit_price` values, propose a ladder = the donor items' bands; where donors disagree (they do — e.g. AF Relax Socks 0.93/0.70/9.00 vs Stencil Hood 22.50/2.62/5.74/7.50) emit a CSV report per org for AM resolution instead of writing anything.
- AM resolves → ladder entered through the 1a editor (one write path, one audit trail — the 1a route's; no audit exists on decoration writes today). No bulk silent writes.

**Estimate:** 3–4 days. Ships independently; still zero pricing behaviour change until a catalogue's flag flips (and `effective_decoration_unit_price` only consults ladders where AMs created them — for non-pooled catalogues that's already the intended "single source of truth" behaviour from the spec, but note it means **a signed-off ladder starts pricing that decoration everywhere immediately**; that is by design, sign-off is the gate).

---

## Phase 2 — Pricing engine (both repos, the lockstep release)

This is the only phase where sequencing inside the release matters. Everything is flag-gated, so it can merge and deploy dark, but cart/server/RPC must ride together.

### 2a. Shared pooling module (customer repo, new file `lib/pricing/decoration-pooling.ts`)

One pure module used by both cart and checkout so the mirror-comment contract ("keep them in step", types.ts:172-180 / submit.ts:473-484) becomes shared code instead of a comment:

```ts
// Inputs: lines as {catalogueId, catalogueItemId, productId, qty,
//   fulfilmentType, decorations: {decorationId, poolable}[]}, + poolingEnabled per catalogue.
// pooledQtyByDecoration(lines): Map<decorationId, qty>
//   — sums qty of non-'stocked' lines per poolable decorationId, within one catalogue.
//   Prepaid lines contribute (spec §5). 'stocked' lines are excluded entirely.
// garmentBandQty(line, pools, ownGroupQty): number
//   — max(ownGroupQty, max(pools.get(d.decorationId) ?? 0 for poolable d)) ; max rule, never below own qty.
```

Field-shape note: cart lines carry `fulfilmentType`/`catalogueItemId` camelCase; checkout input lines carry snake_case `fulfilment_type`/`product_id` but camelCase `catalogueItemId` (`submit.ts:80-86`, "camelCase to match the cart line"). The module takes one normalized line shape and each caller adapts, so the key logic exists exactly once.

Unit tests here carry the worked examples from the spec verbatim (500/100 identical set; tee/hood/cap max-rule case; cap must NOT inherit 600 — the anti-transitivity assertion).

### 2b. Cart (`lib/cart/types.ts`)

`recomputeProductTierPrices` (:247): keep the existing `${productId}::${decorationSignature}` path as-is for lines whose `poolingEnabled` is falsy. Recompute already runs on every mutation/hydration path — hydrate, add/merge, update, remove (`CartProvider.tsx:91/:228/:237/:241`, the only production call sites) — so cross-line pooling cannot go stale on a path the per-product version tolerated (verified). For pooled lines:

- decoration price per placement: `pickBracket(d.brackets, pooledQtyByDecoration.get(d.decorationId))` — `decorations[].brackets` already exists on the line. Today it is **probe-derived**: the PDP client probes `/api/shop/decoration-pricing` (→ the RPC) at fixed breakpoints + current qty + garment band minimums and collapses the points (`ProductDetailClient.tsx:709-718`, `buildDecorationBrackets` :969-991). That works today because engine band edges align with the probe set — but a pooled qty can land between probes, and a ladder band edge the probe missed means cart picks one price, server RPC another → drift 409. So for laddered decorations, snapshot the ladder's **exact bands** as `brackets` (shipped alongside `poolable` from the server) instead of probe output. Computed screenprint (no ladder) keeps probe-derived brackets; its band edges are the probe breakpoints.
- garment price: `pickBracket(l.brackets, garmentBandQty(...))` where `ownGroupQty` is today's product-level sum.
- manual_final pooled items: **stop using** `manualDecorationBrackets`/`manualDecorationPerUnit`; decoration cost = Σ per-decoration ladder picks. (Non-pooled manual items keep the combined figure — that's the flag-off identical-behaviour guarantee.)
- stocked lines: leave their existing behaviour completely alone. They are **not** skipped from today's per-product aggregation — `lib/cart/__tests__/types.test.ts:267-275` pins that stocked + made_to_order lines pool into one tier key, and their flat price survives any qty via the synthesized single-band bracket (`ProductDetailClient.tsx:1055-1059`; server-side override is `stock_unit_price` in `garmentUnitPriceForLine`, `submit.ts:253-263` — there is no `stockUnitPriceByItem` symbol). Skipping them would break flag-off byte-parity. Under pooling they are excluded from **decoration pools** (spec §5) and never receive a max-rule band; assert both directions.
- PDP first-paint decoration price (`lib/shop/decorations.ts:216-221`) is a static `unit_price_override`/`unit_price` coalesce that bypasses the RPC — the one customer display source that would not show ladder prices (the debounced `/api/shop/decoration-pricing` recalc and the catalogue-grid overlay both route through the chokepoint). Make `loadCatalogueItemDecorations` ladder-aware in this release so first paint matches what checkout charges.

### 2c. Checkout server (`lib/checkout/submit.ts`)

- Fetch `decoration_pooling_enabled` once per checkout by extending the existing once-per-checkout `b2b_catalogue_items` select (`submit.ts:946-958`, the manual_final `price_mode` fetch over the lines' `catalogueItemId`s) with `catalogue_id, b2b_catalogues(decoration_pooling_enabled)` — zero new round trips. (`loadTierMultiplier` stays untouched.)
- Build `poolQtyByDecorationId` from `poolLines` (`input.pricing_pool_lines ?? input.lines`, :750) using the shared module — `pricing_pool_lines` keeps working unchanged, which preserves the F1 mixed-cart-split behaviour and its test (`route.split.test.ts`). Note `pricing_pool_lines` is the **full unpartitioned cart** on every partition's submit call (`app/api/checkout/route.ts:180` passes `body.lines` to each), so stocked lines are present in it — the shared module's stocked-line filter is load-bearing; assert it in `submit.pricing-pool.test.ts`.
- `decorationQtyForLine` (:1025-1027): for pooled lines, per-decoration qty = `poolQtyByDecorationId.get(dec.decorationId)`; feed that into the existing per-`(link, qty)` batched RPC calls (`effective_decoration_unit_price` via `effectiveDecorationPrice`; the `manualPairs` batch — built :1037-1044, `catalogue_item_decoration_price` RPC at :1067-1073 — skips pooled manual items, replaced by Σ per-decoration `effective_decoration_unit_price`, which now reads the ladder).
- Garment: `garmentPriceGroups` stays item-aware-keyed and `group.totalQty` stays **un-inflated**; compute `garmentBandQty(group)` at the call site and pass it only as the qty argument to `effective_unit_price_for_item` (:812-817) and legacy `effective_unit_price` (:822-826 — legacy product-keyed lines carry no `catalogueItemId`, so they can never resolve a pooled catalogue; unchanged in practice). `period_unit_price` (:802-806) keeps `group.totalQty` — ordering-period pricing is spec-excluded from pooling.
- Verified safe, do not regress: pooled/max-rule qty appears **only** as an RPC qty argument. MOQ reads `productionQtyByProductId` (:704-711, loop :716-736); billed totals multiply the band-selected unit price by each line's own `qty` (:1452-1458, :1480-1488); `classifyOrderType` reads no qty at all (`lib/orders/order-type.ts:16-23`); `lib/pricing/order-billing-shape.ts` / `order-picking-fee.ts` are the client-side estimate twins (not called by submit) and also read per-line qty. Keeping `group.totalQty` un-inflated preserves all of this for free.
- Drift guards: mechanically unchanged (server recomputes, compares claims) — they are the release's safety net: any cart/server divergence 409s loudly instead of mispricing.
- Update the round-trip budget expectations in `submit.roundtrip-regression.test.ts`: distinct `(link, pooled qty)` pairs change shape but the "one RPC per distinct pair, not per line" invariant must hold.

### 2d. Amendment RPC (staff repo, migration `20260814TTTTTT_pooled_amendment_pricing.sql`)

`CREATE OR REPLACE public.plan_order_amendment` **based on the 20260807120000 version** (it's the live definition; diff both files first — this function has been replaced once already and the next replace must carry the Xero-effect changes forward). Changes, gated on the order's catalogue flag:

- Decoration price: replace the single `v_group_qty` (per `catalogue_item_id`, :335-337 in the 0807 file) with a per-decoration pooled qty — join `p_intended_state->'lines'` through `b2b_catalogue_item_decorations` on `org_decoration_id`, excluding stocked lines and non-poolable decorations, and pass it to `effective_decoration_unit_price(od.id, v_pool_qty)`.
- Precedence fix, gated the same way: the 0807 expression is `coalesce(l.unit_price_override, effective_decoration_unit_price(od.id, v_group_qty), od.unit_price)` (:342/:360) — the override beats the RPC, the **opposite** of checkout (`decoration-effective-price.ts:61-69`, RPC first). For pooled orders put the ladder/RPC first so amendment matches checkout; flag-off orders keep the 0807 expression byte-for-byte.
- Garment canonical price: `effective_unit_price_for_item(v_item.id, v_org_id, greatest(v_group_qty, v_max_pool_qty))` (max rule; the call is at :428 — the period branch at :427 keeps plain `v_group_qty`, periods are out of scope).
- Return per-line `repriced: boolean` (price changed though the line itself wasn't edited) so the staff UI can render the agreed **"this change re-bands N other lines"** warning in the amendment modal before commit. Manual price override remains untouched as the goodwill valve.
- Sweep result (verified 2026-08-13): only the 0805 and 0807 migrations define `plan_order_amendment`; no later migration or `db/pending-migrations/` file touches it. The only other qty-aggregating SQL functions are MOQ-only (`submit_b2b_order`, baseline :6434/:6869, plus the held region-quota guard) and period-scoped (`period_progress_for_org` baseline :5362, `recompute_period_pricing` :5763 — its own frozen price system, spec-excluded, never consults the chokepoint). Nothing else needs the pooling change. Still test with the teardown-leak lesson in mind ([skucollapse-teardown-committed-leak]): amendment RPCs have missed a key change before.

### 2e. Staff quote-line endpoint (staff repo)

`/api/pricing/quote-line` prices one garment line with zero sibling context today (confirmed — and it never queries decoration tables at all: it returns a garment-only price, decoration layered separately per the DB comment on `effective_unit_price`, baseline :3397). `order_id` is already in the payload (`route.ts:12`, sent at `LineItemRow.tsx:227`), and `resolveOrderAmendmentScope` (`src/lib/orders/server.ts:73-82`) already returns `{organizationId, quoteId}` — so when the order's catalogue has pooling on, the route loads the order's current `quote_items` by `quoteId` + their `b2b_catalogue_item_decorations` links with the same service-role client, adds the requested line, and computes pools **solely to derive the max-rule garment band qty** for the pricing RPC (that is the only price this route returns). Client (`LineItemRow.tsx` :192-273) needs no payload change; the existing latest-wins guard (`cancelled` flag + requested-values comparison, :203-206/:236-244) already handles the recompute-on-qty-change flow. (Draft orders with unsaved sibling lines will price without them until saved — acceptable v1 edge; note it in the route comment.)

**Estimate:** 2b+2c ≈ 4–5 days (the bulk of it is tests), 2d ≈ 2–3 days (RPC diff/replace + SQL tests), 2e ≈ 1 day. One reviewer pass over the whole seam before merge.

---

## Phase 3 — Customer display (customer repo, can trail Phase 2 by days)

- "Same artwork savings" pill + tooltip on pooled cart lines and checkout review lines. The recompute already knows each line's pool sizes — expose `pooledQty` per decoration on the recomputed line rather than re-deriving in components.
- Next-band nudge ("Add N more garments with this artwork…") — reuse the `period-savings.ts` messaging pattern; N = distance from current pool to the next `min_quantity` on the governing ladder.
- PDP static note on items in pooled catalogues.
- Copy exactly as specced (§8): outcome, not formula.

**Estimate:** 2 days.

---

## Phase 4 — Pilot activation (runbook, no code)

Trade Services (Otago), in order:

1. Replace the $0 "Custom decoration" placeholder with their real embroidery `org_decoration` (real artwork_id) across the 12 items — data work through existing attach endpoints.
2. Author/sign off its ladder (AM).
3. Flip `decoration_pooling_enabled` on their catalogue.
4. Smoke: the 4-polos+4-hoodies basket must price at pooled qty 8 in cart, survive checkout with zero drift 409s, snapshot correctly into `quote_items.decorations`, and re-band correctly through a staff amendment (remove polos → hood price rises, warning shown).
5. Watch checkout logs for drift errors for a week before offering activation to other catalogues.

---

## Phase 5 — Retirement (held)

Once pooled catalogues no longer read band `decoration_unit_price`: stop writing it from `PricingSection` for pooled catalogues, then stage a column-drop migration in `db/pending-migrations/` per the held-migration convention (same posture as [[volume-display-drop-migration-held]]) — drop only after all catalogues are migrated or explicitly grandfathered. Not scheduled.

---

## Test plan (summary)

| Layer | Vehicle | What it pins |
|---|---|---|
| Pooling math | new `decoration-pooling.test.ts` | Spec worked examples A & B verbatim; anti-transitivity; stocked/placeholder/prepaid eligibility |
| Cart | extend **both** `lib/cart/types.test.ts` and `lib/cart/__tests__/types.test.ts` (duplicate suites; each has its own `recomputeProductTierPrices` block, :94-267 / :163-395) | pooled re-pick on add/remove/qty-edit; flag-off byte-identical behaviour; manual_final pooled = Σ ladders; the sibling file's cross-product-isolation assertions (`types.test.ts:132-141`) stay true flag-off |
| Checkout | extend `submit.tier-aggregation-key.test.ts`, `submit.pricing-pool.test.ts`, `submit.drift-characterization.test.ts` | pooled key rules; `pricing_pool_lines` still seeds pools; pooled manual path drift; flag-off parity snapshot |
| Perf budget | `submit.roundtrip-regression.test.ts` | one RPC per distinct (link, pooled qty) / (item, band qty) still holds |
| DB | SQL tests alongside migrations | ladder clamp/tail behaviour in `effective_decoration_unit_price`; `plan_order_amendment` pooled repricing incl. re-band-down |
| E2E smoke | Phase 4 runbook | the pilot basket end-to-end |

The **flag-off parity test** is the most important new test in the suite: run a representative fixture cart through old and new code paths with pooling disabled and assert identical output. It converts constraint #2 from a promise into CI.

---

## Risk register

- **Drift 409s at rollout** — cart and server disagree on a pooled price → customers blocked at checkout. Mitigation: shared module (2a), flag-off parity test, pilot-first activation, drift guards fail loud not wrong.
- **`plan_order_amendment` divergence** — two migrations already define it; replacing the wrong base re-introduces the pre-Xero version. Mitigation: diff 20260805 vs 20260807 before writing the replace; SQL test asserting the Xero-effect behaviour survives.
- **Ladder side-channel activation** — a ladder signed off for one catalogue changes that decoration's price in *every* catalogue it's attached to (chokepoint design). By spec this is intended (single source of truth), but the activation checklist must show AMs the full attachment list (`decorations/[decorationId]/items` page already exists for this). Display/charge consistency verified: catalogue grid, PDP live re-price, and checkout all call the same RPC, so all pick up a ladder together; the one straggler is the PDP first-paint static price (fixed in 2b). Pre-existing, unrelated edge: the grid's RPC-null fallback ignores `unit_price_override` (`catalogue/page.tsx:362-366` never selects it) while checkout's fallback includes it — manifests only when the RPC returns null, which ladders make rarer.
- **Old persisted carts** mid-deploy lack the new snapshot fields → they simply don't pool (degrade to today's pricing); server prices them the same way because pooling requires the flag *and* poolable decorations resolved server-side. No forced cart invalidation needed.
- **Margin exposure** is a data/authoring risk, not code: surfaced in the §10 spec note and the activation checklist.

## Suggested build order

Phase 0 → Phase 1 can start immediately and ship independently (both dark). Phase 2 is one branch pair (`feat/pooled-decoration-pricing` in each repo) merged together; Phase 3 trails on the customer repo; Phase 4 is a runbook day with Chris/AM. Total engineering estimate: **~12–15 focused days** across both repos, the majority in Phase 2 tests.

---

## Review changelog (2026-08-13)

Pre-build source review of every code citation and architectural claim against both repos (customer `main` @ a0125e6; staff pricing files verified identical to `master`). One line per substantive change — *plan said → code says → change made*:

- Phase 0 PDP threading cited `app/api/shop/products/[id]/route.ts` → that route has no callers (only its `/availability` sub-route is fetched, `CartTable.tsx:72`); the live PDP loader is `resolveCatalogueItemForPdp` (`lib/shop/resolve-catalogue-item.ts:36`, own `b2b_catalogues!inner` join) → retargeted Phase 0 at the real loader + PDP page payload.
- 2b said "stocked lines: skip entirely (stockUnitPriceByItem semantics)" → stocked lines are NOT skipped from today's per-product tier aggregation (pinned by `__tests__/types.test.ts:267-275`; flat price survives via a synthesized single-band bracket, `ProductDetailClient.tsx:1055-1059`; no `stockUnitPriceByItem` symbol exists) and skipping them would break flag-off byte-parity → rewrote the bullet: existing behaviour untouched, exclusion applies to decoration pools + max-rule receipt only.
- Constraint #4 claimed the chokepoint covers "every consumer" → `effective_decoration_unit_price` has no internal flat fallback (returns NULL for heatpress/supacolour/dtf/custom; callers coalesce, per its COMMENT :3346), and four consumers bypass it (PDP first-paint static price, staff PricingSection preview, `/api/pricing/decoration-quote`, period system) → listed all consumers/non-consumers with disposition; added a 2b task making the PDP first-paint seed ladder-aware.
- Plan was silent on `unit_price_override` precedence → checkout is RPC-first (`decoration-effective-price.ts:61-69`) but `plan_order_amendment` is override-first (`coalesce(l.unit_price_override, rpc, od.unit_price)`, 0807 :342/:360) — with ladders live, an overridden link would price ladder at checkout but override on amendment → added a gated precedence fix to 2d and checklist item (d) to 1a.
- 2c hooked the flag fetch on "the `loadTierMultiplier` pattern" → a better seam exists: the once-per-checkout `b2b_catalogue_items` `price_mode` select (`submit.ts:946-958`) can carry `catalogue_id` + the flag with zero new round trips → retargeted.
- 2c's garment bullet fed `garmentBandQty` to "`effective_unit_price_for_item` / `period_unit_price`" → `period_unit_price` must keep `group.totalQty` (ordering-period pricing is spec-excluded), and legacy `effective_unit_price` (:822-826) exists but can never see a pooled catalogue (no `catalogueItemId`) → corrected, and added the verified guard map (MOQ/billed-total/order-type consumers all read per-line or separate qty — safe as long as `group.totalQty` stays un-inflated).
- 1a's "wrap delete+insert in a single RPC or pg transaction" was speculative → an exact exemplar exists: `replace_b2b_catalogue_item_base_cost_tiers` (baseline :5920-5946) + `base-cost-tiers/route.ts:75-90` → Phase 0 migration now creates `replace_org_decoration_pricing_tiers` as a clone; 1a copies the paired route pattern.
- 1b said the 1a editor path "keeps audit events" → decoration routes fire no audit events today (the item-tiers route does: `AUDIT_ACTIONS.PRICING_TIER_CHANGE`) → 1a now explicitly adds audit; 1b reworded.
- 2d's sweep instruction ("check every RPC that aggregates qty") resolved → sweep done: only 0805/0807 define `plan_order_amendment`; other aggregators are MOQ-only (`submit_b2b_order`) or period-scoped (`period_progress_for_org`, `recompute_period_pricing`) and out of scope → recorded the verified result.
- 2e's "server derives context from order_id" was unproven → verified feasible: `order_id` already in the payload (`route.ts:12`), `resolveOrderAmendmentScope` already returns `quoteId` (`server.ts:73-82`), service-role client reaches `quote_items` + decoration links; also clarified the route prices garment only, so pooling affects just the max-rule band qty; the stale guard is a `cancelled`-flag latest-wins check, not abort/request-id.
- Test plan told engineers to extend `lib/cart/__tests__/types.test.ts` → a duplicate sibling suite `lib/cart/types.test.ts` also has its own `recomputeProductTierPrices` block with aggregation-key assertions → test plan now requires updating both.
- Constraint #3 attributed the `YYYYMMDDHHMMSS_snake_case.sql` naming rule to AGENTS.md → AGENTS.md has the push/no-dashboard/pending rules; the naming convention is CONTRIBUTING.md:11 (`<timestamp>_<name>.sql`) → attribution fixed.
- Phase 0 RLS note said "mirror `b2b_catalogue_item_pricing_tiers`" → the auth-hardening template to copy is `b2b_member_store_grants_staff` (`FOR ALL TO authenticated USING (auth_is_staff()) WITH CHECK (auth_is_staff())`, 20260812110000:95-97) → DDL comment updated with the concrete policy shape.
- Added to 0/1a: never author ladders on `custom`/null-artwork decorations (ladder-first would otherwise start pricing $0 placeholders); route refuses them.
- Added to 2a: cart/checkout line field-name normalization note (`fulfilmentType` vs `fulfilment_type`; `catalogueItemId` camelCase in both).
- Added to 2c: `pricing_pool_lines` is the full unpartitioned cart on every partition submit (`app/api/checkout/route.ts:180`), so the stocked-line filter in the shared module is load-bearing.
- 2b's "PDP loader populates brackets from the ladder" made concrete → today's `decorations[].brackets` are client-probed at fixed breakpoints and collapsed (`ProductDetailClient.tsx:709-718/:969-991`); a pooled qty landing between probes with a missed ladder band edge would cart/server-diverge → laddered decorations must snapshot exact ladder bands, not probe output.
- Citations corrected silently: mirror-comment ranges (types.ts:172-180 / submit.ts:473-484), `decorationQtyForLine` :1025-1027, manual RPC batch :1037-1044/:1067-1073, `applyManualDecorationForLine` :1092-1121, `LineItemRow.tsx` :192-273, 0807 garment call :427-428, org decorations page path `src/app/(portal)/b2b-accounts/[orgId]/decorations/`.

Blockers found: **none** — every locked design decision survives contact with the source as long as the corrections above are honoured.

---

## Build log

Branches: `feat/pooled-decoration-pricing` in both repos (customer off `main` @ a0125e6; staff off `master` @ 613a4e53).

**Recorded baseline (2026-08-13, before any pooling code).** Never regress, never chase:
- Customer `npm test`: 3 files / 5 tests failing — `past-orders/__tests__/OrdersTable.test.tsx` ×2, `users/__tests__/TeamClient.branch.test.tsx` ×2, `components/cart/__tests__/CartProvider.test.tsx` ×1. `tsc --noEmit`: 14 errors (`lib/__tests__/next-config-redirects.test.ts` ×1, `lib/email/__tests__/tracker-notification.test.ts` ×13).
- Staff `npm test`: 3 files / 8 tests failing — `api/catalogues/[id]/items/[itemId]/route.test.ts` region_quota ×3, `attach-designer/sections/swatch-edit-hint.test.ts` ×4, `layout/Sidebar.test.tsx` ×1. `tsc --noEmit`: 7 errors (3 stale `.next/types/validator.ts` artifacts left by `feat/b2b-account-list-pagination`, `OrderDetailClient.test.tsx` ×2, `OrderDocument.test.tsx` ×2).

### Phase 0 — Schema foundation

- **2026-08-13 — Phase 0 staff migration — done.** `supabase/migrations/20260813120000_org_decoration_pricing_tiers.sql` (staff `3aad239a`): `org_decoration_pricing_tiers` table + staff-only RLS via the `auth_is_staff()` template, no anon grant; `b2b_catalogues.decoration_pooling_enabled` default false; `replace_org_decoration_pricing_tiers` RPC cloned from `replace_b2b_catalogue_item_base_cost_tiers`; `effective_decoration_unit_price` replaced with the ladder lookup prepended. *Deviation (documented):* the plan's inline snippet showed the exact-band probe plus a below-lowest clamp comment; the implementation mirrors **all** of `catalogue_item_decoration_price`'s clamp (baseline :2677-2690) — exact band → highest band at-or-below → lowest band — because :2677-2690 is both directions and a closed top band would otherwise return NULL above its max. SQL test `org-decoration-pricing-tiers.test.ts`, 8 assertions green. **NOT APPLIED — awaiting HITL approval for `supabase db push`.**
- **2026-08-13 — Phase 0 customer plumbing — done.** `lib/shop/resolve-catalogue-item.ts` LIVE loader select now carries `b2b_catalogues!inner(id, …, decoration_pooling_enabled)`, flattened onto `PdpCatalogueItem` as `catalogue_id` / `decoration_pooling_enabled` by a `withCatalogueFields` normaliser (handles PostgREST object-vs-array embeds; no embed → null/false, i.e. never pools). `app/api/shop/products/[id]/route.ts` left untouched per the review changelog. PDP page threads `catalogueId`/`poolingEnabled` into the `product` payload; `ProductDetailClient` carries them onto all three `cart.addLine` sites. `CartLine` gains `catalogueId?`/`poolingEnabled?`; `CartLineDecoration` gains `poolable?`; `DecorationOption.poolable` is server-computed in `loadCatalogueItemDecorations` as `artwork != null && decoration_method !== 'custom'`. Tests: new `lib/shop/decorations.poolable.test.ts` (5) pins eligibility across all six DB methods and proves the rule is shape-based not price-based; `resolve-catalogue-item.test.ts` +2.
