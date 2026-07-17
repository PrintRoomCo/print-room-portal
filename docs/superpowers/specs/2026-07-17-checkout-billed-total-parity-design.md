# Checkout billed-total parity — prepaid goods at $0 + picking fee as a line item

**Date:** 2026-07-17
**Status:** Design approved, awaiting implementation plan
**Origin:** Chris Brun, portal user testing (2026-07-17): *"Will we add that it is pre-paid on the checkout page as well and then the picking fee's will be added as a line item eh? … Ideally the checkout page will reflect what goes to Xero. So it can still list the products but they show as $0 due to being pre-paid?"*

## Problem

The checkout page and the Xero draft already disagree about what a prepaid stock draw costs, and nothing in the codebase reconciles them.

For a prepaid variant drawing 120 × Staple Tee at $12.21:

| Surface | Shows | Source |
| --- | --- | --- |
| `/checkout` | $1,684.98 | `CheckoutClient.tsx:129` — `computeOrderBreakdown` with no `pickingFee` |
| `/checkout/review` | $1,684.98 | `CheckoutReviewClient.tsx:113` — full `unitPrice` for every line |
| Confirmation page | $1,465.20 | `quotes.total_amount` (ex-GST) |
| Customer email | $1,465.20 | `order-confirmation.ts:142` |
| **Xero draft quote** | **$17.25** | `draft-invoice.ts:143` — prepaid line zeroed, pick fee added |

Xero is deploy-dark behind `XERO_ENABLED`, so no customer has been burned yet. The confirmation-page and email divergence is live today.

Three distinct defects underlie this:

1. **No billing-mode awareness in customer-facing pricing.** `computeOrderBreakdown` has no concept of `billingMode`. The "Pre-paid" badge on the review page is decorative — it changes no number.
2. **The two checkout pages disagree with each other.** `/checkout` passes no `pickingFee` to `computeOrderBreakdown` and never renders the badge; `/checkout/review` does both. This is why Chris's screenshot showed no picking fee — it is missing on that page, not globally.
3. **`quotes.total_amount` is neither figure.** `submit.ts:1484` computes it as full goods ex-GST — no zeroing, no picking fee — and the confirmation page and customer email both render it.

## Decisions

Confirmed with Jon and Jamie, 2026-07-17.

| # | Decision | Rationale |
| --- | --- | --- |
| D1 | **Checkout Total = what will be invoiced.** Prepaid goods drop to $0; Total = picking fee + GST. Goods value stays visible per line. | Directly answers Chris. The order still reads as 120 tees, not as a $17 order. |
| D2 | **Picking-fee band uses full goods value at current catalogue price** (the ordering event), pre-zeroing. | One rule for prepaid and non-prepaid alike — the same pick bands the same way regardless of billing. Always available; no fallback needed. **This is what the server already does** (`submit.ts:1184`) — no server change. |
| D3 | **Mixed carts render as two groups**, each with its own subtotal / fee / GST / total, mirroring the two Xero quotes. | The split into two orders is already real (`partition.ts:19`); today's single total hides it. |
| D4 | **Fresh billing-mode read on checkout load + a 409 drift guard at submit.** | The cart snapshot can be days stale. Once goods show $0, a stale snapshot means showing $17.25 and charging $1,684.98. |
| D5 | **Persist billed figures at submit; fix the whole journey.** | Checkout, confirmation, email and Xero must all agree. A snapshot (not a recompute) keeps the order record truthful. |

### D2 in detail — Jamie's question

Jamie asked whether the fee bands on the *payment event* (what the org originally paid for the stock) or the *ordering event* (current catalogue price).

Both figures exist. The payment-event price is resolved by `lib/shop/stock-purchase-price.ts` (`variant_inventory_events.reference_quote_item_id → quote_items.unit_price` — "the exact all-in price the org paid per unit"), and the PDP surfaces it for prepaid variants. It is informational only and never touches the fee.

**Decision: ordering event (current catalogue price).** The two can straddle a band boundary — at 25 units, current 25 × $12.21 = $305.25 → $20 band, while original 25 × $10.50 = $262.50 → $25 band — so this is a real choice, not a formality. Current price wins because it applies one rule to every order, and because the payment-event resolver can legitimately return nothing (unlinked intake with no matching band), which would need a fallback.

**Consequence that must not be dropped:** once goods render $0, the banding figure appears nowhere on the page. The breakdown must surface it (see UI below) or the customer cannot derive why the fee is $15 rather than $35.

## Defect found during design: the badge predicate is wrong

`CheckoutReviewClient.tsx:460` passes `line.nature` to `showsPrepaidTag`, and `prepaid-tag.ts:7` returns true for `'stocked' || 'mixed'`.

