# Customer B2B Checkout MVP — Design Spec

**Date:** 2026-04-20
**Status:** Draft
**Owner:** Jon (jon@theprint-room.co.nz)
**Repo:** `print-room-portal` (Next.js 16, Tailwind v4, Supabase Auth)

## 1. Context

As of 2026-04-20 Chris confirmed the B2B business is moving off Shopify onto an own-built platform. `print-room-portal` already has the infrastructure foundation — companies, users, tiers, stores, auth via Supabase, an order tracker that reads Monday status — but it has no catalogue, no cart, and no checkout. Customers today have no self-serve path.

This spec covers the customer-side MVP: browse, add to cart, checkout, split-ship to multiple stores, charge-to-account submit, and the out-of-stock UX that blocks stocked-inventory customers from oversell with a "Request reorder" escape hatch.

The out-of-stock UX was originally scoped as its own short document. It's been folded in here because out-of-stock behaviour cannot be described in isolation — you can't define "customer sees out-of-stock" without first defining how the customer browses and adds to cart.

This is the feature Chris described most directly on 2026-04-20 ("Inventory showing inventory levels, B2B catalogue, B2B ordering, Check out"). All four of those customer-facing surfaces are in v1.

## 2. Goals

- A logged-in B2B customer sees a catalogue filtered to products they are allowed to order.
- Product detail pages show available stock for stocked-inventory customers (Reburger, Bike Glendhu, Otago Polytech today).
- Customer adds items to cart, sees live pricing including their tier discount.
- Customer checks out with a per-line ship-to selection (split-ship), charge-to-account, required-by date, and notes.
- Oversell is hard-blocked for stocked-inventory customers; a "Request reorder" button notifies staff without creating an order.
- Customer can alternatively submit the cart as a quote request — staff receive an unassigned draft in the quote builder.
- The customer never sees Shopify.

## 3. Non-goals (out of scope)

- **Per-company catalogues** — v1 filters by the B2B channel activation in `product_type_activations` (`product_type='b2b' AND is_active=true`), uniform for all B2B customers. This is the same table the staff product editor's Channels row writes to, so toggling B2B in the staff portal directly controls visibility on the customer catalogue. Company-specific catalogue assignment and price overrides land in staff-portal sub-app #3 (B2B catalogues & companies).
- **Qty-splitting a single line** across multiple ship-to addresses — v1 has per-line ship-to only. Customer can add two lines for the same variant if they want the same item split 30/20.
- **Stripe / instant-payment checkout** — charge-to-account only in v1. Deposit % auto-applied from `b2b_accounts.default_deposit_percent` but not collected.
- **Multi-device cart sync** — cart is client-side (localStorage). No changes to the empty `cart_items` table.
- **Xero automation** — shared dependency with CSR tool; deferred v1.1 per Chris's decision to ship the Supabase path first.
- **Design tool / decoration editor** — out of scope here; if a decorated product requires customer artwork, v1 redirects to the existing design collection flow or defers to staff follow-up.
- **Order edits from the customer side** — once submitted, customer cannot edit. Staff can edit pre-ship via the CSR tool's order detail page.
- **PDF receipts / order confirmations** — email confirmation is a plain text summary in v1.

## 4. Architecture

### 4.1 Route structure

```
app/(portal)/shop/
  page.tsx                          Catalogue: grid of products tagged b2b, filters
  [productId]/page.tsx              Product detail: variant picker, stock display, add-to-cart
app/(portal)/cart/
  page.tsx                          Cart review + proceed-to-checkout
app/(portal)/checkout/
  page.tsx                          Ship-to per line, payment terms, notes, submit
  confirmation/[orderId]/page.tsx   Post-submit confirmation with order_ref
app/(portal)/quote-requests/
  page.tsx                          List of quote requests the customer has submitted
  [id]/page.tsx                     Detail view, status, staff response once priced
app/api/
  shop/products/route.ts            GET catalog (tagged b2b, customer's org context)
  shop/products/[id]/route.ts       GET single product with availability overlay
  shop/products/[id]/availability/route.ts
                                    GET {variant_id → available_qty} for current org
  checkout/route.ts                 POST submit order (returns order_ref)
  checkout/quote-request/route.ts   POST submit as quote-request (returns staff_quote id)
  checkout/reorder-request/route.ts POST "Request reorder" on an oversold variant
```

### 4.2 Client-side cart

- React context `CartProvider` wrapping `(portal)` layout. State shape: `{ items: { variantId, productId, qty, decorationSpec?, shipToStoreId? }[] }`.
- Persisted to `localStorage` keyed by `organizationId`. When a user switches orgs, cart isolates.
- No server round-trip on add/remove. Pricing preview is computed client-side from product data already in the page cache.
- Submit sends the whole cart in one POST; server re-validates prices server-side (defence in depth against localStorage tampering).

