# Inline split allocation on checkout: design spec

**Date:** 2026-08-28
**Status:** Approved design
**Repos affected:** `print-room-portal` (customer checkout only)
**Amends:** [`2026-08-27-split-shipment-design.md`](2026-08-27-split-shipment-design.md). Supersedes its **UI** decision row ("Sizes × destinations allocation grid per split item") and its **Split scope** row's per-item opt-in

## 1. Summary

Today a split order is edited in a block *above* the checkout item list: a Destinations card, then an Items card that re-lists every product with a "Split across destinations" checkbox and a sizes × destinations grid. The customer reads the same items twice, in two different groupings, and allocates in the copy that carries no prices.

This change collapses that into one list. Destinations become a compact chip row. Allocation moves onto the checkout line rows themselves: one number field per destination directly under the product it belongs to. The separate Items block is deleted.

Split-mode-only: none of these fields render unless the order-level "Ships to" control is set to `split`.

## 2. Decisions of record

| Question | Decision |
|---|---|
| Split opt-in | **No per-item checkbox.** Every line must allocate exactly its cart qty. There is no default destination to catch what the customer leaves unassigned |
| Allocation grain | Per **cart line** (product + colourway + size), matching the checkout rows, not per product/colourway group as today |
| Field visibility | Always visible on every line row while in split mode; never rendered otherwise |
| Destinations UI | Compact chip row (name, remove) with one inline editor panel expanding beneath, one open at a time. No destination is privileged |
| Removing a destination | Its units go back to being unallocated, which the affected rows show as `N left`. A notice says how many were released |
| One-time shipping address | Not shown and not required in split mode: the destinations carry the addresses |
| Blocked-submit messaging | A single reason string above the CTA, from one shared rule set, alongside the per-row remaining counters |
| Country-partition line rows | In split mode the item list renders **once** from the cart; per-country sections render totals only |

## 3. Problems this fixes

Both were found while reading the current code; neither is a regression introduced here.

**Duplicate rows and mismatched money under `CHECKOUT_COUNTRY_PARTITION_ENABLED=true`.** The preview route explodes a split line into one line per destination (`app/api/checkout/preview/route.ts:373`), each keeping its `cart_line_id`. That becomes `BilledLine.lineId` (`lib/pricing/order-billing-shape.ts:191`) and then a React key (`components/checkout/BilledOrderSummary.tsx:115`), so a line split 2/1 renders twice under one key. `ShipToRow` compounds it: it prints `line.qty` from the **cart** but `billedGoodsValue` from the **allocated slice**, so both rows read "$78.28 × 3" while one totals $156.56. The flag is off in `.env.local`, so this is latent today.

**Wrong item title in the current editor.** `itemKey` groups by product + colourway, but `variantLabel` already reads `"Navy / S"`. A cart holding Navy S and Navy M shows one group titled `"… / Navy / S"` whose grid contains both sizes. Deleting the grouping deletes the bug.

## 4. Surfaces

```
Ships to  [ Split shipment across destinations ▾ ]

Destinations
[ AUS HQ  × ] [ Wellington depot  × ] [ + Add ▾ ]
└─ editor panel expands here, one at a time

─── items, one row per cart line ───
[img] Everyday Pullover Hoodie    $78.28 × 3   $234.84
      Navy / S
      AUS HQ [ 2 ]  Wellington [ 1 ]        0 left

[img] Everyday Pullover Hoodie    $78.28 × 2   $156.56
      Navy / M
      AUS HQ [   ]  Wellington [   ]        2 left

─── per-country order totals ───
```

### `DestinationChips` (new, `components/checkout/DestinationChips.tsx`)

Owns the whole destinations surface. A chip per destination showing its label, a default marker, and a remove control; a trailing "+ Add" offering unused saved stores and (when `allowCustom`) a one-time address. Clicking a chip opens one editor panel beneath the row: store dropdown for saved stores, Places autocomplete for one-time addresses with the existing manual-entry escape hatch, a "make this the default" control, and Done.

Absorbs from the deleted `SplitShipmentEditor`: the `manualRefs` escape hatch, the `removeDestination` notice, and the add/patch/remove handlers.

### `LineAllocationFields` (new, `components/checkout/LineAllocationFields.tsx`)

One cart line's allocation. One number input per destination plus a status cell:

| Line state | Status cell |
|---|---|
| remaining > 0 (including a line with no entries) | `N left`, amber |
| remaining = 0 | `0 left`, gray |
| remaining < 0 | `N over`, red |
| no destinations yet | fields replaced by "Add a destination above to split this line" |

Carries `data-testid={`remaining-${lineId}`}` on the status cell, as `AllocationGrid` did.

