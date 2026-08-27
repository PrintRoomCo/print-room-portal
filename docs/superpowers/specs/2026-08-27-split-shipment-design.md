# Split shipment — design spec

**Date:** 2026-08-27
**Status:** Approved design; fee schedule confirmed to 47 SKUs, extrapolation above that awaiting confirmation (see Open inputs)
**Repos affected:** `print-room-portal` (customer checkout, tracker, emails, Starshipit push), `print-room-staff-portal` (schema/migrations, staff order views, packing slips, amendment RPCs)

## 1. Summary

Customers ordering for a multi-location organisation add the *sum* of the order to the cart, then at checkout split each item's size quantities across multiple destination addresses. The order stays **one order** with **one org invoice** and **pooled volume pricing**, but each destination becomes a first-class shipment with its own dispatch status, tracking, packing slip, Starshipit push, and milestone emails.

## 2. Decisions of record

| Question | Decision |
|---|---|
| Who splits | Any buyer: org admins anywhere; staff/location-manager buyers only within their granted branches (no ad-hoc for them) |
| Address sources | Saved org `stores` + ad-hoc addresses (Google Places autocomplete), with an offer to save ad-hoc into the address book |
| Split scope | Order-level "Ships to" default + per-item split opt-in; unsplit items go 100% to the default |
| Allocation rule | A split item must be **fully allocated** (every size shows 0 left) before checkout is allowed |
| Address sets | Free per-item: each split item allocates across any destinations independently |
| Pricing | Pooled across the whole order — splitting never changes unit price |
| Freight | Per-destination **split fee** — every destination pays, including the first — banded by distinct SKU count at that destination (schedule in §6, NZD, converted for non-NZ destinations). **Replaces** the NZ stock-on-hand picking fee on split orders |
| Minimums | $500 PO minimum and MOQ evaluated on the **pooled** order, never per destination (requires pooling fix, §6) |
| Countries | Cross-country splits allowed; existing country×fulfilment partitioning fans them into per-country orders, destinations nested within |
| Line types | All: made-to-order, stocked, prepaid |
| Invoicing | **One Xero draft to the org contact** per (country) order; exploded lines aggregated back to one invoice line per product/size; split fees itemised |
| Tracking | Shipment-level: per-destination status, tracking number, milestone emails |
| Email recipients | Orderer + the destination's `stores.email` contact |
| Amendments | Address-swap only (change a destination's address, never move quantities); main amendment RPC hard-errors on split orders |
| UI | Sizes × destinations allocation grid per split item, live per-size remaining counters |
| Rollout | Org-level `split_shipping_enabled` flag, piloted per org (same pattern as decoration pooling) |
| Delivery | Four phases, each independently deployable (§9) |

## 3. Architecture (chosen: destinations-in-one-order)

**Chosen:** one order per country partition (as today), containing N `order_destinations` rows; `quote_items` exploded one row per (line × destination).

**Rejected — order per destination:** extending `partitionByCountryAndFulfilment` with a destination key would make every downstream consumer work unchanged, but produces N invoices (conflicts with one-invoice decision), N tracker cards, and N Monday items per customer-perceived order.

**Rejected — jsonb allocation note:** cheapest, but no rows to hang per-shipment status/tracking/emails on; cannot meet the shipment-level tracking decision.

Why this shape wins: it is the only one satisfying "one invoice + per-shipment tracking" simultaneously, and the schema already half-anticipates it (`quote_items.ship_to_store_id` per-line FK exists; confirmation page carries dead "Split across N delivery locations" copy at `app/(portal)/checkout/confirmation/[orderId]/page.tsx:319-329`).

## 4. Data model (all DDL in `print-room-staff-portal/supabase/migrations`)

### New table `order_destinations`
- `id uuid pk`
- `quote_id uuid` FK → `quotes`
- `position int` (stable 1..N ordering; drives `-D1/-D2` refs)
- `ship_to_store_id uuid null` FK → `stores`
- `custom_address jsonb null` — CHECK: exactly one of `ship_to_store_id` / `custom_address` set
- `address_snapshot jsonb not null` — resolved address at submit; later store edits must not rewrite history
- `split_fee numeric not null default 0`
- `status text` — `pending → dispatched → delivered`
- `starshipit_order_id text null`, `starshipit_pushed_at timestamptz null` — per-destination push idempotency
- `dispatched_notified_at / delivered_notified_at timestamptz null`
- `created_at timestamptz`

RLS mirrors `quotes` (org members read own org's rows; staff full access).

### Changed tables
- `quote_items`: new `destination_id uuid null` FK → `order_destinations`. A split line **explodes into one row per destination**, each with its own `qty`; `ship_to_store_id` still stamped (denormalised from the destination) so existing line-level consumers keep working. Unit price on each exploded row is the pooled tier price (existing snapshot behaviour).
- `order_shipments`: new `destination_id uuid null` FK — parcels/tracking rows attach to a destination.
- `quotes`: new `split_shipment boolean not null default false`. Split orders: `ship_to_store_id = NULL`, `shipping_address = NULL`, flag true. Single-destination orders unchanged. For flag-**on** orgs, even single-destination orders write one `order_destinations` row (uniform read path downstream); flag-**off** orgs' orders take the untouched legacy path and write none.
- `organizations`: new `split_shipping_enabled boolean not null default false` feature flag.
- `orders.shipping_address`: NULL for split orders, same branching rule.

### Invariants
- `SUM(exploded quote_items.qty per original line) =` the quantity the customer put in the cart (server-validated at submit).
- Every `quote_items.destination_id` on a split order is non-null; on the legacy path it may be null.
- A destination with zero allocated quantity must not exist.

## 5. Checkout flow (`print-room-portal`)

### UI
- **Per-line `ShipToRow` dropdowns are retired.** One order-level **Ships to** control on `/checkout`: saved stores + "one-time address" + **"Split shipment"**.
- Split mode reveals: (a) an order-level destinations list (add store from dropdown / add ad-hoc via Google Places; each ad-hoc has a "save to address book" tick that inserts a `stores` row), and (b) a "Split this item" toggle per cart item.
- A split item renders the **sizes × destinations grid**: rows = the item's size lines, columns = destinations selected for that item (free per-item subset of the order's destination list), cells = qty inputs, live "N left" per size. Checkout blocked until every split item shows 0 left on every size.
- Unsplit items implicitly allocate 100% to the order default destination.
- Staff-level buyers: destination choices limited to granted branches (`lib/checkout/branch-scope.ts`); no ad-hoc option rendered.
- Review page and `BilledOrderSummary` show per-destination breakdown incl. each destination's split fee.

### State
- Cart (`CartProvider`, `localStorage`) unchanged: `CartLine` stays one row per size with scalar `qty`. `CartApi.setShipTo` / `CartLine.shipToStoreId` become legacy-only and are removed once the flag is on for all orgs.
- Checkout state (sessionStorage, extending `checkoutReviewState.ts`): `orderShipTo`, `destinations: [{key, storeId | customAddress}]`, `splits: Record<lineId, Array<{destinationKey, qty}>>`.

### API contract (`/api/checkout/preview` + `/api/checkout`)
- Request grows `destinations[]` and per-line `allocations: [{destination_ref, qty}]` (absent = 100% to order default).
- Server validation: allocation sums equal line qty; every referenced destination exists; store destinations belong to the org; staff branch scope covers all destinations; ad-hoc addresses have street/suburb/postcode/country; org flag enabled.
- Server **explodes** allocated lines into per-destination lines *before* `partitionByCountryAndFulfilment` — each allocation lands in its destination country's partition. Existing single-destination path preserved when no split present.
- The three current single-destination guards are replaced, not merely deleted: `MixedShippingAddressError` (`lib/checkout/prepare.ts:278-283`), the all-or-none custom-address check (`app/api/checkout/route.ts:193-212`), and the preview route's mixed-custom rejection (`app/api/checkout/preview/route.ts:262-270`).

### Submit RPC
- `submit_b2b_order_for_country` gains `p_destinations jsonb`; inserts `order_destinations`, stamps `quote_items.destination_id` + denormalised `ship_to_store_id` in the RPC (not the post-RPC UPDATE), sets `quotes.split_shipment`, leaves header addresses NULL on split orders.

## 6. Pricing, fees, minimums

- **Tier pricing: no change.** Client pooling (`recomputeProductTierPrices`, keyed `productId::decorationSignature`) and server pooling (`pricing_pool_lines` → `prepareCustomerOrderPartition`) both ignore destination already.
- **MOQ pooling fix:** `lib/checkout/prepare.ts` currently builds `totalQtyByProductId` / `moqViolations` from the partition's own lines (`prepare.ts:416-531`). Seed them from `poolLines` (the same source tier pricing uses) so a product's run split across destinations/countries is judged on its pooled quantity.
- **$500 PO minimum pooling fix:** `evaluateMinimumOrder` currently receives the partition's own `goodsValueForBand` (`prepare.ts:1554-1567`). For split orders, evaluate against the pooled order's notional value, converted into the partition's billing currency via the existing display/billing currency conversion. One pooled order clearing $500 must never fail per-partition.
- **Split fee:** computed per `order_destinations` row — **every destination pays, including the first**. Banded by the count of **distinct SKUs** allocated to that destination, where a SKU = garment style + colourway + size (i.e. distinct `(product_id, variant_id, size_id)`; decorations and unit quantities never change the count):

  | Distinct SKUs at destination | Fee (NZD) |
  |---|---|
  | 1–10 | $15.00 |
  | 11–20 | $17.50 |
  | 21–30 | $20.00 |
  | 31–40 | $22.50 |
  | 41–50 | $30.00 |
  | each further block of 10 | +$2.50 (51–60 → $32.50, 61–70 → $35.00, … uncapped) |

  Source: Jon's fee spreadsheet (2026-08-27), which enumerates 1–47; the 41-band's upper edge and everything above 47 are an **extrapolation Jon has not yet confirmed** — bands of 10 continuing from the $30 step. Fees are NZD; non-NZ destinations get the checkout's existing display/billing currency conversion applied. On split orders the fee **replaces** `orderPickingFee` (`lib/pricing/order-picking-fee.ts` must return 0 when `quotes.split_shipment`); on single-destination orders the picking fee is untouched. Fee band table lives in code beside `lib/pricing/picking-fee.ts`, same pattern.
- Split fees are surfaced pre-submit in the preview totals per destination, persisted on `order_destinations.split_fee`, summed into `quotes.billed_total`, and itemised on the Xero draft.

## 7. Downstream consumers

| Consumer | Today | Change |
|---|---|---|
| **Starshipit push** (`lib/starshipit/push-order.ts`) | One push per order; idempotency on `orders.starshipit_pushed_at` | One push per destination; ref suffix `-D{position}` (mirrors existing `-C`/`-I` convention); idempotency and `starshipit_order_id` move to the destination row; items filtered by `destination_id` |
| **`order_shipments` webhooks** (`lib/starshipit/order-shipments.ts`) | Matched to `order_id` only | Matched through the destination's `starshipit_order_id` → stamp `destination_id`; destination `status` derived from its shipments |
| **Staff order detail / packing slips** (`staff-portal src/app/(portal)/orders/[id]`) | One `shipTo` from quote header | Branch on `split_shipment`: iterate destinations, one packing slip per destination listing only its exploded lines. Phase 1 ships a minimal read-only destination breakdown so staff are never blind |
| **Xero** (`lib/xero/draft-invoice.ts`) | Contact resolved from `lines[0]` store's `xero_contact_id` — the landmine | One draft to the **org** contact; never resolve contact from a destination. Exploded rows aggregated back to one invoice line per product/size/decoration; split fees itemised |
| **Monday** (`lib/monday/deal-item.ts`) | One `deliveryAddress` string on the card | One card per order; delivery section lists all destinations; exploded lines map onto existing per-line subitems |
| **Tracker** (portal current-orders) | Order-level status | Order card shows per-destination shipment status list |
| **Milestone emails** | Order-level | Per destination, labelled with the destination, to orderer + destination `stores.email` (ad-hoc destinations: orderer only). Timestamps on the destination row make sends idempotent |
| **Dispatch-desk email** (`lib/email/order-placed-dispatch.ts`) | One `deliveryAddress` | Lists all destinations with their allocations |
| **Confirmation page** | Dead "Split across N delivery locations" copy | Comes alive: renders per-destination address + line breakdown |
| **Amendment RPC** (`plan_order_amendment`) | Single top-level `ship_to_store_id`, would silently flatten a split | Hard-error on `split_shipment` orders. New small `swap_destination_address` RPC: change one destination's address (store or verified ad-hoc) only while that destination is un-dispatched; updates snapshot; re-push/void logic if already pushed to Starshipit but not dispatched |
| **Inventory ledger** (`ship_quote_line`) | Per `quote_item_id` | Works unchanged against exploded rows |

## 8. Traps (verified against code)

1. **Xero contact from `lines[0]`** (`lib/checkout/submit.ts:1156-1159`) — must be fixed before any multi-destination order exists, or spend is invoiced to the wrong contact.
2. **MOQ / $500 minimum are per-partition** while pricing pools — a split spanning partitions spuriously fails both until §6's fixes land. Fix must land **with** phase 1, not after.
3. **Header address is read in ~6 places** (`quotes.shipping_address`, `orders.shipping_address`, `job_trackers.quote_data.shippingAddress`, staff `read.ts`, Monday, dispatch email). NULLing it on split orders means every reader needs a `split_shipment` branch or a safe fallback; audit is part of phase 1.
4. **Staff-buyer branch guard** (`checkStaffBranchScope`) currently *throws* on multi-store lines — it must become "all destinations ⊆ granted branches", not be deleted.
5. **`checkoutReviewState` sessionStorage** carries the split between `/checkout` and `/checkout/review`; both pages must validate it against the live cart (lines added/removed in between invalidate allocations).
6. **Saved ad-hoc stores** enter the same `stores` table Starshipit and staff tooling read — they'll have no `xero_contact_id` (fine: org invoicing) but must satisfy the Starshipit street+city push gate.
7. **Prepaid/stocked lines**: picking fee suppression (§6) changes stock-on-hand economics on split orders — the per-destination fee is flat per SKU-band, so a split stock order can cost less than today's banded picking fee at high goods values and more at low ones. Accepted: the fee schedule prices pick/pack per location by design.

## 9. Phasing (each independently deployable, flag-gated)

1. **Checkout + data model + fees.** Migrations (§4), order-level ships-to UI + grid, Google Places, preview/submit explosion, pooling fixes, Xero contact fix, minimal staff read-only destination breakdown, confirmation page. Flag on for pilot org only.
2. **Fulfilment.** Per-destination Starshipit push + webhook destination matching, per-destination packing slips, full staff order view, Monday destination section, dispatch email.
3. **Tracking + notifications.** Tracker per-destination statuses, milestone emails to orderer + destination contacts, save-to-address-book polish.
4. **Amendments.** `swap_destination_address` RPC + staff UI; main amendment RPC guard (the guard itself ships in phase 1 as a hard error).

## 10. Testing approach

- **Unit (portal):** allocation validation (sums, zero-qty destinations, branch scope), explosion → partition mapping (incl. cross-country), pooled MOQ/minimum evaluation, split-fee banding (table-driven from the fee schedule), invoice line aggregation.
- **Unit (staff):** destination iteration in order read model, packing-slip per-destination rendering, amendment guard.
- **RPC/SQL:** submit writes destinations + exploded lines atomically; invariants in §4 enforced; `swap_destination_address` refuses dispatched destinations.
- **E2E smoke (pilot org):** split across 2 NZ stores + 1 ad-hoc; verify one Xero draft (org contact, aggregated lines, fees itemised), 3 Starshipit pushes with `-D` refs, 3 packing slips, tracker shows 3 shipments, milestone emails to orderer + store contacts.
- Baselines: existing single-destination checkout suites must stay green with the flag off — the legacy path is untouched by default.

## 11. Open inputs

1. **Fee bands above 47 SKUs** — the spreadsheet enumerates 1–47; §6's continuation (41–50 → $30, +$2.50 per further block of 10, uncapped) is Claude's extrapolation awaiting Jon's confirmation. Everything else in the fee schedule is confirmed verbatim.
