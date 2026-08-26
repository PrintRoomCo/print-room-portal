# IDE prompt — pooling should combine QUANTITY only: restore the item's own decoration ladder for `manual_final` items

> Paste everything below the line into your in-repo IDE agent.
> Run it inside `print-room-portal` (customer). You also need **read + write** access to the sibling repo `/Users/jamierogangeorge/Documents/print-room-staff-portal` (staff — it owns the shared Supabase schema).
> **This is a build task, not a docs task.** You will change application code, add tests, and author one migration. TDD throughout: failing test first, then the code that makes it pass.

---

## Objective

Change pooled decoration pricing so that, for `price_mode = 'manual_final'` catalogue items, **pooling changes the quantity and nothing else**. Today it also swaps the price *source*. After this change:

> **The rule to build.** For a `manual_final` item, a pooled line's decoration cost stays the item's **own combined per-band `decoration_unit_price`**, band-selected at the **pooled band quantity** (the max rule: the largest pool among the line's own poolable decorations, never below its own group quantity). Computed items are **unchanged** — they keep per-decoration ladders / engine pricing, each placement at its own pooled quantity.

Phrased the way it was requested: *"pooling should be — if the same decoration exists on products in the cart, combine the quantity of all those units, then price independently against their own quantity tables assigned directly on the product."*

This must hold identically on **four** surfaces (PDP snapshot, cart recompute, checkout re-derivation, staff amendment RPC) because the checkout drift guards compare them and **block the order** on any mismatch.

## Why — the design history you need before you touch anything

Read `docs/2026-08-13-pooled-decoration-pricing.md` in full first. The tension is between two of its own sections:

- **§2 (the agreed rule):** *"Lines in the same catalogue that share a decoration pool their quantities. Every pooled line band-selects at the combined quantity, but each line reads the selected band from its own item's price ladder."* — This is exactly the behaviour being asked for, and it is what the **garment** price already does.
- **§3 (the structural change):** decoration price moves to a per-decoration ladder (`org_decoration_pricing_tiers`), declared *"the single source of truth for decoration price everywhere — pooled or not"*, with `b2b_catalogue_item_pricing_tiers.decoration_unit_price` *"retired after backfill"*.

§3 gave two reasons. Weigh both during investigation — you are expected to agree with one and not the other:

1. **"One combined figure can't express a per-placement delta."** Sound, and structural. A hood carrying left-chest *plus* back-print needs the back print to cost the marginal difference; a single blended number cannot decompose into that. **This is why computed items keep per-decoration ladders and are out of scope for this change.**
2. **"Per-item decoration figures drift for the same logo"** (cited live data: AF Relax Socks `0.93/0.70/9.00` vs Stencil Hood `22.50/2.62/5.74/7.50`). This reason **does not hold for `manual_final`**. On a manual_final item the AM types an all-in price per garment and the decoration figure is a **back-solved residual**, not a claim about what that logo costs to print. It differing between a sock and a hoodie is the intent of all-in pricing, not a data-quality defect. §3 retired the AM's primary pricing control to fix a problem that `manual_final` does not have.

**Business consequence being fixed:** on a pooled catalogue the account manager loses the Total-price lever — edit the all-in figure, have it back-solve decoration and leave base cost untouched. That lever is the main reason `manual_final` exists.

## Current state (verify each of these; they were true at 2026-08-26)

Customer repo `print-room-portal`, `main` @ `0a4d686` (== `origin/main`):

| Location | What it does today |
|---|---|
| `lib/pricing/decoration-pooling.ts` | The single implementation of the pooling rule: `poolKey`, `isPoolingLine`, `pooledQtyByDecoration`, `pooledDecorationQty`, `garmentBandQty`, `poolSizesForLine`. Its header states the band-selection quantity **may only ever be a price-lookup argument** — never MOQ, billed totals, picking fee, or order-type. |
| `components/shop/ProductDetailClient.tsx:1179` | `const manualDecorationActive = isManualPricing && !poolingActive` — pooled manual PDPs stop snapshotting the combined figure; `:1205` snapshots per-decoration `unitPrice: 0`; `:1212` omits `brackets`. |
| `lib/cart/types.ts:353-357` | On a pooled line, `manualDecorationPerUnit` is **cleared to null** so `decorationPerUnit()` (`:189`) falls through to the per-placement sum. |
| `lib/cart/types.ts:363` | The non-pooled manual re-pick uses `pickBracket(l.manualDecorationBrackets, total)` — `total` is the **un-pooled** product+signature aggregate. |
| `lib/checkout/prepare.ts:1067` | `isCombinedManualLine = isManualCheckoutLine(line) && !isPooledLine(line)` — the routing predicate that sends pooled manual lines down the per-placement path. |
| `lib/checkout/prepare.ts:1084-1091` | `manualPairs` keyed `${catalogueItemId}::${qty}` where `qty = decorationQtyForLine(line)` (un-pooled). |
| `lib/checkout/prepare.ts:619` | `garmentBandQtyForLine` — the max-rule pooled band quantity **already exists** and is what the garment price uses (`:815`, `:840`). |
| `lib/checkout/prepare.ts:1182`, call sites `:1219` and `:1379` | `applyManualDecorationForLine(line, decorationQty, driftLinkId)` — bills the combined figure and drift-checks the cart's claim. |
| `app/api/shop/decoration-pricing/route.ts:72` | `resolveManualCombined` → RPC `catalogue_item_decoration_price` / `catalogue_item_decoration_price_for_currency`, returned to the PDP as `manualByQty`. |

Staff repo `print-room-staff-portal`, `master` @ `b42f251b` (== `origin/master`):

| Location | What it does today |
|---|---|
| `src/components/catalogues/sections/PricingSection.tsx` | Decoration + Total inputs are editable in manual mode regardless of pooling (fixed 2026-08-26), with an amber `role="note"` warning saying the figures *"are not what checkout charges"* while pooling is on. **That warning becomes false for manual items under this change and must be rewritten.** |
| `supabase/migrations/20260824140000_sp3_checkout_country_partition.sql:995` | `amendment_decoration_unit_price_for_currency(...)` — the amendment-side implementation of the same rule. |
| ↳ NZD branch `:1014-1030` | When `p_pooling`, calls `effective_decoration_unit_price(deco, greatest(p_pool_qty, p_qty))` **without consulting `p_price_mode` at all**. |
| ↳ non-NZD branch `:1032-1037` | Checks `p_price_mode = 'manual_final'` **first**, and prices it `catalogue_item_decoration_price_for_currency(item, p_qty, ccy)` — the combined figure at the **un-pooled** `p_qty`. |
| ↳ call sites `:1310` and `:1356` | Pass `p_qty := v_group_qty` and `p_pool_qty := greatest(pooled_decoration_qty(...), v_group_qty)`. |
| ↳ `:1424` | The existing max-rule garment band expression: `select coalesce(max(public.pooled_decoration_qty(p_intended_state, v_catalogue_id, (d->>'decorationId')::uuid)), 0)` — reuse this shape for the manual combined band qty. |
| `supabase/migrations/20260824131000_pooling_readiness_invariants.sql` | `enforce_catalogue_pooling_readiness` + `replace_org_decoration_pricing_tiers` demand a ladder for **every** real decoration attached to an enabled pooled catalogue, regardless of the item's `price_mode`. |
| `src/lib/orders/quote-line-pooling.ts` | `maxRuleBandQty` — staff quote-line pooling. Returns a **garment** price only; decoration is layered separately. Check whether it needs anything. |

**Note the pre-existing inconsistency** in `amendment_decoration_unit_price_for_currency`: for a pooled `manual_final` line, NZD prices per-decoration while non-NZD prices the combined figure at the wrong (un-pooled) quantity. Your change should **resolve** this, not preserve it. Confirm it is real before relying on it.

## Live data for reasoning and smoke-testing

- Org **Print Room Demo** `2b8efaa2-95de-4be5-9c85-88e5f0f06835`; default country NZ / NZD / 0.15 GST.
- Catalogue `4d21bd07-b5f8-4b9a-a71f-fe3e40b51bb6` — **the only catalogue in the system with `decoration_pooling_enabled = true`**. Every real customer catalogue is false, so blast radius outside the demo store is zero until another is switched on.
- Item **Everyday Pullover Hoodie** `9c565135-c69c-484d-9d49-57d163e3045a`, `price_mode = manual_final`.
  - Item combined decoration @ qty 1/24/50/100 = **8.00 / 6.50 / 5.00 / 3.50** ← what the AM authored, ignored today
  - `Screen print — Left Chest` decoration ladder @ 1/24/50 = **10.00 / 6.50 / 5.00** ← what checkout charges today
  - Garment @ 1/24/50 = 70.28 / 61.08 / 49.16
- `Custom decoration` `57367167-586e-473b-8ad4-aed25e8a9478` — the `$0`, `decoration_method = 'custom'` placeholder attached catalogue-wide. Never poolable (structurally excluded). Its currency RPC returns **NULL in every currency including NZD**; commit `0a4d686` makes a flat `$0` decoration price at `0` in any currency. **Do not regress that fix** — computed catalogues still carry the placeholder and still depend on it.

## Locked — do not relitigate

- Computed items keep per-decoration ladders and per-placement pricing. Reason 1 above is accepted.
- Pooling identity stays the `org_decorations` row, scoped per catalogue. No cross-catalogue pooling.
- The max rule for garment band selection, and its deliberate non-transitivity.
- Eligibility (§5): `$0`/`custom` placeholders never pool; stocked lines neither contribute nor receive; prepaid lines contribute quantity; same catalogue only.
- Per-catalogue opt-in via `b2b_catalogues.decoration_pooling_enabled`, default false.
- **Flag-off byte parity.** With every catalogue's flag false, pricing must be byte-identical to today. `lib/cart/flag-off-parity.test.ts` pins this — it must keep passing untouched.
- The pooled quantity is a **band-selection** quantity only. It must never reach MOQ checks, billed totals, picking fee, order-type classification, or anything in `lib/pricing/order-billing-shape.ts` / `order-picking-fee.ts`.
- The `$0` placeholder fallback from `0a4d686` stays.

## Phase 0 — investigate before you change anything

Produce a short written findings section (you will paste it into the design note in Phase 4). Do not start editing until it is done.

1. **Verify every row of both tables above** against the actual source. Fix any line number that has moved; flag anything materially different from what is described.
2. **Enumerate every consumer of the manual combined figure.** Grep both repos for `manualDecorationPerUnit`, `manualDecorationBrackets`, `catalogue_item_decoration_price`, `catalogue_item_decoration_prices_bulk`, `claimed_manual_decoration`, `isCombinedManualLine`, `manualByQty`, `decoration_unit_price`. For each hit state: does it need the pooled band qty, or is it price-mode agnostic? **A consumer you miss becomes a drift-guard block at checkout, i.e. a customer cannot place an order.**
3. **Map the drift guards precisely.** Find `DecorationDriftError`, `UnitPriceDriftError`, and the manual path inside `applyManualDecorationForLine`. Write down exactly which client-claimed value is compared against which server value, and at what rounding. This determines which surfaces must ship together.
4. **Falsify "four surfaces".** Try to find a fifth place that prices decoration for a pooled manual line — reorder rebuild, ordering-period pricing, `quote_items` snapshot replay, catalogue grid overlays (`lib/shop/catalogue-decoration-prices.ts`), staff quote-line, bulk RPCs. Report what you find even if the answer is "none".
5. **Confirm no schema change is needed** on the customer side: `catalogue_item_decoration_price(item, qty)` and `..._for_currency(item, qty, ccy)` already exist and already read the item's per-band figure. The only DB work should be the amendment function.
6. **Check the readiness invariants.** Under the new rule a `manual_final` item does not consume `org_decoration_pricing_tiers`, yet `enforce_catalogue_pooling_readiness` still demands a ladder for its decorations. Determine whether a decoration can be attached to both a manual and a computed item in the same catalogue (it can in principle — verify against live data), which is why relaxing the gate is not a simple per-decoration test.

## Decisions you must make and record

Resolve each, state the reasoning in the design note, and make all four surfaces agree.

1. **Which quantity does the manual combined figure band-select at?** Recommended: the **max-rule band quantity** (`garmentBandQty`) — a `manual_final` line is one all-in price, so its decoration half should move with the same band its garment half moves with; a blended figure has no meaningful per-decoration quantity. If you choose otherwise, justify it and make every surface match, including SQL.
2. **What happens to the per-decoration `unitPrice` snapshot on a pooled manual line?** Today the PDP writes `0` for non-pooled manual lines specifically so an accidental fallback yields `0` rather than a wrong positive number. Preserve that safety property.
3. **The "Same artwork savings" pill (§8).** `poolSizesForLine` still rides pooled quantities onto the line for display. Confirm the pill is still truthful for a manual line (the band did move) and that no per-placement money leaks into the UI.
4. **The readiness gate.** Recommended: **leave it as-is** for v1 — it over-demands ladders for manual-only decorations, which is conservative and harmless — and document why. If you propose relaxing it, it must handle a decoration shared between manual and computed items.
5. **NULL bands.** A `manual_final` item whose ladder has no decoration figure at the selected band currently yields `0`. Keep that, and keep it distinct from the `$0`-placeholder path.

## Phase 1-3 — build, TDD, in this order

Work outside-in, and keep the repos in lockstep. **Every step: failing test first.**

**Phase 1 — the shared rule.** If a helper is needed to express "the band quantity a manual line's combined decoration prices at", put it in `lib/pricing/decoration-pooling.ts` beside the others, with a header comment in the established voice, and unit-test it in `lib/pricing/decoration-pooling.test.ts`. Do not duplicate the rule into callers.

**Phase 2 — customer repo, all three surfaces in one commit** (they must not be separable, or a half-deploy blocks checkout):
- `lib/checkout/prepare.ts` — `isCombinedManualLine` stops excluding pooled lines; the `manualPairs` quantity becomes the pooled band quantity; both `applyManualDecorationForLine` call sites pass it. Rewrite the block comment at `:1060-1066` — it currently argues for the behaviour you are removing.
- `lib/cart/types.ts` — stop clearing `manualDecorationPerUnit` on pooled lines; feed the pooled band quantity to `pickBracket(l.manualDecorationBrackets, …)`. Rewrite the comment at `:345-352`.
- `components/shop/ProductDetailClient.tsx` — `manualDecorationActive` becomes price-mode-only. Rewrite the comment at `:1174-1178`. Confirm the PDP's `/api/shop/decoration-pricing` request already asks for the quantities it now needs, and that `manualByQty` covers them.

**Phase 3 — staff repo:**
- One migration under `supabase/migrations/` replacing `amendment_decoration_unit_price_for_currency` so that a pooled `manual_final` line uses the combined figure at the pooled band quantity **in every currency**, NZD included; keep `p_is_first` so the combined figure is billed once per line, not once per placement. Re-check the two call sites at `:1310`/`:1356` — they may need the max-rule expression from `:1424` threaded in as a new argument. Update the `comment on function`/`plan_order_amendment` comment text, which currently describes the old rule.
- Rewrite the amber warning in `src/components/catalogues/sections/PricingSection.tsx`: for `manual_final` these figures **are** what checkout charges — the note should now say only that pooling combines quantities across garments sharing artwork so the band may be better than this line's own quantity. Keep the caveat for computed mode if the component can reach it. Update `PricingSection.pooling.test.tsx` accordingly; it currently asserts the string `not what checkout charges`.
- Check `src/lib/orders/quote-line-pooling.ts` — it prices garment only, so it may need nothing. Say so explicitly if so.

### Migration rules — non-negotiable (staff `AGENTS.md`)

- The staff repo owns the shared schema. **Every** schema change is a migration file applied with `supabase db push`.
- **Never** apply schema changes via the Supabase dashboard or the MCP `apply_migration` tool. Read-only MCP queries for investigation are fine.
- `supabase db push` is a **human-in-the-loop** step. Author the migration, make it idempotent and re-runnable, then **stop and hand back** for the user to run. Do not push it yourself.
- Any `.tsx` you touch in the staff repo must pass the `docs/ui/oem-rules.md` pre-flight: no `bg-gray-*` / `border-gray-*` / `text-gray-*`, `rounded-2xl` for inner surfaces, `bg-amber-100 text-amber-800` for warnings.

## Tests — the specific cases that must exist

Extend, do not replace. Name the pooled-manual cases so they are greppable.

- `lib/pricing/decoration-pooling.test.ts` — the band-qty helper, including a line whose own group qty exceeds every pool (must never band *down*).
- `lib/cart/types.test.ts` and `lib/cart/__tests__/types.test.ts` — **both exist; work out which is live and say so.** A pooled manual line keeps its combined figure and re-picks it at the pooled band; a pooled *computed* line is untouched; a qty edit on a sibling line re-picks the manual line's decoration.
- `lib/cart/flag-off-parity.test.ts` — must pass **unmodified**. If you have to change it, you have broken flag-off parity.
- `lib/checkout/__tests__/submit.pooled-decoration.test.ts` — a pooled manual line bills the combined figure at the pooled band; a pooled manual line whose cart claim matches does **not** drift; a stale claim still blocks.
- `lib/checkout/__tests__/submit.drift-characterization.test.ts` — cart and server agree end-to-end for a pooled manual line. This is the test that proves a customer can actually check out.
- `lib/checkout/__tests__/submit.manual-garment-only.test.ts` and `submit.pricing-pool.test.ts` — confirm still green; extend if they encode the old routing.
- `components/shop/__tests__/ProductDetailClient.manual-pricing.test.tsx` — a pooled manual PDP snapshots the combined figure and its brackets.
- `components/shop/__tests__/ProductDetailClient.country-pricing-pending.test.tsx` and `app/api/shop/decoration-pricing/__tests__/route.test.ts` — must stay green; they pin the `$0` placeholder fix and the in-flight-re-price fix from `0a4d686`.
- **Worked example from the spec, as an explicit test.** 500 tees + 100 hoods sharing one left-chest print, both `manual_final`: each line's decoration must come from **its own** item ladder at band **600**, and the two lines may legitimately differ. That single test is the whole feature.
- Staff repo: extend `PricingSection.pooling.test.tsx`; add coverage for the amendment SQL if the repo has a pattern for it (`supabase/migrations/org-decoration-pricing-tiers.test.ts` exists as a precedent).

## Verification gates before you report done

Run and report actual numbers, not adjectives:

- Customer: `npm test`; `npx tsc --noEmit`; `npm run lint`.
  - **Known-failing on a clean tree — do not "fix", do not count as yours:** `OrdersTable.test.tsx`, `TeamClient.branch.test.tsx`, `CartProvider.test.tsx` (5 failures), and **14** `tsc` errors confined to `lib/email/__tests__/tracker-notification.test.ts` and `lib/__tests__/next-config-redirects.test.ts`. Prove your `tsc` count is still exactly 14 and in those two files only.
- Staff: `npm test`; `npx tsc --noEmit`; `npm run lint`.
  - **Known-failing on a clean tree:** `swatch-edit-hint.test.ts` (4 failures, `window.localStorage` undefined in that env).
- If a number moves, `git stash` and re-run to prove whether it is yours before claiming it is pre-existing.

## Deliverables

1. Customer repo: branch `fix/pooled-manual-own-decoration-ladder` off `main`, one commit containing all three surfaces plus tests.
2. Staff repo: branch of the same name off `master` — migration + `PricingSection` warning + tests. **Migration authored but NOT pushed.**
3. `docs/2026-08-13-pooled-decoration-pricing.md`: add a dated amendment section recording that §3's "single source of truth" now applies to **computed items only**, with the reasoning from "Why" above. Do not rewrite the original §3 — amend it, so the history stays readable.
4. A short design note at `docs/2026-08-26-pooled-manual-decoration-own-ladder.md`: your Phase 0 findings, the five decisions and their reasoning, the consumer inventory, and the exact `supabase db push` command the user must run.
5. In your final message: the before/after decoration price for Everyday Pullover Hoodie at qty 1/24/50/100 under pooling, so the change is legible as money.

## If you get blocked

Do not silently redesign around a blocker. If you find that the combined figure genuinely cannot survive pooling on some path (most likely candidate: a catalogue mixing manual and computed items that share one decoration, where the same `org_decorations` row must price two ways in one order), **stop**, write the evidence under a `## Blockers found` heading in the design note, mark the affected phase `⚠ BLOCKED`, and report back rather than guessing. A wrong guess here does not produce a wrong price — it produces a drift-guard exception that stops customers checking out.
