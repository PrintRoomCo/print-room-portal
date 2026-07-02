# Xero Draft Invoices on Customer-Portal Orders — Design (v2, post-grill)

**Date:** 2026-07-02
**Status:** Re-scoped after grilling; pending review
**Repo:** `print-room-portal`

> **v2 note.** v1 of this spec assumed a per-order draft for "new orders + reorders"
> with a `skip intent='inventory'` guard. A grill session proved that guard
> **inverted** (add-to-inventory is billable; drawing *paid* stock is what must be
> skipped) and surfaced that the business runs **mixed paid/unpaid stock** with **no
> costing layer** to tell them apart. This v2 re-scopes into a shippable
> Initiative 1 and a deferred Initiative 2. See "What the grill changed."

## Problem

Customer-portal orders push to Monday.com and send a confirmation email, but
nothing lands in Xero — accounts key each invoice by hand. We want the portal to
create a **DRAFT** sales invoice in Xero for the **billable** work on an order, so
staff review/send it from Xero. It must never block or fail the order, and it must
**never auto-bill work that isn't cleanly billable.**

## Goal (Initiative 1 / v1)

On order placement, for orders that are **unambiguously billable**, create a Xero
**ACCREC DRAFT** invoice matching the order, contact resolved to the org. Every
other order is **flagged for manual invoicing** (never silently mis-billed). Drafts
are never auto-sent — staff review/send from Xero (and may batch-send on the 20th).

## Decisions (locked with the user)

| Decision | Choice |
|---|---|
| **Invoice cadence** | **One draft per order**, created inline at placement (Approach A). Consolidating/sending (e.g. on the 20th) is Charlotte's manual step in Xero — out of scope. |
| **v1 eligibility** | **Billable-only, flag the rest.** Auto-draft only fully-billable orders; flag anything touching stock draws or prepay/mixed orgs for manual review. |
| **GST** | Portal prices are **GST-exclusive**; Xero adds 15% (`LineAmountTypes=Exclusive`, `TaxType=OUTPUT2`). |
| **Auth** | **Custom Connection** (OAuth2 `client_credentials`, single org). Paid Xero add-on. |
| **Integration shape** | **Approach A** — inline best-effort side-effect in `submitCustomerOrder`, mirroring the Monday/email pattern. |
| **Contact entity** | The **organization** is the billing contact. |
| **Line pricing** | Decoration stays folded into the line unit price (as stored). Invoice = order billable subtotal + 15% GST. |
| **Due date** | Derived from `payment_terms` (`net20`→+20d, `net30`→+30d). |

## What the grill changed (why v2 differs from v1)

1. **Guard was inverted.** `intent='inventory'` = *"add to my inventory"* — a
   **billable production run** (`p_prepaid:false`, [submit.ts:1069](../../../lib/checkout/submit.ts#L1069);
   [sprint doc](sprint-docs/2026-05-21-confirmation-and-pre-approved-inventory.md)).
   v1 would have wrongly skipped it. The real skip axis is **paid stock**, not intent.
2. **Cadence contradiction.** Business drafts invoices monthly ("the 20th") but the
   user chose **per-order drafts** (Charlotte consolidates/sends in Xero). Locked as A.
3. **Three reorder paths, only one is priced.** Cart-rebuild reorders
   ([app/api/reorder/rebuild](../../../app/api/reorder/rebuild/route.ts)) re-price fresh and
   go through `submitCustomerOrder` → **covered**. The tracker-reorder
   ([app/api/reorder](../../../app/api/reorder/route.ts)) and `variant_reorder_requests`
   paths create **no priced order** → **out of v1** (Initiative 2).
4. **Mixed paid/unpaid stock, no costing layer.** Orgs sometimes hold both paid and
   unpaid stock; `prepaid` is only recorded on receipts (hard-coded `false`), never
   attributed on draws. So partial paid/unpaid billing is **not derivable today** →
   v1 flags any stock-draw order for manual invoicing.

## Scope

### Initiative 1 — this spec (shippable)
Inline, per-order Xero DRAFT for **fully-billable** orders placed via
`submitCustomerOrder`. Covers **new orders** and **cart-rebuild reorders**. Flags
everything else for manual review.

### Initiative 2 — deferred (separate spec, NOT built here)
- **Paid/unpaid inventory costing**: lot-level paid vs unpaid balances + a draw-down
  policy, so stock-draw orders can be partially invoiced for mixed orgs.
- **Reorder-path convergence**: route tracker-reorders and variant-reorder-requests
  through the priced checkout flow so they become invoiceable.
These are the hard part and get their own spec. **Until then, tracker-reorders and
variant-reorder-requests are NOT auto-invoiced** (staff handle them as today).

## Eligibility rule (the heart of v1)

Create a Xero draft for an order **iff ALL** hold:

1. `XERO_ENABLED` is on.
2. The order is not already drafted (`orders.xero_invoice_id` is null) — dedup.
3. The org is **not** `is_test` (keep test orders out of the real ledger).
4. The org's `b2b_accounts.payment_terms` is **not** `'prepay'` (prepay orgs bill
   bespoke; always manual in v1).
