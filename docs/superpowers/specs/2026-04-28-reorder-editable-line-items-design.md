# Reorder — Editable Line Items — Design Spec

**Date:** 2026-04-28
**Status:** Draft (design approved per Jamie 2026-04-28; awaiting Chris confirmation per separate one-liner)
**Owner:** Jon (jon@theprint-room.co.nz)
**Repo:** `print-room-portal` (Next.js 16, Tailwind v4)
**Source:** Chris's 2026-04-24 meeting §46-49 — "drop decoration_type label, drop the proof image thumbnail, put design_name first then product name then color. Limit editable fields to product_name + color + size."

## 1. Context

The reorder line-item *display* (read-only) was simplified per [customer-b2b-checkout-mvp-design §15.1](2026-04-20-customer-b2b-checkout-mvp-design.md) and shipped as commit `74fb3c0` on `print-room-portal`. §15.1 explicitly locked line items as **read-only**; rationale was "live print jobs and editable reorder data don't mix; edits happen via Monday post-Deal".

Jamie's reading of Chris's §46-49 note suggests the brief moved from read-only to **editable**: customer adjusts product_name / color / size before submitting the reorder. This spec adds editable line items in the **reorder modal only** (the expanded card view stays read-only per §15.1). A feature flag gates the behaviour so it can be flipped off without redeploying UI changes.

This spec **partially supersedes** §15.1 row 13 (line items read-only). Specifically: §15.1 stays valid for the expanded-card view; the reorder modal is the new exception.

## 2. Goals

- Customer adjusts product_name, color, and per-size qty on each original item before submitting a reorder.
- Customer can drop entire items from the reorder ("don't reorder this one").
- Edits flow into the Monday CRM Deal payload so the sales team sees what was actually requested.
- Feature flag (`REORDER_EDITABLE_LINE_ITEMS`) lets the team flip back to §15.1's read-only behaviour without code changes — single boolean redeploy.
- ProjectLineItem (expanded card body) stays read-only — this spec does not touch §15.1 for that surface.

## 3. Non-goals (out of scope)

- **Product swap via typeahead** — product_name is a free-text *label override*, not a swap to a different `products.id`. Different products have different decoration setups, MOQs, and supplier paths; swapping is dangerous and belongs in a fresh quote, not a reorder.
- **Price recalculation** — reorder pricing is handled by sales in Monday post-Deal. The customer never sees a recalculated total here.
- **Decoration edits** — decoration type / placement / artwork stays untouched. Customers upload new artwork via the existing file uploader if they want a design change.
- **Adding new items** — reorder is for *the original items*, possibly trimmed and tweaked. Adding new SKUs is a fresh quote.
- **Custom validation / inventory check on color/size** — free text. Sales validates feasibility post-Deal.
- **Audit log of which fields were edited** — out of scope; the Monday payload shows the edited values, the original is on the source tracker.

## 4. Architecture

### 4.1 Feature flag

```
print-room-portal/lib/config/reorder.ts
```

Exports `REORDER_EDITABLE_LINE_ITEMS: boolean` — read from env var `NEXT_PUBLIC_REORDER_EDITABLE_LINE_ITEMS` (defaults to `'1'` → on). Both client and server import this. Client uses `NEXT_PUBLIC_` prefix so the value is available at build time. To flip off: set env to `'0'` and redeploy.

### 4.2 New component

```
print-room-portal/components/orders/EditableReorderItems.tsx
```

- Renders inside `ReorderForm` above the delivery-address field when flag is on.
- Falls back to `ProjectLineItem` (read-only) when flag is off.
- Per-item state: `productName`, `color`, `sizes: Record<string, number>`, `included: boolean`.
- Initial state seeds from `tracker.quote_data.items` via the existing helpers (`getItemDisplayName`, `getItemColorName`).
- Returns the edited shape via `onChange(items: ReorderEditedItem[])`.

### 4.3 ReorderForm changes

- Adds `editedItems` state, captures via the new component.
- Renders `EditableReorderItems` only when the tracker has `quote_data.items.length > 0`.
- On submit, includes `editedItems` in the POST body.

### 4.4 API changes

`app/api/reorder/route.ts`:
- Accept optional `editedItems` field in the request body.
- Validate: array, each has `productName: string`, `color: string | null`, `sizes: Record<string, number>`, `included: boolean`. Bound size keys to ≤ 16 chars; qty per size ≤ 100,000.
- When `REORDER_EDITABLE_LINE_ITEMS` is **on** and `editedItems` is present, pass through to the Monday helper.
- When **off**, ignore `editedItems` and use `tracker.quote_data.items` unchanged.

`lib/monday/reorder.ts`:
- `buildReorderDataFromTracker` accepts an optional `editedItems` override. When provided, replaces `originalItems` for Monday formatting purposes.
- `formatItemBreakdown` prepends `(edited from original)` when the edited shape differs from the source tracker item, so sales sees what changed at a glance. Items where `included === false` are omitted entirely with a single "Items dropped: N" line at the top of the breakdown.
- The full form response always includes a "--- Original Order Items ---" section based on the unmodified tracker, *plus* a "--- Customer-Edited Reorder Items ---" section based on edits, when edits exist. Side-by-side context for sales.

