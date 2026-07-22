# Strategy — Chris's client feature batch (MTF / Trade Services / Reburger)

> **Date:** 2026-07-22 · **Author:** grounded code inspection (4 explorer passes) + existing
> `2026-07-15-spec-a-*` / `spec-b-*` dispatch docs.
> **Repos:** **P** = `print-room-portal` (customer) · **S** = `print-room-staff-portal` (schema owner).
> **Deadline anchor:** ~**26 July** is the migration date for the top clients (MTF). Chris flagged
> the Stripe/Reburger item as explicitly *after* the 26th. So the critical path is the MTF blockers
> (features 1 + 2); everything else sequences around them.

---

## ✅ Decisions locked — `/grilling` session, 2026-07-22

> **This section is authoritative and supersedes anything below it where they differ.** The
> per-feature triage further down is retained as reference/reasoning. Reached by walking the
> sequencing tree with Jon; each line here is a decision he made, not a recommendation.

**▶ Implementation plan (bite-sized, TDD, cross-repo):**
[`docs/superpowers/plans/2026-07-22-mtf-location-dropdown.md`](./superpowers/plans/2026-07-22-mtf-location-dropdown.md)
— 11 tasks + go-live ops appendix. Task 1 (Monday title fix) ships independently and first.

### Sequencing (the operative plan)

- **26 July = hard MTF go-live.** Solo build (Jamie + Claude assist), ~4 working days → effectively serial.
- **Pre-26 scope = feature 1 (MTF location dropdown) ALONE.** All other 11 asks park. This **reverses**
  the earlier "build 1+2 together" call — Trade Services' custom name (2) is a *separate, later* client,
  so it comes off the critical path entirely.
- **Posture: full reusable tooling, all-in, no seed fallback.** Jon's explicit calls — build the real
  CSV importer + staff UI now (not a hand-seed), and accept the schedule risk with no fallback. (Risk
  flagged and acknowledged; decision stands.)
- **Post-26 queue leads with feature 2 (custom name) + extraction of the shared line-attribute
  abstraction & Monday-title formatter** — the "second caller" that justifies generalising feature 1's
  foundation. Then the cheap wins / dark-feature flips per the triage below.

### Feature 1 — locked build spec

- **Locations are a NEW dataset, not `stores`.** MTF's embroidery "locations" are a distinct list from
  their branch/ship-to stores.