5. The order draws **zero** units from stock — i.e. every line is produce-to-make
   (`quote_items.qty_from_stock == 0` on all lines). *(Field to confirm at plan time —
   `qty_from_stock`/`qty_to_make` exist on `quote_items`, read by the rebuild route
   [route.ts:55](../../../app/api/reorder/rebuild/route.ts#L55); confirm they're populated
   at submit time.)*

If all hold → **draft the full order** (every unit billable; no partial-line logic).

Otherwise → **do not draft.** Set `orders.xero_invoice_status = 'manual_review'`,
record an audit event, and surface the flag so Charlotte sees it (below). This
deliberately catches: any stock-draw order, every prepay-org order, and (by
consequence) mixed paid/unpaid situations — exactly the cases we can't cost yet.

Note: `intent='inventory'` (add-to-inventory) is a pure production run with no stock
draw, so it **passes** the rule and **is** drafted — the v1-inversion fix.

## Manual-review visibility (how Charlotte sees a flag)

Source of truth: `orders.xero_invoice_status` (`'drafted' | 'manual_review' | 'skipped'`).
Because Charlotte works in Monday/Xero, surface `manual_review` where she'll see it:
**a note/field on the order's Monday card** (the Monday push already happens in the
same submit path). Exact Monday surfacing (a status label vs an update note) is a
small decision for plan time. A staff-portal "needs manual invoice" list can follow.

## Architecture (Approach A)

New best-effort side-effect **after the Monday push, before the confirmation email**
in `submitCustomerOrder` (order committed, `order_ref` exists, `quote_items`
populated). Wrapped in try/catch — a Xero failure logs + audits but never throws.

### New modules (mirror `lib/monday/`)
- **`lib/xero/client.ts`** — `getXeroToken()` (client_credentials, module-scope cache
  to ~expiry, ~30 min) and `xeroFetch()` (Bearer token, `Accept: application/json`;
  Custom Connection tenant header may be empty). Throws on non-2xx / Xero errors.
- **`lib/xero/eligibility.ts`** — pure predicate implementing the Eligibility rule
  (`{ eligible: boolean, reason: string }`), unit-tested exhaustively.
- **`lib/xero/draft-invoice.ts`** — `buildDraftInvoicePayload(...)` (pure), 
  `resolveXeroContactId(...)`, and `createDraftInvoiceForOrder(...)` orchestrator.

### Contact resolution (billing entity = organization)
1. If `organizations.xero_contact_id` set → use it.
2. Else `GET /Contacts?where=Name=="<org name>"` → exactly one match → use + cache.
3. Else `POST /Contacts` (`Name=<org name>`, `EmailAddress=<recipient email>`) → cache id.
   - **Handle Xero's unique-name-on-create:** if create fails "contact name must be
     unique", re-query by name and use the existing contact (don't spray duplicates).
4. **Concurrency:** two first-orders for a new org can race to create. Mitigate with
   the unique-name fallback (step 3) and, if needed, a short retry.

### Invoice payload
- `Type:"ACCREC"`, `Status:"DRAFT"`, `Contact:{ContactID}`, `LineAmountTypes:"Exclusive"`,
  `CurrencyCode` from `quotes.currency` (default `NZD`).