Xero zeroes on `qty_from_stock > 0`. A **made-to-order line of a mixed-nature prepaid variant** has `qty_from_stock: 0` and **is charged** — but currently shows the "Pre-paid" badge. The badge already lies on those lines.

This is cosmetic today. Wiring money to that predicate would turn it into a $0 line we invoice in full.

**The money predicate is `fulfilmentType === 'stocked' && billingMode === 'prepaid'` — never `nature`.** `showsPrepaidTag` is corrected to take `fulfilmentType` so badge and money cannot diverge.

## Architecture

A **shared pure billing module**, `lib/pricing/order-billing-shape.ts`, is the single source of truth for the billed shape. The checkout page, the review page, `submit.ts` and the Xero draft builder all call it.

This is the established house pattern, adopted here for the reason it already states out loud in `order-picking-fee.ts:16`:

> *"Shared by the server (checkout submit) AND the customer checkout summary so the figure the customer sees on the review page matches the Xero draft and the Monday billing note."*

Same rationale, one layer up.

### Interface

```ts
billedOrderShape({ lines, gstRate }) → {
  partitions: Array<{
    orderType: 'purchase_order' | 'stock_on_hand'
    lines: Array<{ ...line, billed: boolean, billedUnitPrice: number, goodsValue: number }>
    goodsValueForBand: number   // full goods, current price, pre-zeroing (D2)
    billedSubtotal: number
    pickingFee: number
    gst: number
    total: number
  }>
  grandTotal: number
  invoiceCount: number
}
```

Rules it encodes:

- A line is **zeroed** iff `fulfilmentType === 'stocked' && billingMode === 'prepaid'`. `goodsValue` is retained for display and banding; `billedUnitPrice` is `0`.
- **Band basis** is `goodsValueForBand` — garment + folded decoration at current catalogue price, pre-zeroing. Delegates to the existing `orderPickingFee` unchanged.
- **`goodsValueForBand` is per-partition**, covering every line in that partition whether prepaid or not. Only the `stock_on_hand` partition can carry a fee; the `purchase_order` partition always has `pickingFee: 0`. This matches both existing implementations — the review page already bands on `fulfilmentType === 'stocked'` lines only (`CheckoutReviewClient.tsx:103`), and the server bands per submitted partition.
- A `stock_on_hand` order with **no** prepaid lines is unaffected: goods bill normally and the fee applies as it does today.
- **GST** applies to `billedSubtotal + pickingFee`, so prepaid goods contribute nothing.
- **Partitioning** reuses `partitionCheckoutLines` so the rendered sections match the real orders.

### What it does not do

The server keeps final authority. `submit.ts` still re-resolves billing modes from `variant_inventory`, and `buildDraftLines` still gates zeroing on `qty_from_stock > 0`. The module makes the **client predict the server correctly** and gives submit one place to compare against. It does not become the billing authority.

The client can predict the draw safely: the PDP caps stock-on-hand orders at available stock, and the no-partial-draw rule means a short prepaid order becomes a separate MOQ purchase order. So `fulfilment_type === 'stocked'` implies the line draws its full quantity. A stock race between cart and submit is already caught by the existing `OUT_OF_STOCK` 409.

### Alternatives rejected

- **Extend `computeOrderBreakdown` with billing modes.** Smaller, but the Xero path never calls it — `buildDraftLines` builds lines independently. Xero and checkout would remain two implementations of one rule, which is the defect being fixed.
- **Server-computed breakdown via API.** Zero drift by construction, but it round-trips on every cart edit. Portal functions run in `iad1` while Supabase is in `syd`; every round trip crosses the Pacific. Actively harmful given the known regional latency problem.

## UI

Applies to **both** `/checkout` and `/checkout/review`, which are brought to parity.

### Single prepaid stock-on-hand order

```text
Staple Tee                      Pre-paid
Black / S
$12.21 × 120           $1,465.20 → $0.00

Total                              $17.25
incl. GST · billed per account terms

▼ Show breakdown
Goods (pre-paid)                    $0.00
  Drawn from pre-paid stock     $1,465.20    ← muted; makes the band derivable
Shipping                         Included
Picking fee                        $15.00
GST (15%)                           $2.25
──────────────────────────────────────────
Total                              $17.25
```

The muted "Drawn from pre-paid stock" line is load-bearing, not decoration — it is the only place the D2 banding figure appears once goods read $0.

### Mixed cart (D3)

```text
Stock-on-hand order
  Staple Tee  Pre-paid     $1,465.20 → $0.00
  Picking fee                         $15.00
  GST (15%)                            $2.25
  Order total                         $17.25

Purchase order
  Hoodie            50 × $40.00    $2,000.00
  GST (15%)                          $300.00
  Order total                      $2,300.00
══════════════════════════════════════════
Total across 2 orders             $2,317.25
You'll receive 2 invoices.
```

