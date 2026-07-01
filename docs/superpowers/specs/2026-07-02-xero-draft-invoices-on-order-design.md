# Xero Draft Invoices on Customer-Portal Orders — Design

**Date:** 2026-07-02
**Status:** Design approved, pending spec review
**Repo:** `print-room-portal`

## Problem

When a customer places an order through the portal (`/checkout`), the order is
pushed to Monday.com and a confirmation email is sent, but nothing lands in
Xero. Accounts have to key each invoice into Xero by hand. We want the portal to
create a **DRAFT** sales invoice in Xero at order time, so staff can review and
send it to the customer directly from Xero.

## Goal

On qualifying portal orders, automatically create a Xero **ACCREC DRAFT**
invoice matching the order, with the customer resolved to a Xero contact. The
draft is never auto-sent — staff review/finalise/send it from Xero. A Xero
failure must never block or fail the order.

## Decisions (locked with the user)

| Decision | Choice |
|---|---|
| **Trigger timing** | At order placement. Staff finalise the DRAFT in Xero before sending, so post-proof price changes are handled there. |
| **Order scope** | New customer orders **and** reorders. **Skip** inventory/stock pulls (`intent='inventory'`). |
| **GST** | Portal prices are **GST-exclusive**. Xero adds 15% (`LineAmountTypes=Exclusive`, `TaxType=OUTPUT2`). |
| **Auth** | **Custom Connection** (OAuth2 `client_credentials`, machine-to-machine, single org). Paid Xero add-on. |
| **Integration shape** | **Approach A** — inline best-effort side-effect in the order submit path, mirroring the existing Monday/email pattern. |
| **Contact entity** | The **organization** is the billing contact (not the individual). |
| **Line pricing** | Decoration stays **folded** into the line unit price (as it already is on the order). Invoice total = portal total + 15% GST. |
| **Due date** | Derived from `payment_terms` (e.g. `net20` → invoice date + 20 days). |

## Non-goals

- Not sending the invoice to the customer (staff do that in Xero).
- Not creating/updating a draft at proof approval or any later milestone.
- Not invoicing inventory/stock pulls.
- Not syncing invoice status/payment back from Xero into the portal.
- Not building a general Xero sync layer — only draft-invoice-on-order.

## Existing flow (context)

`lib/checkout/submit.ts::submitCustomerOrder()` runs these steps in order:

1. Validation (buyer scope, member access, MOQ, decoration pricing drift).
2. `submit_b2b_order` RPC → returns `{ quote_id, order_id, order_ref }`.
3. Apply per-line `ship_to_store_id` + decorations JSONB to `quote_items`.
4. Inventory write-through (if `intent='inventory'`).
5. Create `job_trackers` shell (best-effort).
6. **Monday push** via `pushOrderDeal(...)` (best-effort try/catch, audited).
7. Set status `awaiting-proof-review`; autofill proof shell.
8. **Confirmation email** via `sendOrderConfirmation(...)` (best-effort).
9. Return `{ order_id, order_ref }`.

Side-effects (Monday, email) are best-effort: wrapped in try/catch, logged, and
audited via `lib/audit/recordEvent.ts`, but never throw. Secrets are read from
`process.env` at runtime (no config table). **No Xero code exists today**
(confirmed via repo-wide grep).

## Architecture (Approach A)

Insert a new best-effort side-effect **after the Monday push (step 6) and before
the confirmation email (step 8)**. At that point the order is committed, the
`order_ref` exists, and the line items are available.

### New modules (mirror `lib/monday/`)

- **`lib/xero/client.ts`** — auth + HTTP.
  - `getXeroToken()`: POST to Xero's token endpoint with `grant_type=client_credentials`
    and the Custom Connection `XERO_CLIENT_ID` / `XERO_CLIENT_SECRET`. Cache the
    access token in module scope with its expiry (~30 min); refetch when within a
    safety margin of expiry.
  - `xeroFetch(path, init)`: attach `Authorization: Bearer <token>` and
    `Accept: application/json`; for a Custom Connection the `xero-tenant-id`
    header may be an empty string. Throw on non-2xx or Xero error payloads.
- **`lib/xero/draft-invoice.ts`**
  - `buildDraftInvoicePayload(input)` — **pure function**, unit-testable, no I/O.
    Maps order data → Xero invoice JSON. Owns the GST/line/due-date logic.
  - `resolveXeroContactId(admin, org, email)` — cached / matched / created (below).
  - `createDraftInvoiceForOrder(admin, orderContext)` — orchestrates: resolve
    contact → build payload → `POST /Invoices` → return `{ invoiceId, invoiceNumber }`.

### Contact resolution (billing entity = organization)

1. If `organizations.xero_contact_id` is set → use it.
2. Else `GET /Contacts?where=Name=="<org name>"`:
   - exactly one match → use it, cache `xero_contact_id` back on the org.
   - zero or multiple matches → step 3.
3. `POST /Contacts` with `Name = <org name>`, `EmailAddress = <customer email>`;
   cache the returned `ContactID` on the org.

Rationale: avoids duplicate Xero contacts for orgs already in the ledger, and is
self-healing — only the first order per org does the lookup/create.