**Must survive the move from `AllocationGrid`:** only the cell being edited holds its raw string, every other cell renders straight from props. That is what lets someone type `1` on the way to `12` without the display fighting back, while no other cell can go stale.

Inputs are labelled `"<productName> <variantLabel> to <destination label>"`. The grid's size-row header is gone, so the line identity has to live in the label.

### `ShipToRow`

Unchanged. `renderShipLine` in `CheckoutClient` composes `LineAllocationFields` beneath it, indented past the 96px image so the fields align with the product text.

### Deleted

`components/checkout/SplitShipmentEditor.tsx`, `components/checkout/AllocationGrid.tsx`, `components/checkout/AllocationGrid.test.tsx`.

## 5. State model

`lib/checkout/split-shipment-state.ts`:

- **`SplitShipmentState.splitItemKeys` removed**, with `isItemSplit` and `itemKey`.
- **`SplitShipmentState.defaultDestinationRef` removed.** The API still requires a `default_destination_ref`, so `defaultDestinationRefForRequest(state)` nominates the first destination at the request boundary. Full allocation makes it unreachable, and the customer is never asked to pick something that cannot be used.
- **`buildSplitAllocations`** drops its `isItemSplit` filter and emits entries for any line holding at least one valid entry.
- **`EditorCartLine`** narrows to `{ lineId, qty }`. With `itemKey` gone nothing in this module reads a product or variant id.
- **`removeDestination`** returns `releasedUnits` and leaves them unallocated. Quietly re-homing units somewhere the customer did not choose would be as wrong as dropping them.
- **`splitBlockReason(input): string | null`** is new: the first blocker in a fixed order, human-readable. `splitShipmentComplete` becomes a thin wrapper (`splitBlockReason(...) === null`) so completeness and messaging can never disagree.

`lib/checkout/allocation.ts` is new and holds `AllocationMap`, `AllocationDestination`, `allocatedForLine`, `remainingForLine` and `lineFollowsDefault`, moved out of `AllocationGrid`. Today `lib/checkout/split-shipment-state.ts` imports `AllocationMap` from a component; that dependency direction is backwards and the component is being deleted anyway.

The completeness rule, restated: for each cart line, its allocation entries must all reference live destinations, each be a positive integer, and sum to exactly the line's qty. A line with no entries fails that sum, which is what makes full allocation compulsory. Every destination must receive something. Evaluated against the **live** cart lines, as today, so a qty edit in the cart pill re-invalidates immediately.

## 6. Country-partition path

In split mode, `CheckoutClient` renders the item list once from the billed shape (one row per cart line) and passes `showLines={false}` to `CountryBilledOrderSummary`. Only that component needs the flag: the flag-off `BilledOrderSummary` reads a shape built from the cart, which never explodes a line. Each country order keeps its own subtotal, split fees, tax and total; only the per-line rows stop being emitted from the prepared partitions.

That removes the duplicate keys and the qty/value mismatch in §3, and it makes the row's price column describe the whole cart line, which is what the fields under it allocate. The cost, stated plainly: on a cross-country split the row shows the line's default-currency price rather than each destination country's repriced figure. The per-country sections below carry the invoicing truth. Rejected alternative: keep exploded rows for money and attach fields to only the first occurrence of each `lineId`, which needs render-order-dependent bookkeeping inside a callback the summary components own.

## 7. Testing

| File | What it pins |
|---|---|
| `lib/checkout/allocation.test.ts` (new) | `allocatedForLine` / `remainingForLine`, ported from `AllocationGrid.test.tsx` |
| `lib/checkout/split-shipment-state.test.ts` (rewrite) | Line with no entries ships to default; line with 1 of 3 allocated is incomplete; stale ref invalidates; untouched destination blocks; `splitBlockReason` order |
| `components/checkout/LineAllocationFields.test.tsx` (new) | Raw-string editing survives (type `1` then `12`); each status-cell state; zero-destinations hint |
| `components/checkout/DestinationChips.test.tsx` (new) | One panel open at a time; removal notice reports released units; default marker moves |
| `components/checkout/BilledOrderSummary.test.tsx` (extend) | Totals-only mode emits no line rows but keeps split fees, tax and total |

## 8. Out of scope

- `/checkout/review` and the confirmation page. `CheckoutReviewClient` reads `reviewState.destinations` + `allocationsByLineId`, whose shapes do not change.
- The request body sent to `/api/checkout` and `/api/checkout/preview`. `buildDestinationInputs` and `buildSplitAllocations` keep their output shapes, so no route, `prepare`, or `submit` change is required.
- The order-level `OrderShipToControl`.
- The server contract. `default_destination_ref` stays required by `destination-request.ts` and `explodeCheckoutLines` keeps its unallocated-line path; this change only stops the client from ever exercising it.