### 4.3 Shared server code

- Pricing function `get_unit_price(product_id, org_id, qty)` — same Postgres function defined in the CSR tool spec. Called from both the checkout submit endpoint and the PDP for live display.
- Monday push helper — imports the same `src/lib/monday/production-job.ts` as the CSR tool and quote builder. Cross-app import: since these are two separate Next.js apps, the helper either lives in a shared package or is duplicated with a follow-up to extract. v1 chooses duplication — a near-identical file lives in `print-room-portal/lib/monday/production-job.ts`, with a NOTE comment referencing the canonical staff-portal copy.
- Reservation: `reserve_quote_line(quote_item_id)` — same Postgres function defined in the Inventory spec.
- Customer auth and org scoping via the existing `getCompanyAccess` in [print-room-portal/lib/company.ts:87](print-room-portal/lib/company.ts#L87).

### 4.4 Next.js 16 caveat

This repo is on Next.js 16 — consult `node_modules/next/dist/docs/` before touching route handlers or server/client boundaries, per the repo's `AGENTS.md`.

## 5. Data model

### 5.1 New table

```sql
create table reorder_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  variant_id uuid not null references product_variants(id),
  requested_qty integer not null check (requested_qty > 0),
  requested_by uuid references auth.users(id),
  note text,
  status text not null default 'open' check (status in ('open','resolved','dismissed')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
```

Staff surface this table in a dashboard widget (follow-up, or add a tiny list page to the inventory sub-app).

### 5.2 Column addition

```sql
alter table quote_items
  add column ship_to_store_id uuid references stores(id);
-- Nullable: single-ship orders leave it null and use the order-level shipping_address.
```

### 5.3 Reuse

- `quotes` + `orders` + `quote_items` — same pattern the CSR tool writes.
- `staff_quotes` — quote-request submissions become `staff_quotes` rows with `status = 'draft'`, `staff_user_id = null` (unassigned).
- `stores` — the customer's ship-to options come from `stores` rows filtered by their `organization_id`.

## 6. Browse — catalogue `/shop`

### 6.1 Filters applied

- `products.is_active = true`.
- Joined `product_type_activations` row with `product_type = 'b2b' AND is_active = true` (PostgREST `!inner` join — a product without a B2B channel row is excluded). This matches the staff product editor's Channels row exactly.
- Hide products with no active variants available to the customer's org context (stretch goal; v1 may show all and rely on PDP for out-of-stock feedback).

### 6.2 Card content

- Thumbnail (primary image).
- Name, brand.
- "From $X" — starting tier price × customer's tier discount, qty 1 (or the product's MOQ if higher).
- Badge: "In stock" only if the customer is a stocked-inventory org AND at least one variant has `available_qty > 0`.

### 6.3 UX

- Grid, responsive; 24 per page with pagination.
- Filters: brand, category, garment family, search.
- Empty state: "No products available for your account yet — contact us to set up your catalogue" with a mailto to sales.

## 7. Product detail `/shop/[productId]`

### 7.1 Above the fold

- Gallery (from `product_images`, primary first).
- Name, brand, description, MOQ, lead time.
- Variant picker: color swatches (from `product_color_swatches`) × size pills (from `sizes`). Default selection: first active combo.

### 7.2 Availability for stocked-inventory customers

When the customer's org has ≥1 row in `variant_inventory` for this product's variants, the PDP fetches availability via `GET /shop/products/[id]/availability` and renders per-variant badges:

- `available_qty > 0` → green "In stock (N available)"
- `available_qty = 0` → red "Out of stock" AND disable add-to-cart for that variant. Surface "Request reorder" button.
- Variant untracked (no `variant_inventory` row) → no badge, treated as made-to-order, normal MOQ/lead-time applies.

For non-stocked-inventory customers, no badges are shown; standard MOQ/lead-time applies.

### 7.3 Qty + add-to-cart

- Qty input with step = 1, min = product MOQ if made-to-order, min = 1 if stocked-inventory.
- Live price: `get_unit_price(product_id, org_id, qty)` via a debounced fetch (or a client-side table if we prefetch brackets with the product).
- Add-to-cart button — disabled if variant is out-of-stock or qty < min.

### 7.4 Request-reorder UX

Clicking "Request reorder" on an out-of-stock variant:
- Opens a small modal: qty input, optional note.
- Submit POSTs `/api/checkout/reorder-request`, which inserts `reorder_requests` and sends a Slack/email to staff.
- Modal shows confirmation: "Reorder request sent. Staff will be in touch."

## 8. Cart `/cart`

### 8.1 Layout

