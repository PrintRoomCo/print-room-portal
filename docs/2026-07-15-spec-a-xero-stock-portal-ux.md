# Spec A — Xero, Stock Handling & Portal UX (build now)

> **Scope:** the immediate build. Derived from the reconciled working spec
> [`2026-07-15-xero-stock-handling-integrations.md`](./2026-07-15-xero-stock-handling-integrations.md)
> after a `/grilling` decision session on 2026-07-15. Everything here is decided and
> implementation-ready. Deferred work lives in
> [`2026-07-15-spec-b-dispatch-integrations.md`](./2026-07-15-spec-b-dispatch-integrations.md).
>
> **Repos:** **P** = `print-room-portal` · **S** = `print-room-staff-portal`

---

## Decision ledger (from grilling)

- **Order-type signal:** add `orders.order_type` enum, stamped at submit from the cart lines. **Mixed cart → `purchase_order`** (interim, until Spec B / F1 splits them).
- **Prepaid is deferred to Spec B.** For Spec A, **every non-test order is invoiced** — no paid/not-paid branch anywhere. When prepaid ships, its tag lives on `b2b_catalogue_items` (recorded, not built here).
- **Xero:** draft quote for **every non-test order**, PO or stock-on-hand alike; POs override the org prepay-terms gate; **no admin-role gate**; test/demo orgs are a hard skip.
- **Stock orders still push to Monday**, annotated with a note (reversed from the original "skip Monday"). This keeps the Monday-fed courier-tracking pipe alive so item 10 stays in Spec A.
- **Orders IA = two-surface split**, no new page. Project tracker (PO/pre-order) is admin-only; Past orders (stock) is staff-visible and org-wide for admins; both get filters.
- **Pill stays permission-based** (not hard admin-only); the catalogue FilterRail "Ordering mode" filter is gated to match.
- **Per-unit price** shows in **both** modes, sourced from the existing computed price.
- **Demo payment terms** suppressed at checkout via `organizations.is_test`.
- **Order-placed notification** → Slack incoming webhook (primary) + email fallback to `charlotte@theprint-room.co.nz` (test sends → `jamie@theprint-room.co.nz`).
- **Login-help mailto** → `jamie@theprint-room.co.nz`.

