# Purchase-order minimum order value ($500)

**Date:** 2026-08-27
**Repo:** `print-room-portal` (customer portal)
**Status:** Design approved, ready for implementation planning

## Problem

Made-to-order production runs carry fixed setup costs that small orders do not
cover. Today a customer can place a purchase order of any value through the
portal. We want a floor: purchase orders under $500 are blocked from
progressing.

## The rule

An order is **gated** when all of the following hold:

1. Its prepared partition classifies as `purchase_order` — i.e. any line is
   made-to-order, per `classifyOrderType` in `lib/orders/order-type.ts`.
2. Its **notional value** is below **500 units of that partition's billing
   currency**.
3. No exemption (below) applies.

A gated order cannot be submitted.

### Notional value

Notional value = goods subtotal + decoration revenue.

- **Excludes** GST and the picking fee. The minimum measures the value of the
  work, not the invoice, so it stays stable across tax-rate and fee changes.
- **Counts prepaid lines at full value**, not at their $0 billed value. A
  prepaid-heavy order still represents a real production run, so it must not be
  gated for having already been paid for.

This figure is already computed in `lib/checkout/prepare.ts` as
`goodsValueForBand` (`garmentSubtotal + totalDecorationRevenue`, where
`garmentSubtotal` sums every repriced line before prepaid zeroing). The gate
reads that existing value; it introduces no new pricing arithmetic.

### Mixed carts

A cart containing both stock-on-hand and made-to-order lines is **already split
into two separate orders before pricing** — `partitionCheckoutLines`
(`lib/checkout/partition.ts:59`) sends every `made_to_order` and legacy line to a
`purchase_order` partition and every `stocked` line to a `stock_on_hand` one, and
the route calls it at `app/api/checkout/route.ts:412` (flag off) and via
`buildCheckoutExecutionPlan` (flag on). Every partition that reaches `prepare` is
therefore homogeneous.

The minimum is tested against **each purchase order on its own**. Example: $600
of stock tees plus one $80 made-to-order hoodie becomes an $80 purchase order and
a $600 stock order; the $80 order is gated and needs $420 more, while the stock
order is never gated.

Rationale: this is the reading the architecture already has. `prepare` sees one
homogeneous partition, so the annotation the customer is shown and the value the
submit backstop enforces are the same number. Summing the two halves back
together would leave the backstop measuring only one of them, so a direct API
call posting just the $80 hoodie could place an order the UI had blocked.

(Decided 2026-08-27, after tracing the F1 split. An earlier draft of this section
claimed the $680 cart would pass — it described a single-order world the code
does not have.)

### Currency and country partitions

The threshold is **500 in the partition's own billing currency** — NZD 500 for
NZ orders, AUD 500 for AU orders. No FX conversion is involved.

When country partitioning splits a cart into separate NZ and AU orders, each
partition is evaluated independently against its own notional value and its own
currency. One partition can be gated while the other is not.

## Exemptions

Any single exemption clears the order. All four are OR'd together.

| # | Exemption | Source | Status |
|---|---|---|---|
| 1 | Org-level exempt flag | `organizations.min_order_exempt` (new) | needs staff-repo migration |
| 2 | Demo/test org | `organizations.is_test` → `context.isTest` | already on checkout context |
| 3 | Inventory restock | `intent === 'inventory'` | already on `CheckoutInput` |
| 4 | Pure pre-order | every line's catalogue item ∈ `preOrderItemIds` | already resolved in `prepare` |

**Exemption 1 — org flag.** Mirrors the existing `organizations.moq_exempt`
precedent exactly: same table, boolean, default `false`, read into the checkout
context in `lib/checkout/server.ts` alongside `moqExempt` and `isTest`. It is
the escape hatch for negotiated accounts, avoiding a code change per exception.

**Exemption 4 — pure pre-order.** Applies only when *every* line in the
partition is a pre-order period item. A cart mixing period items with ordinary
made-to-order goods is **not** exempt. Requiring all lines closes the loophole
where one cheap period item would exempt an unrelated order. `prepare` already
holds `openPeriod` and `preOrderItemIds`, so this is a set membership check over
the lines' catalogue item ids.

## Architecture

### The policy module

New file `lib/checkout/minimum-order.ts`, pure — no I/O, no Supabase:

```ts
export const PURCHASE_ORDER_MINIMUM = 500

export interface MinimumOrderExemptions {
  orgExempt: boolean
  isTest: boolean
  isInventoryIntent: boolean
  allPreOrder: boolean
}

export interface MinimumOrderStatus {
  /** False when the order is stock-on-hand or an exemption cleared it. */
  applies: boolean
  /** True when the gate does not block: !applies, or value >= threshold. */
  met: boolean
  threshold: number
  currency: string
  value: number
  /** 0 when met; otherwise threshold - value, rounded to cents. */
  shortfall: number
}

export function evaluateMinimumOrder(input: {
  orderType: OrderType
  notionalValue: number
  currency: string
  exemptions: MinimumOrderExemptions
}): MinimumOrderStatus
```

Every layer calls this one function, so the cart hint, the checkout meter and
the submit backstop cannot disagree about the policy. Being pure, the whole rule
is unit-testable without a database.

### Three enforcement layers

**1. Cart — advisory hint.** The cart page and drawer compute a
`MinimumOrderStatus` from cart state and render a banner showing the threshold,
current value and shortfall, disabling the checkout button only under the
conditions in the table below. This follows the existing `onMoqViolationChange`
wiring between `CartTable` and `CartDrawer`.

Inputs at this layer are approximations of what `prepare` will later compute
exactly:

- **order type** — from the cart lines' `fulfilment_type`, the same input
  `classifyOrderType` takes.