- Table: thumbnail, variant label (color + size), qty (editable), unit price, line total, remove button.
- For stocked-inventory customers: per-line availability badge. Rows that oversell (`qty > available_qty`) highlight red with "Reduce to N or split" inline action.
- Summary panel: subtotal, expected deposit amount (if applicable), estimated delivery date, "Proceed to checkout" button (disabled if any oversell row).

### 8.2 Edit behaviour

- Qty change updates client cart + triggers a lightweight availability re-check for stocked variants.
- Remove → removes from context and localStorage.

## 9. Checkout `/checkout`

### 9.1 Ship-to

- Per-line dropdown: the customer's `stores` by label. Default for new lines: the customer's most-recently-used store (from a `user_preferences` or a settings field on `profiles`; if absent, the alphabetically first).
- "Custom address for this line" option: inline address form. Stored on `quote_items.ship_to_store_id = NULL` with the custom address held on an order-level `shipping_address` override, if all lines share it; otherwise per-line custom addresses go in a jsonb side-channel. (V1 keeps it simple: custom addresses are only allowed if ALL lines share one — i.e. non-split-ship with a custom address. If the customer wants split custom addresses, v1 asks them to save the addresses as stores first.)
- Split-ship indicator: if more than one ship-to is used across lines, show a banner and confirm before submit.

### 9.2 Payment

- Default: "Charge to account — <b2b_accounts.payment_terms>" (e.g. "Net 30"). Non-editable by customer in v1.
- Deposit banner if `b2b_accounts.default_deposit_percent > 0`: "A deposit of $X (N%) will be invoiced separately." No collection step in v1 — staff handle deposit in Xero.

### 9.3 Required-by, notes

- Date picker for required-by (optional).
- Notes textarea (optional).

### 9.4 Two submit buttons

- **Place order** — creates quote + order + quote_items, reserves stock (if applicable), pushes Monday production job, allocates order_ref.
- **Submit as quote request** — creates `staff_quotes` row with cart contents, `status = 'draft'`, `staff_user_id = null`. Does NOT reserve stock, does NOT push Monday. Customer lands on `/quote-requests/[id]` showing "Awaiting staff pricing."

### 9.5 Submit pipeline (Place order)

Same shape as the CSR tool submit pipeline:

```
BEGIN;
  insert into quotes (...)                -- idempotency_key from client
  insert into quote_items (... ship_to_store_id ...)
  insert into orders (quote_id, account_id, shipping_address?, ...)
  select lpad(nextval('order_number_seq')::text, 6, '0') into seq;
  update quotes set order_ref = customer_code || '-' || seq where id = quote.id;
  perform reserve_quote_line(quote_item.id) for each line;
COMMIT;
-- post-commit, out of transaction:
  push monday item + subitems;
  write back monday_item_id + subitem_ids;
```

Customer sees the order_ref on `/checkout/confirmation/[orderId]`.

### 9.6 Failure modes

- `OUT_OF_STOCK` → rollback, redirect to cart with offending line highlighted. This should be rare because the PDP/cart already validate, but the race is possible (another customer submits milliseconds earlier).
- Monday push failure — order exists, `monday_item_id = null`; customer sees a friendly "Your order is received. We're syncing it to production now." The reconciliation button on the staff-portal orders page recovers.
- `customer_code` missing on the org — client-side check prevents reaching this page; server also 400s with a clear message directing customer to contact staff.

## 10. Quote-requests list `/quote-requests`

Customer-facing list of `staff_quotes` rows where the quote was submitted by the customer (filter by `customer_email` or a new column `submitted_by_user_id` on `staff_quotes`). Columns: created_at, line count, status (draft → priced → approved).

