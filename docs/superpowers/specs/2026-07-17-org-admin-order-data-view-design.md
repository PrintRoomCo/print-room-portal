# Org-admin order data — view, sort, export — design

**Date:** 2026-07-17
**Branch:** `feat/org-order-data-view`
**Origin:** Chris (2026-07-17, Slack): "configuring the organisation order data so
the admin can view it and being able to sort and export it" — the next step after
the checkout billed-total parity and welcome-email work.

## Relationship to the order-tracker epic

The 2026-07-08 Phase 1 spec (`2026-07-08-order-tracker-phase-1-org-admin-visibility-design.md`)
fixes org-admin visibility of **job trackers** — the status surface. This spec is
**not** Phase 1b of that epic and does not touch the tracker read path.

**Recommendation: ship as a separate spec on its own branch.** The two share only
`lib/portal-data.ts` at file level — Phase 1 changes `fetchOrderTrackerDataForUser`
and `lib/job-tracker-queries.ts`; this spec changes `fetchPastOrdersForUser` and the
My Collections UI. Disjoint functions, no merge hazard, no ordering dependency;
either can ship first. Folding this into the (already-written, awaiting-review)
Phase 1 spec would couple an approved-and-waiting change to fresh review for no
shared code. Phase 2 (portal owns Monday) is write-path Monday sync; nothing here
collides with it.

Why the tracker can't be the base for an order-data view (live DB, 2026-07-17):
5 of 22 orders have **no** job tracker (`orders` ⋈ `job_trackers` on `quote_id`:
purchase_order 15/20 tracked, stock_on_hand 2/2), and trackers carry no value
fields. The `orders`/`quotes` tables are the only complete source. This also
answers Chris's separate "stock-on-hand orders placed by staff users" question:
stock orders live in `orders` like any other and DO get trackers — they are covered
by this view (all order types) and, for status, by the tracker once Phase 1 lands.

## Problem

Chris's ask has three parts: org-wide **view**, **sort**, **export**. The view
half-exists; sort and export do not; and the existing view has two data defects.

**What already shipped (2026-07-15, Spec-A "Past orders"):** `/my-collections`
renders a Past Orders list from `getPortalPastOrdersData` → `fetchPastOrdersForUser`
(`lib/portal-data.ts`), with role scoping: `org_admin` sees the whole org, staff see
their own. Filters: status + date range. Limits:

1. **`stock_on_hand` only** — `.eq('order_type', 'stock_on_hand')`. The 20
   purchase_order orders (91% of all orders) are invisible.
2. **Staff scoping is dead on arrival** — staff are filtered by
   `.eq('quotes.created_by', userId)`, but `quotes.created_by` is **NULL on all 22
   ordered quotes** (live DB, 2026-07-17; checkout never stamps it). Staff see
   **zero** past orders today. `quotes.customer_email` is populated on 22/22.
3. **No sort, no export, no value columns rendered for scanning** — card stack UI.
4. **`billed_total` / `picking_fee` are NULL on all 22 quotes** — the parity
   columns are live in prod but nothing has populated them yet (parity code merged
   to main, deploy unconfirmed). Any money column needs the NULL fallback.

**Volumes (live DB, 2026-07-17):** 22 orders / 22 quotes total. Test Account 11,
Anytime Fitness 6, Hydro Surf 5. 2 org_admins across 2 orgs. Pagination and
server-side sort are non-problems at this scale.

## Decisions (locked with Jon, 2026-07-17)

1. **Surface = evolve Past Orders in `/my-collections`** (not a new route, not the
   tracker). Heading renamed "Past orders" → "Orders".
2. **Order set = every order for the org, both order types, including
   `awaiting-period-close` pre-orders** — a committed pre-order is order data an
   admin wants to see and export; the status column makes its state obvious.
3. **Money = both columns.** "Product value" (ex-GST goods) and "Billed" (what was
   invoiced — reconciles to Xero). Prepaid stock orders bill ~$0 + picking fee
   while consuming real product value; an admin running a prepaid programme needs
   both numbers. Both derive from the existing `billedFigures()` helper
   (`lib/checkout/billed-figures.ts`) — the same function the confirmation page and
   customer email use, so the three surfaces can never disagree. Its NULL rule is
   the shipped convention: `billed_total` NULL (pre-parity-deploy order) ⇒ billed
   falls back to the goods value.