Edge case: "multiple matches" deliberately falls through to create, to avoid
guessing the wrong existing contact. This is logged so accounts can merge
duplicates in Xero if it ever happens. (Alternative — pick the first match — was
rejected as riskier: silently invoicing the wrong contact is worse than a
visible duplicate.)

### Invoice payload

- `Type: "ACCREC"`, `Status: "DRAFT"`
- `Contact: { ContactID }`
- `LineAmountTypes: "Exclusive"`
- `CurrencyCode`: from `quotes.currency`, default `NZD`
- `Reference`: `order_ref` (e.g. `ORD-XXXXXX`) — links the draft to the portal order
- `Date`: invoice creation date (today)
- `DueDate`: derived from `payment_terms` (`net20`→+20d, `net30`→+30d, …); if
  unparseable, omit so Xero applies the contact/org default
- `LineItems`: **one per `quote_item`**
  - `Description`: product name + variant/size label (decoration folded in)
  - `Quantity`: `quantity`
  - `UnitAmount`: portal unit price (GST-exclusive, decoration included)
  - `AccountCode`: `XERO_SALES_ACCOUNT_CODE` (default `200`)
  - `TaxType`: `XERO_TAX_TYPE` (default `OUTPUT2`)
- Optional `BrandingThemeID` from `XERO_BRANDING_THEME_ID` if set.

### Idempotency / dedup

- Add `xero_invoice_id` (text) and `xero_invoice_number` (text) to `orders`.
- Before creating: **if the order already has `xero_invoice_id`, skip.** The
  checkout `idempotency_key` already collapses a retried request onto the same
  `order_id`, so this guard makes the Xero step safe under retry.
- Persist the returned IDs onto the order immediately after a successful create.
- This dedup design also makes a future **backfill** (re-run drafts for orders
  missing `xero_invoice_id`) trivial, if Approach B resilience is ever wanted.

### Guards — when NOT to create a draft

- `intent === 'inventory'` → skip (per scope).
- Order's organization `is_test` → skip (keep test orders out of the real
  ledger, mirroring Monday's demo routing).
- `XERO_ENABLED` flag not on → skip (deploy dark, flip when ready).
- Order already has `xero_invoice_id` → skip (dedup).

### Error handling & audit

Identical to Monday/email: try/catch around the whole step, never throw. On
failure, log and record an audit event (new action, e.g.
`ORDER_XERO_DRAFT_FAILED`) with the order id + error. On success, record a
success audit event with the Xero invoice id/number. The order return value is
unaffected either way.

## Data model changes

Single migration:

- `organizations.xero_contact_id text null`
- `orders.xero_invoice_id text null`
- `orders.xero_invoice_number text null`

No RLS changes needed (writes happen via the service-role admin client in the
submit path, as with existing order writes).

## Config / secrets (Vercel env, `process.env`)

| Var | Purpose | Default |
|---|---|---|
| `XERO_CLIENT_ID` | Custom Connection client id | — (required) |
| `XERO_CLIENT_SECRET` | Custom Connection client secret | — (required) |
| `XERO_ENABLED` | Rollout flag; integration is inert unless truthy | off |
| `XERO_SALES_ACCOUNT_CODE` | Revenue account code for line items | `200` |
| `XERO_TAX_TYPE` | GST tax type | `OUTPUT2` |
| `XERO_BRANDING_THEME_ID` | Optional invoice branding theme | unset |

## Testing & rollout

### Unit tests (vitest, following existing repo patterns)

- **`buildDraftInvoicePayload`**: GST-exclusive mapping; one line per item;
  decoration-folded unit price; `Reference = order_ref`; due-date derivation from
  each supported `payment_terms`; currency default; unparseable terms → no DueDate.
- **`resolveXeroContactId`**: three branches (cached id short-circuits; single
  name match caches + reuses; zero/multiple → create + cache). Xero HTTP mocked.
- **Guards**: `intent='inventory'`, `is_test`, `XERO_ENABLED` off, and existing
  `xero_invoice_id` each skip cleanly.
- **Best-effort**: a thrown Xero error is caught, audited, and the order still
  returns successfully.

### Safe manual smoke

Point the Custom Connection credentials at a **Xero Demo Company** (or a
dedicated test org) and place a portal order with `XERO_ENABLED` on in a
non-production environment. Confirm: a DRAFT ACCREC invoice appears, contact
resolved/created correctly, line items + GST + total correct, `Reference` =
`order_ref`, and the order's `xero_invoice_id`/`_number` are persisted. Only
after this passes, set `XERO_ENABLED` on production.

## Rollout sequence

1. Ship code + migration with `XERO_ENABLED` **off** (inert).
2. Set up the Xero Custom Connection; add env vars to Vercel.
3. Smoke against Demo Company (non-prod).
4. Flip `XERO_ENABLED` on in production; watch the first live orders + audit log.

## Open items for the user / accounts

- Confirm the **revenue account code** (default `200`) and **branding theme** to use.
- Confirm the Custom Connection add-on is acceptable and who sets it up in Xero.
- Confirm `payment_terms` values in use so due-date mapping covers them all.
