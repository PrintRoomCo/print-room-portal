# From-inventory production top-up — design

**Date:** 2026-06-05
**Repo:** print-room-portal (customer-facing B2B portal)
**Surface:** PDP — `components/shop/ProductDetailClient.tsx`
**Status:** Approved design, ready for implementation plan.

## Problem

When an org_admin orders from the **From inventory** pill and the requested qty
for a size exceeds available stock, the PDP currently **blocks** the order
(`inventoryIntentShortfall` guard) and tells them to reduce the qty or switch to
Re-order. There is no way to draw down the stock that exists and make up only the
shortfall in a single from-inventory action.

Desired: ordering 24 Small when 23 are in stock should draw 23 from inventory and
treat **1 as "to be made"** (not 24). A production run is only economical at the
product's MOQ, so the to-be-made portion must reach MOQ before the order can be
added to cart / pass checkout.

## Scope

Applies **only** when `canChooseOrderIntent && orderIntent === 'inventory'`:

- viewer is `org_admin` (`isOrgAdminViewer`),
- product is not `fulfilment_type === 'stocked'`,
- current selection has tracked stock (`currentSelectionHasInventory`),
- product has volume tiers (`brackets.length > 0`),
- the **From inventory** pill is selected.

Out of scope (behaviour **unchanged** — existing hard cap at available stock):

- restricted staff members (`!isOrgAdminViewer`) — inventory-only by role,
- `stocked`-only products (no production tiers to run against),
- variantless multi-size (Mode 2) — untracked, no stock to draw from.

## Behaviour

### 1. Relax the from-inventory cap (in scope only)

A per-size qty above available stock is permitted. The overflow `qty − stock`
becomes the production ("to be made") portion. The qty input already has no max;
only the `inventoryIntentShortfall` guard blocks it today — that guard is replaced
for this scope by the made-portion MOQ guard below. Restricted-staff / non-toggle
inventory mode keeps the existing `inventoryIntentShortfall` hard block.

### 2. Per-product to-be-made sum

```
toBeMadeSum = Σ over every touched variant of max(0, qty_v − stock_v)
```

Summed across all colours/sizes of the product, matching the server's per-product
MOQ rollup (`submit.ts`). Not measured per individual size.

### 3. MOQ floor on the made portion

Replaces the old "reduce qty / switch to Re-order" block for the in-scope case:

| Condition | Result |
| --- | --- |
| `toBeMadeSum === 0` | Pure stock draw — no MOQ (unchanged). |
| `0 < toBeMadeSum < effectiveMoq` | **Block** Add-to-cart with the message below. |
| `toBeMadeSum ≥ effectiveMoq` | Allow. |

Block message:

> Production run minimum is {effectiveMoq}. {toBeMadeSum} to be made — add
> {effectiveMoq − toBeMadeSum} more, or reduce to draw only from stock.

Uses the product's real `effectiveMoq` (NOT the inventory-mode `1`). The total-qty
MOQ stays at `1` (`activeMoq` unchanged) so any stock amount ≥ 1 can still be drawn.

### 4. Cart split (`handleAddToCart`)

For each in-scope touched variant where `qty > stock`, emit **two cart lines**:

- a `'stocked'` line of `min(qty, stock)` (omit if 0),
- a `'make_to_stock'` line of `qty − stock` (omit if 0).

Within-stock variants stay a single `'stocked'` line. `lineSignature` already
includes `fulfilmentType`, so the stocked and made lines for the same variant never
merge and each is independently editable/removable in the cart. Apply to:

- Mode 1 `multi_size_with_variants`,
- Mode 3 `one_size`.

Mode 2 `multi_size_variantless` is out of scope (untracked → no stock to split).

### 5. UI

- "Your order" summary already renders `(23 in stock, 1 to be made)` via the
  existing `orderLines` `inStock`/`toBeMade` math — keep.
- Add a per-product hint when `toBeMadeSum > 0`:
  `{toBeMadeSum} to be made · production min {effectiveMoq}`.
- Show the block message under Add-to-cart when blocked.
- Relax the size-grid "to be made" caption (currently `!isInventoryMode`-gated at
  ~L921) to also show in this overflow case.

### 6. Server — no change

`lib/checkout/submit.ts` already sums only `make_to_stock` qty per product against
`effectiveMoq` and exempts `'stocked'` lines (L358–L417). The split lines carry the
correct `fulfilment_type`, so the made line counts toward MOQ and the stocked line
draws down inventory. The server check is a redundant safety net behind the new
client guard.

## Pricing (verify during implementation)

- Stocked portion: from-inventory effective price (as today).
- Made portion: priced off the product's volume brackets.
- `recomputeProductTierPrices` pools lines by `productId + decorationSignature`
  across both fulfilment types, so total volume drives the tier. Confirm this is the
  intended behaviour (total order volume earns the tier on the made line).

## Surplus reality (accepted)

Raising the made portion to MOQ produces surplus = `effectiveMoq − actual shortfall`,
which lands on the org's inventory shelf (existing `make_to_stock` behaviour). Chosen
resolution is **block-and-prompt** so the org_admin makes that call deliberately; the
"to be made" numbers in the summary make the surplus visible. No extra surplus warning
caption in v1.

## Test coverage

New (extend `ProductDetailClient.inventory-sizes.test.tsx` / a new test file):

- org_admin From-inventory overflow → emits a `stocked` line + a `make_to_stock` line
  with correct quantities,
- `0 < toBeMadeSum < moq` → Add-to-cart disabled + block message shown,
- `toBeMadeSum ≥ moq` → Add-to-cart enabled, split lines added,
- to-be-made summed across multiple sizes/colours against one MOQ,
- restricted staff still hard-capped (no overflow, existing shortfall block),
- summary hint text renders when overflow exists.

Existing `ProductDetailClient.pills.test.tsx`, `ProductDetailClient.inventory-sizes.test.tsx`,
and `submit.*` tests must stay green.

## Non-goals

- No change to restricted-staff role boundary.
- No change to server MOQ logic or schema.
- No surplus-to-shelf warning caption (v1).
- No auto-bump of the made qty (block-and-prompt only).