- **Schema (staff-repo migrations — never via MCP/dashboard):**
  - `org_line_datasets (id, organization_id, name)` — the dataset ("MTF Branches").
  - `org_line_dataset_values (id, dataset_id, label, position)` — the ~60 rows.
  - `b2b_catalogue_items.line_dataset_id` (nullable FK) — per-org, per-product assignment; **null =
    dropdown off**. This single column is the on/off + which-dataset in one.
  - Dedicated column(s) on `quote_items` for the selected value (feature 2's custom name reuses these).
- **Tooling (full):** dataset CRUD + CSV importer modelled on `bulk-members` (parser + dry-run preview
  route + confirm dialog) + per-product assignment control on the catalogue-item editor.
- **PDP:** dropdown fed by the assigned org dataset; **required** — hard-gate add-to-cart (mirror the
  MOQ gate) so no garment reaches Monday without a location. **No default value** (a default risks a
  silent wrong-location order).
- **Cart:** value on `CartLine` → into `lineSignature()` (`lib/cart/types.ts:188`); **per-garment
  grain** (different location = different line). Keep `tierAggregationKey` (`submit.ts:382`) in step;
  price pooling (product+decoration) is unaffected, so split lines still pool for volume pricing.
- **Checkout:** persist the value to the dedicated `quote_items` column in `submitCustomerOrder()`.

### Monday production-board subitem — bug fix + feature 1, ONE change (portal `lib/monday/deal-item.ts`)

- **Title bug — fix NOW** (it dirties *every* current order, not just MTF): subitem title
  `` `${line.designName}: ${line.productName}` `` (`deal-item.ts:607`) → **`line.productName`** only.
  `designName` defaults to the decoration name, so a decoration named "Custom Decoration" produced
  `Custom Decoration: {product}`. Jon: fix now so feature 1 ships on a correct structure.
- **Location → a NEW "Location" column** on the production board (**not** the title). Chris's "location
  becomes the garment title" is satisfied by a filterable column, not the item name — Jon owns the
  board structure. ⚠️ **confirm this framing with Chris.**
- **Decoration → the parent's existing `decorationMethods` dropdown**
  (`PRODUCTION_COLUMNS.decorationMethods` at `column-ids.ts:61`, currently unfilled).
- **Proposed column mapping (build-time, to confirm):** also fill `fallbackSku` (currently unfilled)
  from the line SKU; and evaluate a **per-subitem decoration column** instead of the parent dropdown —
  decoration is per-line, and a single parent dropdown flattens a mixed-decoration order. Concrete
  mapping to come before wiring.

### Critical-path dependencies & risks (not builds — chase in parallel)

- **Chris's MTF location CSV** = single point of failure under no-fallback. **Get it today.**
- **MTF onboarding** (org + 60 stores + staff via the existing bulk-members import) — parallel ops
  track for go-live, separate from this build.
- **New Monday "Location" column** — creatable via the Monday MCP when ready.

### Still open (Jon / Chris)

- Chris to accept location-as-column (vs literally in the item name).
- Exact `quote_items` column name(s) + the dataset CSV format.
- Per-subitem vs parent decoration column (build-time recommendation pending).

---

## TL;DR — reframe from "12 builds" to five buckets

The single most important finding: **most of these are not net-new builds.** Several are already
shipped-but-dark, already-work-verify, or cheap extensions of shipped foundations. Only four are
genuinely greenfield.

| Bucket | Features | Why |
|---|---|---|
| **Already works — verify only** | 4 (multi-staff→location), 10 (display pricing) | The capability already exists in prod; the ask is likely a smaller refinement or a misconception. |
| **Cheap win on shipped foundation** | 6 (picking-fee tooltip), 9 (per-txn qty cap) | Fee logic + MOQ plumbing already exist; these mirror them. |
| **Finish / flip a dark feature** | 7 (hide tracker for stock), 8 (Starshipit stock dispatch) | Code exists/merged; needs a gate + a decision, not a build. |
| **Cheap because the column already exists** | 5 (per-SKU low-stock alerts) | `variant_inventory.reorder_point` exists per (org,variant,size) but is 100% unwired. |
| **Genuine net-new** | **1 (location dropdown), 2 (custom name)**, 11 (proof image), 3 (Stripe) | No existing mechanism to extend. 1+2 are the MTF critical path. |

### The highest-leverage architectural call: **build 1 + 2 as ONE feature**

> **⚠️ Superseded by the locked decisions above (grilling, 2026-07-22).** Under the hard 26 July MTF
> deadline with solo capacity, feature 1 ships **alone** pre-26; feature 2 **and** this unified
> abstraction move to the post-26 queue (feature 2 becomes the "second caller" that extracts the
> shared mechanism *then*). The reasoning below still holds for *how* to generalise later — just not
> for the 26th.

Features 1 (MTF location **dropdown**) and 2 (Trade Services **custom name**) are the *same underlying
mechanism* with two input types:

- both are a **staff per-product toggle** (S: product config),
- both add a **per-line input on the PDP** (P: `ProductDetailClient.tsx`),
- both put a **value onto the cart line** that (a) makes the line a distinct SKU/line and (b) flows
  into the **garment title → Monday**,
- the only differences: input type (**dropdown sourced from an org dataset** vs **free text, ≤15 chars**)
  and validation.

Building them separately means threading two divergent value-paths through the cart signature,
checkout submit, and **four duplicated Monday-title assembly sites that have no shared formatter**
(see Cross-cutting §A). Building them once — a generic **"product line-attribute"** concept with two
attribute *kinds* — is dramatically cheaper and leaves one code path to test. **This is the primary
recommendation.**

---

## Per-feature detail

### 1 + 2 — Product line-attributes (MTF location dropdown + custom name) — **NET-NEW, critical path**

**What Chris asked:**
- MTF: a **dropdown** on the PDP to choose a *location* (= the embroidery type/branch they get).
  Staff toggle on/off per product. The location list is **large (MTF ≈ 60–65 branches)** and should
  **sit at the organisation level**, imported once (CSV preferred) — *not* re-entered per product.
  Selected value becomes the garment title → Monday: *"Garment info - {dropdown value}"*.
- Trade Services: a **custom name** free-text field (≤ ~13–15 chars), staff toggle per product. Must
  make each name a **distinct line/SKU** (2× L "Chris" and 2× L "George" are two lines). Title →
  *"Garment info /name - {custom name}"*.

**Current state (grounded):**
- **No generic option/personalisation mechanism exists** on products or in the cart — greenfield
  (S product config has only dedicated boolean columns + the `product_type_activations` channel
  join-table + a minimal `specs` jsonb; a dead `products.customizable_features` jsonb exists with
  zero refs — do **not** revive it).
- Cart merge key is a single pure function: `lineSignature()` at
  [lib/cart/types.ts:188-198](../lib/cart/types.ts#L188-L198), used in exactly one place
  (`CartProvider.tsx:164-227`). Today "2× L" + "2× L" **merge** into qty 4. Threading an attribute
  value into that signature keeps distinctly-named lines separate.
- **Keep in step:** the server re-derives tier pooling independently — `tierAggregationKey` in
  `lib/checkout/submit.ts:382-389` must mirror any signature change (noted at `lib/cart/types.ts:165`).
- **"Variant" is colourway-only** post-SKU-collapse — size is already an order-line attribute, so a
  location/name slots in the same way (an order-line attribute, **not** a new SKU explosion in
  `product_variants`).
- Org-dataset home: the codebase convention is a **dedicated `organization_id`-scoped child table**
  (like `stores`, `org_decorations`), **not** `organizations.settings` jsonb (legacy/dead).
- CSV import has a proven template: `S:src/lib/b2b-accounts/bulk-members.ts` (`parseMembersCsv`, alias
  mapping) → dry-run preview route `S:src/app/api/b2b-accounts/[id]/members/bulk/route.ts` →
  `BulkUploadDialog.tsx` two-step confirm. Model the location-dataset importer on this.
- Monday title: two boards, inline templates, **no shared formatter** — `production-job.ts:84`
  (`${product_name} — ${variant_label} × ${qty}`) and `deal-item.ts:200`; `variant_label` is assembled
  at 4 call sites (`submit.ts:199`, `ordering-periods/[id]/confirm`, `orders/[id]/retry-monday-push`,
  `quotes/approve.ts`).

**Build (unified):**
1. **S — line-attribute config on the product** (Details tab / `CatalogueItemEditor`): a per-product
   attribute with `kind ∈ {org_dataset_dropdown, free_text}`, an on/off toggle, and (for free_text) a
   max-length; (for dropdown) a pointer to an org dataset. Persist as a small child table (mirror
   `product_type_activations` shape) rather than jsonb.
2. **S — org line-dataset table** (`organization_id`-scoped child table + CRUD `[orgId]` sub-route +
   CSV importer modelled on bulk-members). Holds MTF's 60 branch values once.
3. **P — PDP input** in `ProductDetailClient.tsx` (dropdown fed by the org dataset, or a ≤15-char text
   input), gated by the product toggle; block add-to-cart until required attributes are set.
4. **P — thread the value** onto `CartLine` (`lib/cart/types.ts:39-113`) → into `lineSignature()`
   (distinct lines) → into the checkout body → keep `tierAggregationKey` in step.
5. **S/P — one shared garment-title formatter** (new) consumed by both Monday templates + the 4
   label sites, so the *"Garment info - {value}"* / *"Garment info /name - {value}"* format lives in
   one place. (Pays for itself here and de-risks all future title changes.)

**Effort:** **L** (the batch's biggest). Suggested internal order: ship **custom-name (2)** first —
it's the same pipeline minus the org-dataset + CSV — then add **dropdown (1)** as the second attribute
kind (adds the org table + importer). That gets Trade Services unblocked fast and de-risks the harder
MTF piece.

**Decisions needed:** (a) confirm the exact title formats & char limit (Chris said 13–15 → pick 15);
(b) does a location dropdown value make lines distinct like custom-name does? (assume yes); (c) reuse
`stores` for MTF locations or a dedicated dataset table? — **recommend dedicated** (stores carries
ship-to/address semantics; the MTF "location" is a garment-personalisation label, not a delivery
destination), but confirm MTF isn't also expecting these to drive ship-to.

---

### 3 — Reburger franchise Stripe payment gateway — **NET-NEW, post-26th**

**Current state:** zero Stripe/payment-gateway code in either repo. Checkout is **invoice-on-account**:
place order → **draft** Xero invoice → billed off-platform per net-terms. A `payments` table exists in
the schema (`stripe_session_id`, `payment_intent_id`, `is_deposit`) but is **vestigial/unwired** and
keyed to `quote_id` not `order_id`. A `tenant_type` enum (`franchise | studio_plus_inventory | studio`)
is already threaded through checkout (`CheckoutClient.tsx:49,60,96`) — the natural **per-franchise gate**
for Reburger.

**Build:** greenfield end-to-end — Stripe session/PaymentIntent creation route, a card step in
`CheckoutReviewClient` before `POST /api/checkout`, a payment webhook receiver, and wiring `payments`
→ `orders`. Unlike the best-effort Xero/Monday side-effects, **payment capture needs blocking
success/failure semantics** — a real design decision, not just wiring.

**Effort:** **M–L.** Correctly deferred past the 26th. **Decision:** deposit-only vs full capture; which
franchises; does an order still raise a Xero draft when card-paid?

---

### 4 — Multiple staff under one location/district — **ALREADY WORKS (verify) + optional district rollup**

**What Chris asked:** ensure multiple staff can sit under one office/location so an admin can format
ordering data by district (e.g. 10 Dunedin staff under that location). *"Please check."*

**Answer: the core already works.** `user_organizations.default_store_id` is an ordinary FK with **no
uniqueness constraint** — many staff rows can share one `stores` row today. `stores` (S baseline
:12022) is a real org sub-unit (UI literally labelled "Locations"), managed on both staff
(`StoresPanel.tsx`) and customer (`AccountClient.tsx` "Add Location") sides, and **already flows into
the Past-Orders CSV** (`P:lib/orders/past-orders-csv.ts:97-99` emits a `ship_to_store` column). The
bulk-member CSV importer already onboards "one store + N staff per branch" in one pass.

**The only real gap** is a grouping level *above* `stores`: there is **no `district`/`region` entity**
(the NZ_REGIONS list is just free text populating `stores.state`). If "format data by **district**"
means rolling multiple branches up into a district, that's a small net-new grouping table +
group-by in the export. If it just means "per location," it's **done** — verify with Chris.

**Effort:** **S** (verify) → **S–M** if a district rollup is actually wanted.

---

### 5 — Per-SKU / per-size low-stock email alerts — **CHEAP (column exists), alert path net-new**

**What Chris asked:** a stock alert on a SKU line, per size, with a staff-chosen threshold qty,
emailing the order admin(s). E.g. small tee = 5, large = 25, MTO tote = 100.

**Current state:** `variant_inventory.reorder_point` (nullable int) **already exists, keyed per
`(variant_id, organization_id, size_id)`** — so **per-size thresholds are already schema-supported**,
exactly matching the ask. But it is **100% inert**: no UI reads/writes it, no cron scans it, no alert
exists (grep-confirmed; the only reference is a TS type). `variant_reorder_requests` is a *manual*
customer restock request, not a threshold alert. No `order_admin` recipient concept exists.

**Build:** (a) a `reorder_point` input per size in `S:VariantGrid.tsx`/`InventoryTab.tsx`; (b) a
scheduled scan (add a job to the cron baseline, or a stock-write trigger) for `stock_qty −
committed_qty ≤ reorder_point`; (c) fan-out email to the org's admins. **Recipient gotcha:** the
existing "notify org admins" pattern (`S:lib/email/inventory-updated.ts` `notifyOrgOfInventoryUpdate`)
queries `role='org_admin'` but **emails only the first one found** — fix to iterate all, or (cleaner)
add a proper recipient model mirroring the `b2b_account_managers` join-table + primary-flag + RPC
pattern. `order_email_log` is keyed to `order_id`, so a non-order alert needs a nullable `order_id`
or its own log table.

**Effort:** **M.** **Decisions:** who are "order admins" (all `org_admin`s vs a configurable list?);
scan cadence; de-dupe so it doesn't email every run while below threshold.

---

### 6 — Picking-fee breakdown tooltip on cart/checkout — **CHEAP WIN**

**Current state:** the picking fee is **already computed and shown**. Tiers live in one constant —
`PICKING_FEE_BANDS` at [lib/pricing/picking-fee.ts:7-13](../lib/pricing/picking-fee.ts#L7-L13)
(**$0–99 → $35, $100–199 → $30, $200–299 → $25, $300–399 → $20, $400+ → $15**), charged NZ +
stock-on-hand only, rendered at `components/checkout/BilledOrderSummary.tsx:153-155`.

**Build:** a tooltip/lightbox reading `PICKING_FEE_BANDS` directly, mounted next to the fee row in
`BilledOrderSummary.tsx`. Optionally also surface it in the **cart drawer** — but the drawer doesn't
currently pass `pickingFee` into `computeOrderBreakdown()` (`CartDrawer.tsx:41-52`), so that variant is
a touch more work.

**Effort:** **S.** **Decision:** cart drawer + checkout, or checkout only?

---

### 7 — Remove order-tracker access for stock-on-hand orders — **FINISH (access-layer only)**

**What Chris asked:** remove the ability to access the order tracker for "Stock on hand" orders.

**Current state:** `orders.order_type` (`stock_on_hand | purchase_order`) exists and is stamped at
submit (`classifyOrderType()`, `P:lib/orders/order-type.ts`). Mixed carts already **split into two
orders**, so a pure-stock order is cleanly one `stock_on_hand` order. **But the tracker is
order-type-blind**, and there's a structural gap: `job_trackers` has **no `order_id`/`order_type`** —
only a `quote_id → orders` hop. Two independent gates today (both role-based, not order-type):
list page/API (`isOrgAdmin`) and the **token deep-link** (ownership-based — *bypasses* the nav gate;
reachable from the milestone **email** link).

**Build:** (1) denormalise `order_type` onto `job_trackers` at creation
(`P:lib/orders/job-tracker.ts`) so it's reachable; (2) branch **all six entry points** — list page
guard, `/api/order-tracker`, token-lookup authorization, the nav item, the confirmation-page "Track
this order" CTA (`ConfirmationView.tsx:377`), and the milestone-email link. **Do NOT touch** the
Monday webhook / status engine / `createJobTrackerShellForOrder` — staff still need those to fulfil
stock orders; this is purely customer-facing access.

**Effort:** **S–M.** **Decision:** does this apply to **admins too** (order-type gate), or is it just
the staff-role hide that Spec A item 5 already specced? Chris's wording ("for stock-on-hand orders")
reads as order-type, i.e. even admins shouldn't *track* a stock order → confirm.

---

### 8 — Starshipit webhook / order creation for stock-on-hand dispatch — **FINISH + external decision**

**What Chris asked:** set up webhook order creation for stock-on-hand in the "Print Room Dispatch"
Starshipit account.

**Current state:** the **entire portal-owned Starshipit pipeline already exists and is merged to
`main`** — `P:lib/starshipit/*` (config naming the consolidated "Print Room Dispatch" account,
push-at-placement, eligibility, client) + the inbound webhook `P:app/api/webhooks/starshipit/route.ts`
(matches on `job_reference`/`quote_number`/`tracker_token`, writes `tracking_info` +
`production_updates`, "supplement not supersede"). It is **dark**: `STARSHIPIT_ENABLED` unset and the
four env vars absent here. Today it's order-type-blind — if flipped on, **both** order types push
identically (the push call at `submit.ts:~1938` deliberately does *not* pass `orderType`).

**Build:** (a) add an `orderType`/`isStockOnHand` rule to `lib/starshipit/eligibility.ts` and pass the
already-computed `orderType` at the submit call site; (b) set the four env vars; (c) flip the flag.
**Blocking external decision (not code):** stand up a fresh portal-owned Starshipit account vs
consolidate the existing "Print Room Dispatch" — the legacy studio receiver risks
double-registration (629 old `starshipit_webhook_logs` rows, all `unmatched`). Also define precedence
where the Starshipit webhook and the Monday webhook both write the same `job_trackers` row
(precedent exists: supplement-not-supersede).

**Effort:** **S–M** *once the account decision is made* — the account decision is the real gate.

---

### 9 — Per-product quantity cap per transaction (soft warning) — **CHEAP WIN**

**What Chris asked:** a per-product limit per transaction (e.g. 20 totes, 20 tees) — over it, just a
pop-up warning as they add to cart ("you're over the limit").

**Current state:** MOQ (**minimum**) is enforced in many layers (`lib/shop/effective-moq.ts`, PDP
gate, cart red banner, server `MoqViolationError`). There is **no maximum** anywhere — every
`max_quantity` hit is a volume-pricing bracket ceiling, not an order cap; qty inputs have no `max`.

**Build:** add a per-product **max** config (a `b2b_catalogue_items` override column or a `products`
column — mirror how `moq`/`moq_override` resolve) and a **soft** check that mirrors the MOQ pattern at
`ProductDetailClient.tsx:1064-1191` (PDP, pre-add) and `CartTable.tsx` (cart-side, aggregated per
`productId`). Chris wants a **warning, not a hard block** — so surface a dismissible dialog/toast, do
not disable checkout.

**Effort:** **S–M.** **Decision:** where the limit is configured (global default vs per-product vs
per-org), and confirm it's warn-only (not enforced server-side).

---

### 10 — "Display pricing" on the product page — **LIKELY ALREADY DONE (clarify)**

**Current state:** pricing is **already shown** on the PDP — unit price + breakdown
(`PriceBreakdown.tsx`), the full volume ladder, prepaid original price; the grid shows a price range.
There is **no hidden-price mode/flag** anywhere; the only non-price state is the `"Price on request"`
fallback when an item has no resolvable ladder/base cost (`lib/shop/effective-price.ts`).

**So the ask is probably one of:** (a) already satisfied; (b) really about reducing the *"Price on
request"* rate — a **data** problem (missing pricing ladders), not UI; or (c) a specific tenant/role
where price data is incomplete. **Clarify with Chris which he means before scoping** — this may be a
5-minute confirmation, not a build.

**Effort:** **XS–S** (likely verification / data fix).

---

### 11 — Artwork proof-image designation → Monday artwork column — **NET-NEW, medium-term**

**What Chris asked (his own "not urgent" framing):** a proof-image indicator on the product portal
(mark one image as *the proof* alongside the hero), synced to the artwork column in Monday.

**Current state:** `product_images` has **no proof flag** (`image_type` CHECK is
`product|marketing|swatch`); "which image is the mockup" is *inferred* today
(`resolveMasterImages()`, `pickMockupUrl()`). The precedent to mirror is on the catalogue side:
`b2b_catalogue_item_images.is_published` + `source='staff_pick'`.

**Build:** add a boolean (e.g. `is_proof`) to `product_images`, extend the image POST/PATCH bodies +
UI control, repoint `resolveMasterImages()`/`pickMockupUrl()` to prefer the flagged row, and push the
proof URL into the Monday artwork column (`S:lib/monday/column-ids.ts`). Chris himself parked this as
**medium-term** — schedule after the 26th blockers.

**Effort:** **M.**

---

## Cross-cutting notes

**A. There is no shared garment-title formatter.** Two Monday boards with inline templates
(`production-job.ts:84`, `deal-item.ts:200`) + 4 duplicated `variant_label` assembly sites. Features
1, 2 (and 11's artwork push) all touch titles — introduce **one** formatter as part of the 1+2 build
and route everything through it.

**B. Schema-owner rule (S).** Every new table/column below is a **migration file in
`S:supabase/migrations/`, applied from the file** — never via dashboard/MCP (AGENTS.md). P is a pure
consumer. New schema across this batch: line-attribute config + org line-dataset (1+2),
`order_type` on `job_trackers` (7), per-product max qty (9), `product_images.is_proof` (11); plus
*wiring* (no new column) for `reorder_point` (5). There's no generated `database.types.ts` — types are
hand-written per domain, and new product columns must be added to the `normaliseCreate`/`normaliseUpdate`
allow-list in `S:src/lib/products/schema.ts`.

**C. Onboarding vendor sync.** If any shared logic lands in `vendor/print-room-onboarding/`, it's
staff→customer directional (`npm run sync:onboarding-push`). Unlikely for this batch but note it.

**D. `tsc` baseline is not zero** (memory: ~5 pre-existing errors in P) — don't treat a non-zero
type-check as introduced by this work.

---

## Recommended sequencing vs 26 July

1. **Pre-26 — MTF/Trade Services blockers (critical path):** the unified **line-attribute** build
   (2 custom-name first, then 1 dropdown+org-dataset+CSV). This is the migration blocker Chris named.
2. **Pre-26 — cheap wins in parallel (low risk, high visibility):** 6 (picking-fee tooltip),
   9 (qty-cap warning), 10 (verify/clarify display pricing), 4 (verify multi-staff→location; add
   district rollup only if Chris confirms he needs it).
3. **Pre/just-post-26 — finish dark features:** 7 (tracker gate — small; do it if MTF stock orders are
   going live), 8 (Starshipit — **gated on the account-consolidation decision**, so chase that
   decision now even though the code is nearly done).
4. **Post-26 — medium-term:** 5 (low-stock alerts), 11 (proof image).
5. **Post-26 — explicitly deferred:** 3 (Reburger Stripe).

## Open decisions to take back to Chris / Jon

- **1/2:** exact title strings + 15-char limit; do dropdown selections split lines like custom-names;
  dedicated dataset table vs reuse `stores`.
- **4:** is "district" a real rollup above stores, or is per-location (already working) enough?
- **5:** "order admins" = all `org_admin`s or a configurable recipient list? scan cadence?
- **7:** order-type gate for **everyone** (incl. admins), or just the existing staff-role hide?
- **8:** **the blocking one** — fresh Starshipit account vs consolidate "Print Room Dispatch."
- **9:** where the max is configured; confirm warn-only (not server-enforced).
- **10:** what "display pricing" means given pricing already shows.
- **3:** Stripe scope — deposit vs full capture; which franchises; Xero interplay.