**Out of scope (→ Spec B):** Starshipit (item 12), split mixed orders (F1), org-admin self-serve invites (F2), the prepaid tag + customer-facing prepaid display + prepaid Xero handling (item 2 & Chris's follow-up), picking fees.

---

## Foundation — build first

### F-1. `orders.order_type` enum

Single source of truth that items 10, 11, 13 and 15 all read.

- **Migration (P or shared DB):** `ALTER TABLE orders ADD COLUMN order_type text NOT NULL DEFAULT 'purchase_order' CHECK (order_type IN ('stock_on_hand','purchase_order'))`.
- **Stamp at submit:** in `submitCustomerOrder()` (P `lib/checkout/submit.ts`), derive from the cart lines — **all lines `fulfilment_type === 'stocked'` → `stock_on_hand`, else `purchase_order`.** The `drawsStock` predicate at `submit.ts:1522` already computes "any stocked line"; add the mirror "all stocked line" and persist it on the `orders` row (and echo onto `job_trackers` if useful for the Past-orders query).
- **Interim mixed rule:** a cart mixing `stocked` + `made_to_order` yields **one** order today (F1 will later split it) → classify as `purchase_order` so it never drops out of the Monday/production path.
- **Acceptance:** a pure-stock cart writes `order_type='stock_on_hand'`; any made-to-order line writes `purchase_order`.

---

## Build items

### 1 + 9. Per-unit price on the PDP summary (both modes)

Items 1 and 9 unify: show the per-unit price in **both** ordering modes, from the price the engine already computes.

- **Files (P):** `components/shop/PriceBreakdown.tsx:24-53` (add the row), `components/shop/ProductDetailClient.tsx:1362-1404` ("Your order" summary). Source = `unitEffective` / `pricing.unit_price` (`lib/pricing/types.ts:17`, `lib/pricing/pricingMath.ts:16-29`) — already fetched, independent of fulfilment type.
- **Change:** add one "Per unit" row to the PDP price panel, rendered in both `isInventoryMode` and `!isInventoryMode`. Supersedes item 1's original "PO-only" gate.
- **Acceptance:** with a qty selected, the summary shows a correct per-unit figure for both a stocked and a made-to-order product.

### 3 + 10 + 5. Orders information architecture (two-surface split)

**Surface 1 — Project tracker (`/order-tracker`, `/tracking`) → admin-only.**
- Made-to-order / purchase-order + pre-order production & courier tracking, **with** reorder.
- **Item 5 (hide from staff):** set `requiresOrgAdmin: true` on the "Track my Project" nav item (P `lib/nav/portal-nav.ts:42-50`, same pattern as Inventory at `:73-81`) **and** add a server-side role redirect in `app/(portal)/order-tracker/page.tsx` + `tracking/page.tsx` (nav-hide alone doesn't stop a direct URL).
- Admin scope is already org-wide (`fetchOrderTrackerDataForUser`, P `lib/portal-data.ts:113-195`).

**Surface 2 — "Past orders" (`/my-collections`, renamed) → staff-visible.**
- **Item 10 rename:** nav label "Orders" → "Past orders" (P `lib/nav/portal-nav.ts:51-59`); heading `<h1>Orders</h1>` → "Past orders" (`MyCollectionsClient.tsx:93-95`).
- **Repoint:** show past **stock-on-hand orders** (`order_type='stock_on_hand'`) + courier tracking (`job_trackers.tracking_info`, Monday-fed — survives via item 11's push-with-note). **No reorder** (already absent — falls out free).
- **Scope (item 3 + side-fix):** today `fetchAccountDataForUser` (P `lib/portal-data.ts:224-266`) filters by `organization_id` only with **no role check** (staff over-see the whole org). Fix: **staff → their own stock orders; admin → whole org.** Wire the dead `canSeeAllOrgOrders` flag (`lib/company.ts:233`) here.
- **Item 3 "full visibility + filters":** satisfied by scope-above + **filter controls** (status / date / store) on both surfaces — **not** a third unified page.

**Acceptance:** a `staff` user sees Past orders (their own stock orders) and **cannot** reach the project tracker (nav hidden + direct URL redirects); an `org_admin` sees both, org-wide, with filters.

### 6. Hide "Available" column + "Stock available" badge in Purchase-order mode

- **Files (P):** `ProductDetailClient.tsx:1242` (multi-size "Available" column header — currently gated only by `multiSize`), and the `AvailabilityBadge` beside the `<h1>` (`:1169-1174`).
- **Change:** wrap both in `!isInventoryMode` so they hide when the pill is on Purchase order.
- **Acceptance:** toggling the pill to Purchase order removes the Available column header and the "In stock (N available)" badge; Stock-on-hand mode is unchanged.

### 7. Pill gating (keep permission-based) + gate the FilterRail filter

- **Decision:** keep the existing permission model — `orderingOptions(fulfilment_type, effectivePermission(role, stored))` (P `lib/shop/fulfilment-mode.ts:59-65,83-94`). `org_admin` → pill; `staff` with no grant → no pill, forced stock-on-hand (matches the ask by default). Do **not** wire up the dead literal-role `pillsFor` helper.
- **Gate the catalogue filter:** the "Ordering mode" `<select>` (P `components/shop/FilterRail.tsx:70-81`) is currently ungated — hide it whenever the pill is hidden (same `stock_only` condition), so item 7 doesn't leak through the grid filter.
- **Acceptance:** a default `staff` sees neither the pill nor the FilterRail mode selector; a granted staff member or admin sees both.

### 8. Demo-store pill (data config, no code)

- Demo member is already seeded `role:'staff'` + `ordering_permission:'both'` (S `seed-identity.ts:86-88`), so the permission half passes. Only **Classic Tee** currently has `b2b_catalogue_items.fulfilment_type_override='mixed'`; the other three demo products fall back to `products.fulfilment_type='made_to_order'` → pill can't render.
- **Change:** set the other three demo catalogue items to "Both" via the staff catalogue-item "Fulfilment mode" dropdown (S `CatalogueItemEditor.tsx:541-559`). Chris/Jamie can do this anytime; no deploy.
- **Acceptance:** all four demo products show the pill.

### 4. Demo payment terms — suppress at checkout via `is_test`

- **Problem:** the demo checkout renders "Payment terms: net30" even at 0% deposit because the block shows on `depositPct > 0 || paymentTerms` with no test-org branch (P `CheckoutReviewClient.tsx:81-82,442`). There is **no** boolean "terms" toggle to literally untick.
- **Change:** suppress the deposit/terms block in `CheckoutReviewClient` when `organizations.is_test === true` (the `is_test` read already exists in ~3 places). No new staff UI, no schema change.
- **Acceptance:** the demo org's checkout shows no payment-terms / deposit block; real orgs unchanged.

### 11. Stock-on-hand orders — push to Monday **with a note** (revised)

Reverses the original "don't push." Stock orders **still** push to the Monday Production board and **still** create a `job_tracker` (both needed to keep courier tracking flowing into Past orders).

- **Files (P):** `submitCustomerOrder()` step 4c (`submit.ts:1225-1274`, job-tracker shell) and step 5a (`:1281-1424`, Monday push). Keep both for stock orders; **add the note** to the Monday item when `order_type='stock_on_hand'`.
- **Note copy (fixed — prepaid deferred, so unconditional):**
  > **Stock-on-hand order — pull from existing stock. Do not produce. Xero draft quote raised — invoice before dispatch.**
- **Acceptance:** a stock-on-hand order appears on Monday carrying the note and produces a `job_tracker`; a purchase order is unchanged (no note).

> **Note:** the note's Xero line becomes *conditional* again in Spec B once prepaid exists (pre-paid → "no Xero invoice required").

### 13. Order-placed notification → Slack (primary) + email fallback

Replaces "email Charlotte." Fires at order placement for **every** order (dispatch wants visibility of all placements — can be scoped to stock-on-hand later if noisy).

- **Trigger (P):** at the existing order-submit notification point in `submit.ts` (alongside `:1469` / `:1657`), reusing the already-assembled summary (`emailLines` / `emailTotalAmount`, `submit.ts:1584-1626`) and a deep link built like `lib/email/tracker-notification.ts:27-28,50` (`PORTAL_ORIGIN` + `/order-tracker/<token>` from the step-4c tracker shell).
- **Primary target — Slack:** POST a Block Kit message (order ref, customer/org, line summary, total, deep link) to a Slack **incoming webhook**, URL in env `SLACK_PORTAL_WEBHOOK_URL`. No-ops cleanly if the var is unset (so the code ships before Chris creates the channel).
- **Fallback — email:** send to `charlotte@theprint-room.co.nz` (config env `DISPATCH_NOTIFICATION_EMAIL`, default that address). Reuse the Resend client + branded HTML shell. `sendEmail` takes a single `to`; **test sends must go to `jamie@theprint-room.co.nz`** (standing rule), production to Charlotte.
- **Acceptance:** placing an order posts to the Slack channel (when configured) and emails the dispatch address, both containing the summary + a working portal deep link.

### 14. "Trouble logging in" mailto

- **File (P):** portal sign-in page `SignInClient.tsx` (near "Forgot password?" `:193-200`).
- **Change:** add a "Trouble logging in?" link → `mailto:jamie@theprint-room.co.nz` (matches the existing staff-email convention at S `staff-invite.ts:180`). *(Flag if customer login-help should instead go to `hello@theprint-room.co.nz`.)*
- **Acceptance:** the sign-in page shows a "Trouble logging in?" mailto to `jamie@`.

### 15. Xero draft-quote rule (simplified)

Replace the v1 placeholder in P `lib/xero/eligibility.ts:35-42`. Prepaid is deferred, so the rule collapses:

> **Auto-create a draft quote when all of:** `XERO_ENABLED` on · org **not** `is_test` · no existing draft for this order. **Applies to every order type** — PO and stock-on-hand alike.

- Remove the `payment_terms !== 'prepay'` gate (POs override it; and since all orders are invoiced now, prepay-org no longer blocks).
- Remove the `no line is 'stocked'` kill-switch — **stock-on-hand orders now get drafts too** (they didn't in v1).
- **No admin-role gate** — fire regardless of `context.role`.
- Keep the `is_test` hard skip and the existing-draft idempotency check.
- **`XERO_ENABLED` rollout** is a separate go-live decision — the flag is currently deploy-dark and set in no committed env (`lib/xero/config.ts:16-19`); confirm before ship.
- Update the eligibility unit tests (`eligibility.test.ts`) to the new rule (the v1 "can not tell paid from unpaid stock" case is retired to Spec B).
- **Acceptance:** with `XERO_ENABLED` on, a non-test PO **and** a non-test stock-on-hand order each create exactly one draft quote; a test-org order creates none.

---

## Suggested build order

1. **F-1** `orders.order_type` (unblocks 10, 11, 13, 15).
2. **Quick UI wins:** 1+9 (per-unit price), 6 (hide column/badge), 7 (pill + FilterRail gate), 14 (login mailto), 4 (demo terms), 8 (demo data — Chris/Jamie).
3. **Orders IA:** 5 (hide tracker from staff) → 3+10 (Past orders repoint + scope + filters).
4. **Routing + notify:** 11 (Monday note) → 13 (Slack + email notification).
5. **Xero:** 15 (rule rewrite; confirm `XERO_ENABLED` rollout).

## Open threads (non-blocking)

- **Item 14 address:** `jamie@` assumed; switch to `hello@` if customer login-help should use the customer-facing default.
- **Item 13 scope:** notify on *all* placements vs stock-on-hand only — start with all, revisit if noisy.
- **`XERO_ENABLED`:** flip-to-live is a release-time call.
- **Slack channel + webhook** depend on Chris agreeing and (if at an app limit) freeing a Slack integration slot.