### Deposit

`CheckoutReviewClient.tsx:124` computes `depositAmount = breakdown.netSubtotal × depositPct / 100` — off full goods. A prepaid order would request a deposit on stock already paid for. It moves to the **billed subtotal**.

## Freshness and drift (D4)

- **New `GET /api/checkout/billing-modes`** — org-scoped, batch-reads via the same `resolveLineBillingModes` that submit uses.
- **`useFreshBillingModes(cart.lines)`** hook feeds both checkout and review. The money renders from fresh data, never from the cart snapshot.
- **On fetch failure, fail closed to `invoice_on_dispatch`** (show full price). Already the house rule — `resolve-line-billing-modes.ts:8`: *"Unknown/null → invoice_on_dispatch (conservative: bill the customer)."* It errs toward over-quoting, never under-quoting.
- **Submit sends `claimed_billing_mode` per line.** Any mismatch against the server-resolved mode → 409 `billing_mode_drift` → banner: *"Pre-paid status changed — review your cart."* Modelled on the `unit_price_drift` guard at `submit.ts:637`.
- **409 in both directions.** Even when drift favours the customer, checkout would not match the quote — which is the point of this work.

## Persistence and the journey (D5)

- **Migration (additive, independent of the currently-held migrations):** `quotes.picking_fee numeric`, `quotes.billed_total numeric`.
- **Written post-RPC at submit**, exactly like `decoration_cost` (`submit.ts:1195` writes it with a plain `admin.from('quotes').update(...)`). **No `submit_b2b_order` RPC change is required.**
- **`total_amount` is unchanged** — it stays the goods value, so Monday pushes and reporting are untouched.
- **Snapshot, never recomputed.** `billing_mode` is mutable; re-opening an old order must show what was billed, not what today's rules would bill.
- **Confirmation page and customer email** read `billed_total` and show the picking fee.
- **Staff dispatch email** keeps the goods figure — staff care what is leaving the building — relabelled from "Total" to **"Goods value"** so it cannot be mistaken for the invoice.
- **Monday** is already handled: `lib/monday/billing-note.ts` (`orderBillingNote({ needsInvoicing, pickFee })`) exists from Spec B.

## Testing

- **`order-billing-shape` unit tests** — prepaid stocked → zeroed; prepaid made-to-order → charged (the `nature` defect); non-prepaid stocked → charged; band computed pre-zeroing; GST excludes prepaid goods; mixed cart partitions with per-partition totals.
- **Band-boundary tests** — D2 is only observable at boundaries. Assert current-price banding at the $100/$200/$300/$400 edges, including a case where original and current prices fall in different bands.
- **Parity test** — the shape module's per-partition total equals the Xero draft total for the same lines. This is the regression that would have caught the original defect; it is the most valuable test here.
- **Drift guard tests** — `claimed_billing_mode` mismatch 409s in both directions; fetch failure falls closed to charging.
- **Journey test** — checkout total, persisted `billed_total`, confirmation render and email body all agree for a prepaid order.

## Out of scope

- **AUS / multi-currency.** Picking fee stays NZD-only and NZ-gated. AUD + 10% GST remains its own epic.
- **Changing the picking-fee band table.** $0-99=$35 … $400+=$15 is unchanged.
- **The `qty_from_stock` server gate.** Unchanged; the module predicts it, it does not replace it.
- **Item-level `billing_mode` drop.** Deferred with Spec 3b (quota-ledger epic).
- **Enabling Xero.** Stays deploy-dark behind `XERO_ENABLED`. This work makes checkout match what Xero *will* draft.
- **The staff portal.** This is a customer-portal change. Staff-side order views read `total_amount`, which is unchanged by design, so they are unaffected and no staff deploy is coupled to this.

## Sequencing

The three parts ship as **one deployable unit**, not as independent phases:

- UI without persistence produces the $17.25 → $1,465.20 → $17.25 whiplash (worse than today's consistent-but-wrong $1,465.20).
- UI without the freshness read (D4) renders `$0` from a possibly-days-stale snapshot — showing a number we would not honour.

The additive migration can land ahead of the code safely (new columns, nothing reads them yet).

## Open risks

- **Held migrations.** Several migrations are currently held (volume_display drop, variant_label retirement B, SKUCOLLAPSE 024/025). This migration is purely additive and independent, but it must not be bundled with a held one.
- **Two-invoice comprehension.** "You'll receive 2 invoices" is new information for customers. Worth watching in Chris's next testing pass.