### 4.5 Persistence

`reorder_requests.payload` JSONB gains an `edited_items` field with the customer's edited shape. Source tracker fields stay unchanged (the original is `tracker.quote_data` on the trackers table — already canonical).

## 5. Data shape

```ts
interface ReorderEditedItem {
  // index into tracker.quote_data.items so server can correlate to source
  source_index: number
  product_name: string         // free text; defaults to original
  color: string | null         // free text; defaults to original
  sizes: Record<string, number> // size label -> qty; defaults to original sizes
  included: boolean            // false = customer dropped this item from the reorder
}
```

## 6. UI

### 6.1 Item row layout (editable mode)

```
┌─ [✓] Include in reorder ─────────────────────────────────┐
│  Design name (read-only, large) — primary identifier     │
│                                                          │
│  Product name [ Basic Tee, navy            ]             │
│  Colour       [ Navy                        ]            │
│                                                          │
│  Sizes:                                                  │
│   S  [12]  M  [24]  L  [16]  XL  [8]  2XL  [4]           │
│   [+ Add size]                                           │
└──────────────────────────────────────────────────────────┘
```

- Design name stays read-only (consistent with §15.1; design identity is the primary key for sales).
- Include checkbox visually fades the row when off.
- + Add size adds a row with empty size-label input + qty input.
- × per size removes a row.
- All fields are uncontrolled with `defaultValue` + `onBlur`, mirroring the catalogue editor pattern (avoids debounce noise).

### 6.2 Read-only fallback

When `REORDER_EDITABLE_LINE_ITEMS=0`, `EditableReorderItems` short-circuits to a `<ul>` of `<ProjectLineItem>` rendered identically to the expanded card body. No state, no inputs, no submit-side `editedItems`.

## 7. 4-axis stack rationale

- **Rendering** — client component for editing (state-heavy). Server-rendered nothing new — the form lives inside an existing client modal.
- **Caching** — n/a; reorder is per-customer, per-session, authenticated.
- **Performance** — items are typically ≤ 5 per past order. State + render cost is trivial. No new network calls.
- **Ecommerce pattern** — reorder = "customise an existing order then re-submit". Pattern: source items are immutable; the customer's edits are a *delta* the sales team reviews, not a price-recalculating cart.

## 8. Auth, permissions, RLS

- No new permission keys. Existing reorder API auth (signed-in user owns the tracker) covers the editable surface.
- No RLS changes — `reorder_requests` already exists per checkout MVP.
- Feature flag is build-time, not per-user; the team's review of Chris's intent is what flips it.

## 9. Decisions made

| # | Decision | Locked answer |
|---|---|---|
| 1 | Where does editing live | Reorder modal only; expanded-card view stays read-only per §15.1 |
| 2 | What's editable | product_name, color, sizes (label + qty per size); included toggle |
| 3 | Design name | Read-only (consistent with §15.1; primary identifier for sales) |
| 4 | Product swap | Not allowed — free-text label only, not a `products.id` change |
| 5 | Price recalculation | None — sales handles in Monday post-Deal |
| 6 | Validation on color / size text | Minimal — basic length / qty bounds; sales validates feasibility |
| 7 | Feature flag | Single env var `NEXT_PUBLIC_REORDER_EDITABLE_LINE_ITEMS`, default on |
| 8 | Monday payload | Both original and edited sections shown; edited items marked when divergent |

## 10. Verification

- With flag **on** + a past tracker with 2 items:
  - Modal shows both items with editable fields.
  - Edit product_name on item 1 → submit → Monday item's "Customer-Edited Reorder Items" section shows the new label, marked `(edited from original)`. Original section unchanged.
  - Toggle "include" off on item 2 → submit → breakdown shows "Items dropped: 1" + only item 1 in edited list. Original section still shows both.
  - Edit a size qty → submit → Monday shows the new size:qty.
  - Add a new size row "3XL: 5" → submit → reflected in payload.
- With flag **off**:
  - Modal renders read-only ProjectLineItem rows.
  - Submit body has no `editedItems` field.
  - Monday payload has no "Customer-Edited" section.
- Validation:
  - product_name > 200 chars → 400.
  - sizes qty < 0 or > 100,000 → 400.
  - editedItems with source_index out of bounds → 400.
- `reorder_requests.payload.edited_items` persists the edited shape (when flag on + edits provided).

## 11. Dependencies & follow-ups

- **Supersedes** §15.1 row 13 (line items read-only) for the modal surface only. §15.1 row 11/12 (display field set) still apply to the read-only fallback.
- Consumes existing `tracker.quote_data.items` shape from `lib/job-tracker`.
- Existing `lib/monday/reorder.ts` is extended; no new monday board / column env vars.
- **Follow-ups not in this spec:**
  - Product-swap via typeahead (would require pricing + decoration migration logic).
  - Price preview pre-submit.
  - Deeper validation against catalogue (e.g., flag if customer requests a colour the product no longer offers).
  - UI affordance to "see the original" inline next to each edited field.

## 12. Open questions

- **Q1 (with Chris)** — confirm the read-only-vs-editable intent. Jamie's note says editable; §15.1 says read-only. Spec defaults to editable with the flag so we can flip without redeploying UI work.
