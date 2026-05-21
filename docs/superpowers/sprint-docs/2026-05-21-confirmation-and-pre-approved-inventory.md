# Confirmation polish + Pre-approved inventory write-through — 2026-05-21

## What shipped

Two follow-ups stacked on the morning's Checkout → Monday → Auto-proof pipeline:

1. **Pre-approved inventory at checkout.** Ticking "Add all to my inventory" at checkout now actually writes through to `variant_inventory` at submit time. The order's `intent='inventory'` flag was previously inert — stock only landed after a staff member manually clicked the inventory receive button post-fulfilment. Customers now see their stock on the PDP availability line and the staff inventory page within seconds of submitting.
2. **Confirmation page copy realign.** The hero now reads "Order received / We're preparing your proof." instead of the legacy AM-approval gate copy. The misleading "Items will appear here once they finish syncing" empty-state is replaced with a real error path. Inventory-intent orders show "Stock destination → Print Room warehouse" instead of the buyer's shipping address.

## Why

`orders.intent='inventory'` shipped in Slice 4 (2026-05-13) and the customer-portal checkout already routed the flag onto the order row, but the inventory write was deferred to a staff-side click on `mark_inventory_received` post-fulfilment. That left a several-day window where the customer saw "order placed, stocking up" and the inventory page said "0 units". Jamie's call: the customer ticking the toggle is itself the approval — write the stock now.

The confirmation page copy was written assuming the AM-approval gate that the morning's pipeline rip-out had just removed. Customers landing on the page were being told their order needed staff proof review (no longer true) and that they'd been emailed a receipt (still true, but the line was the load-bearing copy on the page — top-billed instead of the actual next step). Inventory orders were also being told their stock would ship to their own address, which is wrong: the whole point is that it lives on Print Room's shelf.

## How it works

1. **Stage 1 — RPC extension** (staff repo). `mark_inventory_received` gained a `p_reason text DEFAULT 'intake'` parameter. The events row now stamps `COALESCE(p_reason, 'intake')` instead of the hardcoded `'intake'`. The CHECK constraint on `variant_inventory_events.reason` got `'pre_approved_inventory'` added to the allowlist (the existing 6 reasons untouched).
2. **Stage 2 — Submit hook** (portal). `lib/checkout/submit.ts` step 4b runs only when `intent='inventory'`, between the `submit_b2b_order` RPC and the Monday push. It re-fetches `quote_items`, calls `mark_inventory_received` per line with `p_reason='pre_approved_inventory'`, `p_prepaid=false`, `p_unit_value=quote_items.unit_price`, and a note containing the `order_ref`. Best-effort: a failure logs + audits but does NOT roll back the order.
3. **Stage 3 — Confirmation page** (portal). `page.tsx` now selects `orders.intent` and derives `isInventoryOrder = order.intent === 'inventory'` to pass into the view. `ConfirmationView.tsx` rewrites the hero, drops the receipt paragraph + both approval badges, swaps the empty-lines fallback to a "No items recorded — email us" link to `hello@theprint-room.co.nz`, and switches the Delivery section to "Stock destination → Print Room warehouse" when `isInventoryOrder` is true.

## Key decisions

- **`prepaid=false` on the RPC call.** The customer is being invoiced normally (net20 or whatever their terms are) — `prepaid` is reserved for stock the org *paid for* up-front. The "pre-approved" signal lives in `reason` + `note`, not in `prepaid`.
- **`p_unit_value` = `quote_items.unit_price` post-decoration-fold.** That's the price the customer was charged, which matches the value finance sees in the audit trail.
- **Best-effort + audited, not transactional.** A `mark_inventory_received` failure for any line drops out of the loop, swallows the error, writes an `order.pre_approved_inventory_failed` audit row, and lets the order commit. Rationale: the customer has a successful checkout — failing the whole order because the inventory write had a transient issue would be a worse outcome than catching up in staff portal later.
- **v1 honours order-level intent only.** Mixed mode (some lines to inventory, some to customer on the same order) is not supported — `orders.intent` is order-level, not line-level. If the RPC ever grows mixed-mode support, this block grows with it.
- **Vestigial props deliberately kept.** `awaitingApproval` and `mondaySynced` are still in `ConfirmationViewProps` because the right-rail "Production sync is still finishing" hint at line ~352 still consumes them. Removing them is a follow-up bundled with rewriting that hint.

## Stage-1 surprise + Option A

The plan's Stage 1 inventory-write code passed `p_org_id` to the RPC (typo for `p_organization_id`) AND `p_reason: 'pre_approved_inventory'`. Pre-flight read of the migration file revealed the RPC had no `p_reason` parameter at all — the reason was hardcoded `'intake'`. Surfaced 3 options to Jamie:

- **(A) Extend the RPC** — new migration that adds `p_reason text DEFAULT 'intake'`. Backward-compatible.
- **(B) Skip reason** — let pre-approved events look like normal intake; encode the signal in the note only.
- **(C) Bypass RPC** — write to `variant_inventory` + `variant_inventory_events` directly from the portal admin client.

Jamie picked A. Migration: `20260521000010_inventory_reason_pre_approved.sql`. Applied via Supabase MCP to project `bthsxgmcnbvwwgvdveek`. Smoke-tested against a real org+variant pair before any portal code ran — verified stock_qty incremented, event row landed with the new reason, then unwound the test writes.

## Gotchas

- **Param name is `p_organization_id`, not `p_org_id`.** Several other RPCs in this codebase use `p_org_id` (e.g. `apply_staff_adjustment`, `effective_unit_price`). `mark_inventory_received` is the odd one out. Silent failure mode: if you call with `p_org_id`, Supabase JS sends `undefined` for the org and the call fails (or worse, lands on the wrong org under a permissive RLS path).
- **`mark_inventory_received`'s parameter list changed.** Added `p_reason` between `p_unit_value` and `p_staff_user_id`. All callers in tree use named-args via Supabase JS RPC, so this is non-breaking. Any future positional caller (raw SQL, psql scripts) needs updating.
- **The "syncing" copy was always a lie.** No async sync exists between the quote_items insert in `submit_b2b_order` and the confirmation page query — both are synchronous. If `lineRows.length === 0` it means a real failure (org mismatch on the join, or `submit_b2b_order` returned no rows). New behaviour: `console.error('[confirmation] empty_lines', { orderId, quoteId })` so we notice.
- **Sprint-doc claim "staff repo doesn't host migrations" (2026-05-21-checkout-monday-proof-pipeline.md, last line) is wrong.** Migrations live in both repos — the original `mark_inventory_received` migration is in `print-room-staff-portal/supabase/migrations/`, and this sprint's follow-up went there too because it's where its peer migration lived. Worth correcting that earlier doc if anyone re-reads it.
- **Pre-existing test failures unrelated to this branch.** `components/checkout/__tests__/CheckoutClient.review-redirect.test.tsx` (missing `CurrencyProvider`) and `components/layout/__tests__/PortalShell.test.tsx` (missing `CartProvider`). Both fail identically on `main` — confirmed by re-running them after stashing this branch's diff. Not introduced by this work, not fixed by this work, deferred.

## Deferred

- **Mixed-mode per-line inventory routing.** `submit_b2b_order` RPC doesn't accept a per-line intent yet; v1 is all-on / all-off only.
- **Removing vestigial props.** `awaitingApproval` + `mondaySynced` go when the right-rail "Production sync is still finishing" hint is also rewritten.
- **`proof.autofill_failed: column product_print_areas_2.view does not exist`** — separate ticket, surfaced during the earlier sprint's smoke. Not in scope.
- **Order-confirmation email template review.** The email still describes the legacy AM-approve flow; not touched in this PR.

## Where to find it

**Customer portal** (`print-room-portal`, branch `fix/checkout-confirmation-and-preapproved-inventory`):
- Inventory write-through: `lib/checkout/submit.ts:746-826` (step 4b)
- Audit constants: `lib/audit/actions.ts` (`ORDER_PRE_APPROVED_INVENTORY`, `ORDER_PRE_APPROVED_INVENTORY_FAILED`)
- Confirmation server page: `app/(portal)/checkout/confirmation/[orderId]/page.tsx` (adds `intent` to OrderRow + select list, derives `isInventoryOrder`, empty-lines console.error)
- Confirmation view: `app/(portal)/checkout/confirmation/[orderId]/ConfirmationView.tsx` (new hero, empty-lines copy, inventory-aware delivery label)
- Unit test: `lib/checkout/__tests__/submit.pre-approved-inventory.test.ts` (3 cases — happy path, RPC error path, intent=customer skip)

**Staff portal** (`print-room-staff-portal`, branch `feat/submit-b2b-order-pre-approved-inventory`):
- RPC migration: `supabase/migrations/20260521000010_inventory_reason_pre_approved.sql`

**Supabase:** project `bthsxgmcnbvwwgvdveek`. Migration applied via MCP `apply_migration`. Smoke-tested with a real org+variant (3bdec267 / 174f0f41), 2 events written + cleaned up before any application code ran.