- `Reference` = `order_ref`. `Date` = today. `DueDate` from `payment_terms` (else omit).
- **One line per `quote_item`**: `Description` = product + variant/size (decoration
  folded in), `Quantity`, `UnitAmount` = portal unit price, `AccountCode` =
  `XERO_SALES_ACCOUNT_CODE` (default `200`), `TaxType` = `XERO_TAX_TYPE` (`OUTPUT2`).
- Optional `BrandingThemeID` from env.

### Idempotency / dedup (hardened after grill)
- Columns: `orders.xero_invoice_id`, `orders.xero_invoice_number`, `orders.xero_invoice_status`.
- Skip if `xero_invoice_id` present. Persist ids immediately after create.
- **Close the write→persist gap:** send Xero's `Idempotency-Key` header on `POST
  /Invoices` keyed by `order_id` (or pre-check `GET /Invoices?where=Reference=="<order_ref>"`),
  so a crash between the Xero write and the DB persist can't create a second draft.

### Error handling & audit
Like Monday/email: try/catch, never throw. Success → `xero_invoice_status='drafted'`
+ success audit. Failure → audit `ORDER_XERO_DRAFT_FAILED` (order still returns).
Ineligible → `xero_invoice_status='manual_review'` + audit + Monday note.

## Data model changes (one migration)
- `organizations.xero_contact_id text null`
- `orders.xero_invoice_id text null`
- `orders.xero_invoice_number text null`
- `orders.xero_invoice_status text null` (`drafted | manual_review | skipped`)

No RLS changes (writes via the service-role admin client, as with existing order writes).

## Config / secrets (Vercel env, `process.env`)
| Var | Purpose | Default |
|---|---|---|
| `XERO_CLIENT_ID` / `XERO_CLIENT_SECRET` | Custom Connection creds | required |
| `XERO_ENABLED` | Rollout flag; inert unless truthy | off |
| `XERO_SALES_ACCOUNT_CODE` | Revenue account code | `200` |
| `XERO_TAX_TYPE` | GST tax type | `OUTPUT2` |
| `XERO_BRANDING_THEME_ID` | Optional invoice branding | unset |

## Testing & rollout
- **Unit — `eligibility.ts`**: prepay org → flag; stock-draw line → flag; test org →
  skip; add-to-inventory production → **draft**; already-drafted → skip; net-terms
  pure-production → **draft**.
- **Unit — `buildDraftInvoicePayload`**: GST-exclusive math; one line per item;
  `Reference=order_ref`; DueDate per `payment_terms`; currency default.
- **Unit — `resolveXeroContactId`**: cached / single-match / create / unique-name-collision.
- **Unit — best-effort**: thrown Xero error is caught + audited; order still returns.
- **Safe smoke**: point Custom Connection creds at a **Xero Demo Company** in non-prod,
  place a billable order with `XERO_ENABLED` on; verify DRAFT + contact + GST + total +
  `Reference` + persisted ids. Place a stock-draw + a prepay-org order; verify **no
  draft**, `manual_review` flag set, Monday note present. Only then flip prod.

## Rollout sequence
1. Ship code + migration with `XERO_ENABLED` **off** (inert).
2. Set up the Xero Custom Connection; add env vars to Vercel.
3. Smoke against Demo Company (non-prod), incl. the flag paths.
4. Flip `XERO_ENABLED` on in prod; watch first live orders + audit + the manual-review list.

## Open items to confirm (not blocking the plan)
- **Recipient email** on the Xero contact: ordering user's email vs the org's
  accounts-payable email? (Sets the default for all future invoices to that org.)
- Verify `quote_items.unit_price` / `quotes.total_amount` are stored **GST-exclusive**.
- Confirm `qty_from_stock` is populated on `quote_items` at submit time (eligibility rule #5).
- Revenue **account code** (default `200`) + **branding theme** from accounts.
- Full set of `payment_terms` values, so the DueDate map is complete.
- Custom Connection add-on approved + who sets it up in Xero.
- Exact **Monday surfacing** of the `manual_review` flag (label vs update note).