Detail page `/quote-requests/[id]`:
- Read-only summary of what the customer submitted.
- Once staff approves and prices, a new block appears: "Staff priced this at $X. Accept?" with Accept/Decline buttons (Accept converts to an order via a call that the staff quote-builder spec's approval flow anticipates).
- v1.1 covers the customer-side Accept action; v1 ships the customer-side request and staff-side pickup. Once staff marks the quote `approved`, the customer sees the pricing on their detail page; acceptance is handled offline (email/phone) until v1.1 adds in-app accept.

Small alteration: add `staff_quotes.submitted_by_user_id uuid references auth.users(id)` and populate from the quote-request submit endpoint.

## 11. Auth, permissions, RLS

- All `(portal)` routes already go through the Supabase Auth middleware in [print-room-portal/middleware.ts](print-room-portal/middleware.ts).
- Catalogue, PDP, cart, checkout all require an authenticated user with an `organization_id` from `user_organizations`. Without one → redirect to `/account` with a "Contact sales" CTA.
- Server-side checks on every `/api/shop/**` and `/api/checkout/**` route: derive `organization_id` from the user session; all queries filter by it.
- RLS:
  - `variant_inventory` read already allowed for members of the matching org (from Inventory spec).
  - `reorder_requests` insert allowed for members of the matching org; read restricted to staff.
  - `staff_quotes` — customer can insert with `submitted_by_user_id = auth.uid()` and read their own rows; staff see all.

## 12. Decisions made (with defaults applied per auto-mode)

| # | Decision | Default chosen | Override needed? |
|---|---|---|---|
| 1 | Catalogue filter | `product_type_activations` B2B channel active; uniform for all B2B customers (matches staff editor toggle) | Tell me if per-company catalogues must ship v1 |
| 2 | Cart persistence | Client-side (localStorage + context) | Tell me if you want a DB cart in v1 |
| 3 | Split-ship granularity | Per-line ship-to; no qty splitting | Tell me if qty-split is required v1 |
| 4 | Payment method | Charge-to-account only | Tell me if Stripe must be in v1 |
| 5 | Deposit collection | Display only; invoiced via Xero later | Tell me if portal must collect deposit |
| 6 | Quote-request flow | In scope | Tell me if you want to defer |
| 7 | Custom ship-to address | Only if whole order uses same custom address | Tell me if mixed per-line custom addresses must work |
| 8 | Email receipt | Plain text in v1 | — |
| 9 | Customer order edits | Not allowed after submit | — |
| 10 | Accept-priced-quote in-app | v1.1 (offline acceptance for now) | Tell me if you want in-app accept v1 |

## 13. Dependencies & follow-ups (not in this spec)

- **Inventory sub-app (staff-portal sub-app #2)** — must ship first. Customer checkout calls `reserve_quote_line`, reads `variant_availability`.
- **CSR tool (staff-portal sub-app #4)** — defines the Monday push helper, pricing function, and submit pipeline pattern this spec mirrors. Co-shippable.
- **Quote Builder Completion (staff-portal)** — the `Submit as Quote Request` path lands in the staff quote builder. This spec assumes the staff builder can load a draft with `staff_user_id = null` and the builder treats unassigned drafts as "incoming requests."
- **B2B catalogues & companies (staff-portal sub-app #3)** — will replace the uniform B2B-channel filter with per-company catalogue assignment. Switch is a one-line query change.
- **v1.1 deferred:**
  - Per-company catalogues (follows sub-app #3).
  - Qty-splitting a single line across multiple addresses.
  - Stripe / instant payment.
  - Customer in-app Accept-priced-quote converting to an order.
  - DB-backed cart for multi-device sync.
  - PDF receipts / branded order confirmations.
  - Design-tool handoff for products that require decoration artwork.
  - Monorepo extraction of shared Monday push helper (avoid the v1 duplication).

## 14. Verification

End-to-end happy paths:
1. **Browse & add:** Bike Glendhu customer logs in, visits `/shop`. Sees only products tagged `b2b`. Opens a stocked product's PDP. Sees "In stock (12 available)" on Black/M. Adds 5 to cart. Cart shows 5 × $X (tier 2 price).
2. **Checkout single-ship:** Navigates to `/checkout`. One ship-to per line, set to their Wanaka store. Submits Place Order. Lands on confirmation page showing `order_ref = BIK-000123`. Monday item created, inventory committed_qty += 5.
3. **Checkout split-ship:** Cart has 3 lines. Customer selects 2 different stores across lines. Banner shows "Split-ship detected." Submit succeeds; `quote_items.ship_to_store_id` set per line.
4. **Oversell block:** Cart has Black/M × 15 when only 12 are available. Cart page highlights row red and disables Proceed. "Request reorder" button visible. Clicking submits a `reorder_requests` row and sends a Slack/email. Customer gets a confirmation modal.
5. **Quote request:** Cart has 2 lines. Customer clicks Submit as Quote Request. Redirected to `/quote-requests/[id]` showing "Awaiting staff pricing." A `staff_quotes` row is created with `staff_user_id = null`, `submitted_by_user_id = auth.uid()`.
6. **Race condition:** Two customers submit simultaneously when stock = 5 each requesting 3. One succeeds (`committed_qty = 3`), the other gets `OUT_OF_STOCK` and is redirected to cart with the line highlighted.
7. **Non-B2B customer (no `organization_id`):** `/shop` redirects to `/account` with "Contact sales" CTA; `/api/shop/products` returns 403.
8. **Monday push failure:** Stub the helper to throw. Order still created, `monday_item_id = null`, customer sees friendly sync message. Staff reconcile via the orders page.
9. **Customer code missing:** Org without a `customer_code` hitting the checkout API gets a 400 "Contact staff to set up your account." No partial order is written.