4. **Granularity = order-level rows on screen; export offers both.** The table is
   one row per order. Export produces either an order-summary CSV or a line-item
   CSV (one row per `quote_item`, order fields repeated — pivot-friendly).
5. **UI = one sortable table for everyone.** Staff and admin share the component;
   staff just see fewer rows. Cards are replaced.
6. **Sort = client-side** over the loaded array. Zero new round trips for the page
   (Vercel iad1 ↔ Supabase syd makes every server round trip ~Pacific-crossing);
   at 22 orders total this is not close to a limit. Revisit threshold recorded
   below.
7. **Export = server-generated CSV** via a new API route. The line-item export
   needs `quote_items`, which the list payload doesn't carry — generating
   server-side keeps the page payload small and the export always-fresh and
   complete.
8. **Permissions = org_admin org-wide, staff own-orders. No location-manager
   scoping.** Store attribution is per-line (`quote_items.ship_to_store_id`); "an
   order belongs to a store" is not well-defined, there is no location-manager
   role in `user_organizations`, and the existing `TODO(store-filter): blocked on
   store-attribution decision` stands. Deferred.
9. **Staff scoping bug fixed here, via `customer_email`.** Staff filter becomes
   `.eq('quotes.customer_email', userEmail)` — the same own-orders rule
   `getJobsForUser` applies. Email is safe for OWN-orders scoping because the
   query constrains `quotes.organization_id` to the member's org first (the Phase 1
   prohibition on email is about **org**-level tenancy, where a shared email could
   leak across orgs — not the case here). Root-causing checkout to stamp
   `created_by` (+ backfill) is a follow-up, not this spec.

## Approach

### Data — `fetchPastOrdersForUser` (`lib/portal-data.ts`)

- Remove `.eq('order_type', 'stock_on_hand')`.
- Add to the select: `orders.order_type`, and `quotes.picking_fee`,
  `quotes.billed_total` (`subtotal` is already selected).
- Staff branch: replace `.eq('quotes.created_by', userId)` with
  `.eq('quotes.customer_email', userEmail)` (the fetcher already receives the
  email). Admin branch unchanged (`quotes.organization_id` only).
- `mapPastOrderRow` / `PortalPastOrder` gain: `orderType`, `placedBy`
  (= `quotes.customer_email`), `productValue` and `billed` (both via
  `billedFigures()`), `pickingFee`.
- Everything else — org membership read, stores read, tracking overlay,
  `unstable_cache` on `accountData` tags, `ownerKey` — unchanged.

### UI — `MyCollectionsClient.tsx` (+ extracted table component)

- Heading "Past orders" → "Orders".
- Replace the `OrderCard` stack with a sortable table:
  **Date · Order ref · Placed by · Type · Status · Product value · Billed**.
  Clicking a header toggles asc/desc; default `created_at` desc. Sorting is a pure
  helper (`sortPastOrders` next to `filterPastOrders` in
  `lib/orders/past-orders-filter.ts`) so it unit-tests without the component.
- Rows keep the existing detail link, `/my-collections/[collectionId]` (keyed on
  `quoteId ?? orderId`, as the cards do today). (`/orders/[id]` has only proof
  pages — no order detail route exists there.)
- Keep the status and date-range filter pills. Add a "Placed by" filter (distinct
  `placedBy` values) rendered only when `isCompanyWide`. The blocked store-filter
  TODO stays as-is.
- Two export buttons: **Export orders** and **Export line items** — plain anchors
  to the export route with the current filters as query params (no fetch-and-blob
  client code; the browser handles the download).
- No pagination. **Revisit threshold:** if any org exceeds ~500 orders, move sort
  + pagination server-side; until then the whole set ships to the client exactly
  as it does today.

### Export — new route `GET /api/past-orders/export`