- **notional value** — cart-held line prices × quantity, plus known decoration
  costs, with prepaid lines counted at full value.
- **currency** — the org's display currency. The cart is pre-partition, so it
  cannot know a per-country split; a cart destined to partition is checked once
  against the org's own currency here and re-checked per partition at checkout.
- **exemptions** — `orgExempt` and `isTest` are passed as props from the server
  component. The other two are *not resolvable at cart time*: inventory intent
  is a checkout-time toggle (`addToInventory`, offered to franchise and
  `studio_plus_inventory` orgs), and pre-order membership depends on the open
  period resolved server-side.

Because two exemptions are unresolvable here, this layer must never falsely
block an order that checkout would clear. It therefore has two tiers:

| Cart state | Behaviour |
|---|---|
| Under minimum, and no exemption is still possible — org cannot route to inventory **and** no line is a pre-order item | Banner + **checkout button disabled** |
| Under minimum, but an exemption may yet apply | Banner only, worded as "may be below the minimum"; **button stays enabled** |
| At or over minimum, or already exempt via org/test flag | Nothing shown |

This layer is otherwise advisory: cart-held prices can drift from repriced
values, so it is a hint that saves the customer a wasted trip to checkout, never
the final word. It may warn on an order that checkout later clears; it must
never be the only thing blocking one.

**2. Checkout — server-computed truth.** `prepareCustomerOrderPartition`
attaches `minimumOrder: MinimumOrderStatus` to each `PreparedCheckoutPartition`.
All four exemptions are fully resolvable here: `orgExempt` and `isTest` from
`input.context`, `isInventoryIntent` from `input.intent` (already forwarded by
the preview route), and `allPreOrder` from the `openPeriod` / `preOrderItemIds`
that `prepare` already resolves. This annotation is therefore the authoritative
verdict.

The `/api/checkout/preview` route passes it through unchanged in each `ok: true`
outcome. `CheckoutClient` renders a per-partition message and disables Place
Order.

The annotation **does not throw**. A thrown error would collapse the partition
into an `ok: false` pricing failure and discard the totals the message needs to
display — the customer would lose their order summary at the moment they most
need to see it.

**3. Submit — hard backstop.** `submitCustomerOrder` already calls
`prepareCustomerOrderPartition` internally, so it **reads the annotation rather
than recomputing it**: if `prepared.minimumOrder.met` is false it throws a typed
`MinimumOrderValueError` **before** the `submit_b2b_order_for_country` RPC call,
joining `StockShortfallError` and `MoqViolationError` in
`lib/checkout/errors.ts`. Reading rather than re-evaluating removes any
possibility of the displayed verdict and the enforced verdict diverging.

The error carries the full `MinimumOrderStatus`. The checkout route maps it to
HTTP 422 with `{ code: 'minimum_order_value', status: MinimumOrderStatus }`, which
the client renders using the same copy as the checkout banner.

This guarantees nothing under-minimum reaches the database even if the UI is
bypassed, a stale tab replays a request, or a client-side check is defeated.

### What is deliberately not touched

The shared `submit_b2b_order_for_country` RPC and the staff portal are
unchanged. Staff placing an order on a customer's behalf is the intended manual
override for genuine small runs, and pairs with the customer-facing contact CTA.

## Customer-facing behaviour

A blocked customer sees the threshold, their current value, the shortfall, and a
contact CTA. Copy:

> Made-to-order orders have a $500 minimum (excl. GST). This order is $380 —
> add $120 to continue, or [talk to us about smaller runs](mailto:hello@theprint-room.co.nz).

The mailto carries the prefilled subject `Order below $500 minimum`. Currency
symbol and amounts render in the partition's billing currency using the portal's
existing money formatting.

The cart-layer "may be below the minimum" wording is softer but carries the same
threshold, value and CTA, so a customer who can still clear the gate via an
exemption is told what to do rather than merely warned.

There is no "submit anyway" path and no quote-request fallback: under-minimum
orders are a hard stop, and the CTA routes those customers to a human.

## Testing

Vitest, following existing repo patterns:

- **`minimum-order.test.ts`** — exhaustive unit tests on `evaluateMinimumOrder`:
  each exemption individually and in combination; the boundary at exactly
  500.00 (met) versus 499.99 (gated); stock-on-hand orders never applying;
  currency passthrough; shortfall rounding to cents.
- **`prepare`** — the annotation appears on prepared partitions; prepaid lines
  are counted at notional value, not $0; a mixed NZ/AU cart evaluates each
  partition against its own currency.
- **`submit`** — `MinimumOrderValueError` throws before the RPC is called
  (assert the RPC mock was never invoked); an exempt org passes through; an
  `intent: 'inventory'` order under $500 passes through.
- **Component** — cart banner renders the shortfall and disables the checkout
  button when no exemption is still possible; renders the softer wording with
  the button **enabled** when the org can route to inventory or a pre-order line
  is present; renders nothing for an exempt org.

## Rollout

Enforcing at deploy. No feature flag: this is policy, not an experiment, and the
org exempt flag plus the staff override path handle individual cases.

Order of operations:

1. Author and apply the `organizations.min_order_exempt` migration **from
   `print-room-staff-portal`** — that repo owns the shared schema
   (`supabase/migrations/README.md`). Column defaults `false`, so it is inert
   until the portal ships.
2. Regenerate/refresh types into `print-room-portal` if needed.
3. Deploy the portal changes.

## Follow-ups (out of scope)

- Staff-portal UI toggle for `min_order_exempt` on the b2b-accounts org page.
  Until then the flag is set via SQL. (Staff repo.)
- Promoting `PURCHASE_ORDER_MINIMUM` from a code constant to per-country DB
  config if thresholds ever need to diverge per market or change without a
  deploy.
