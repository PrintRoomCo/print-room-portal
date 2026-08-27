# Volume pricing on stock-on-hand PDPs (invoice-on-dispatch) — design

**Date:** 2026-07-28
**Repo:** `print-room-portal` (customer portal)
**Origin:** Chris / Print Room NZ asked to "surface volume pricing on stock-on-hand products' PDP." Jamie Horsefield confirmed the interpretation. Decision on billing-mode scope taken with Jon 2026-07-28.

## The ask

Show the existing volume-pricing ladder (quantity → unit price) on the product display page for **stock-on-hand** products, where today it only shows for purchase-order products.

## Current behaviour (the gap)

On the PDP (`components/shop/ProductDetailClient.tsx`), the price panel has two mutually-exclusive branches:

- **Volume ladder** — `components/shop/ProductDetailClient.tsx:1346`, gated `displayVolumeBrackets.length > 0 && !isInventoryMode`. Renders the `Volume Pricing` band list. Hidden entirely in stock/inventory mode.
- **Prepaid flat panel** — `ProductDetailClient.tsx:1369`, gated `isInventoryMode && selectedColourPrepaid && selectedColourStockPrice != null`. Renders a single "original purchase price" per-unit line. Only for **prepaid** colours.

Consequence: an **invoice-on-dispatch** stocked colour matches *neither* branch — the volume ladder is suppressed by `!isInventoryMode`, and the prepaid panel requires `selectedColourPrepaid`. So it shows **no price at all**. That is the gap this closes.

## Decision: invoice-on-dispatch only

Stock-on-hand splits by `variant_inventory.billing_mode`:

- **`invoice_on_dispatch`** — the draw is billed at the normal line price at dispatch. Only `prepaid` draws are zeroed at checkout (`lib/checkout/submit.ts:221` `isPrepaidDrawn`; `lib/checkout/billed-figures.ts` "Prepaid draws contribute 0"). So the ladder reflects what the customer is actually billed → showing it is **truthful**.
- **`prepaid`** — the draw bills **$0** at checkout (goods already paid). A per-unit ladder would mislead. Keep the existing flat "original purchase price" panel unchanged.

Chosen scope (Jon, 2026-07-28): **show the volume ladder on invoice-on-dispatch stock only; leave prepaid as-is.** The alternative "show everywhere as reference" was rejected to avoid a $0-vs-ladder mismatch; "make prepaid bill at ladder price" is a separate, larger, revenue-affecting change and is out of scope.

## The change

Single component, `components/shop/ProductDetailClient.tsx`. No schema, checkout, or pricing-data changes. No new price is entered anywhere — the ladder data (`displayVolumeBrackets`) is already loaded on the page and already respects `b2b_catalogue_items.volume_display_hidden_bands`.

Relax the ladder's render condition so it also shows in stock mode for non-prepaid colours:

```
// before
displayVolumeBrackets.length > 0 && !isInventoryMode
// after
displayVolumeBrackets.length > 0 && (!isInventoryMode || !selectedColourPrepaid)
```

`!selectedColourPrepaid` is exactly invoice-on-dispatch (billing mode is `'prepaid' | 'invoice_on_dispatch'`; the prepaid flag is `billing_mode === 'prepaid'` — see `lib/checkout/resolve-line-billing-modes.ts:15`).

The prepaid flat-panel branch (1369) is untouched. Lead time stays hidden in stock mode — we only un-hide the volume ladder.

**Per-colour, not per-product.** The decision keys off the *selected colour's* prepaid flag, mirroring the existing prepaid panel. A product with mixed prepaid/invoice-on-dispatch colours flips between ladder and flat panel as the shopper switches colour. No per-product mode is computed.

### Implementation check (not an assumption)

Confirm `displayVolumeBrackets` is populated in inventory mode. It is derived from the item's tier data + hidden-bands, independent of mode; if it turns out to be emptied/short-circuited when `isInventoryMode`, ensure it is still computed. If the item genuinely has no tiers, both branches render nothing — same as PO mode today (acceptable fallback).

## Edge cases

- **Mixed-mode product** — handled by the per-colour gate; flips on colour switch.
- **No tiers defined** — ladder renders nothing (existing PO fallback), no regression.
- **Prepaid colour** — unchanged flat panel.
- **PO mode** — `!isInventoryMode` short-circuits the new clause; behaviour identical to today.

## Testing

Component tests for `ProductDetailClient` price panel:

1. Stock mode + **invoice-on-dispatch** selected colour + tiers present → renders `Volume Pricing` band rows.
2. Stock mode + **prepaid** selected colour → renders the flat "original purchase price" panel, **not** the ladder.
3. Volume ladder respects `volume_display_hidden_bands` (hidden band absent from output) in stock mode.
4. Switching selected colour from invoice-on-dispatch to prepaid swaps ladder → flat panel.
5. PO mode unchanged → ladder renders as before.

## Out of scope

- Any checkout / billing / Xero change.
- Prepaid draws billing at ladder price.
- New pricing columns or inventory-time price entry (no such column exists; `variant_inventory` has no price — the only stock-linked price is `variant_inventory_events.unit_value`, captured from the originating order line).