Query params: `granularity=order|line` (required), `status`, `from`, `to`
(optional, same semantics as the on-screen filters). **The org is never a
parameter** — it is derived server-side from the session, exactly like the list.

1. Auth: `getPortalUser()`; 401 if absent. Membership read; staff get their own
   orders (email-scoped), org_admin gets the org. Reuses the same scoping code as
   `fetchPastOrdersForUser` (extract the query-builder into a shared helper so the
   list and the export cannot drift on who sees what).
2. Queries (batched, no per-row round trips — round-trip budget ≤ 4):
   membership → orders+quotes → (line granularity only) `quote_items
   .in('quote_id', quoteIds)` → stores for ship-to names (already one org-keyed
   read). Uncached: an export must reflect the DB now, not the list cache.
3. CSV: UTF-8 **with BOM** (Excel double-click-opens it correctly, including any
   macron/accented names), CRLF line endings,
   `Content-Disposition: attachment; filename="orders-<orgcode>-<yyyy-mm-dd>.csv"`.
   Money as plain numbers (no `$`), dates ISO `yyyy-mm-dd`.
4. Columns
   - `order`: order_ref, placed_at (date), placed_by, order_type, status,
     product_value_ex_gst, picking_fee, billed_ex_gst, currency.
   - `line`: the order columns above repeated per row, then product_name,
     size_label, quantity, unit_price, line_total, qty_from_stock, qty_to_make,
     ship_to_store. Order totals repeating per line is deliberate — it pivots
     cleanly in Excel.
5. Money columns use `billedFigures()` — identical numbers to the table, the
   confirmation page, and the customer email.

### Perf note (iad1 ↔ syd)

The page itself adds **zero** round trips: same single cached fetcher, sort and
filters run in the browser. The export route is a fresh function invocation with
≤ 4 sequential queries (~1.2s worst case cross-Pacific) behind an explicit user
click on a file download — acceptable, and it disappears when the syd1
co-location fix lands. Nothing in this design assumes fast SSR round trips.

## Security

These queries run on the service-role client (RLS bypassed), so — same posture as
the Phase 1 spec — **the scoping query is the security boundary**:

- Admin scope: `quotes.organization_id = membership.organization_id`, membership
  resolved server-side from the session. Staff scope: that AND
  `customer_email = session email`.
- The export route takes no org/user identifiers from the client; filter params
  can only narrow the already-scoped set.
- Extracting one shared query-builder for list + export means a future scoping
  change cannot fix one surface and miss the other.

## Testing (TDD, RED first)

- **Scoping** (extend `past-orders.scope.test.ts`): admin sees both order types
  org-wide incl. `awaiting-period-close`; staff see own orders by email (the
  current created_by test flips from asserting the dead behaviour); cross-org
  rows excluded; no-membership user → empty.
- **`sortPastOrders`**: each column, both directions, stable on ties, null-safe
  (`billed` on a pre-parity row).
- **Export route**: 401 unauthenticated; staff get only their rows; admin CSV
  contains all org orders; `granularity=line` emits one row per quote_item with
  order fields repeated; NULL `billed_total` falls back to goods value; BOM +
  Content-Disposition present; filter params narrow the set.
- `next build` green (tsc baseline is 5 pre-existing errors, not 0).
- **Manual smoke** as `hello@theprint-room.co.nz` (AF org_admin): /my-collections
  shows all 6 AF orders in the table, sort by Billed works, both exports open in
  Excel with correct columns.

## Out of scope / unchanged

- **Order-tracker org-admin visibility** — Phase 1 spec, independent branch.
- **Location-manager roles / store filter** — blocked on the store-attribution
  decision; TODO stays.
- **Checkout stamping `quotes.created_by` + backfill** — the root-cause fix for
  the placed-by data model; follow-up ticket, not needed once email scoping lands.
- **Xero reconciliation beyond showing `billed_ex_gst`** (no invoice-number
  matching, no GST-inclusive columns in v1).
- **Pagination / server-side sort** — below the ~500-orders-per-org threshold.
- **XLSX export** — CSV+BOM opens in Excel; native XLSX only if Chris asks.
- No DB migration, no RLS change, no schema change of any kind.
