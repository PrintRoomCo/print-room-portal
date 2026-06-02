# Portal — "Quote → Order" rename + org_admin location guard (Phase 1)

**Date:** 2026-06-02
**Branch:** `feat/orders-rename-and-location-admin-gate`
**Status:** approved (scope confirmed with Jamie)

## Context

Two quick wins carved out of a larger dashboard/orders request. The third item
(order-tracker deep link) is a separate, larger piece tracked as Phase 2 — see
the open follow-up at the bottom.

Two findings reframed the original asks:

1. **Add-location already exists.** `/account` already renders a **Locations**
   section with an org_admin-gated **"Add New Location"** card → `createLocationAction`
   → `stores` table → appears in the checkout **Ship to** picker → the chosen
   store becomes the order's `shipping_address` (`lib/checkout/submit.ts`). The
   end-to-end "add a location, order to it" flow works today. The only real gap is
   that `createLocationAction` is **UI-gated only** — no server-side role check.

2. **"Recent quotes" are B2B orders.** On the customer side these submitted
   records are orders; the detail page already says "Order". The dashboard card
   and a few sibling strings still say "quote".

## Change 1 — Server-side org_admin guard on `createLocationAction`

`app/(portal)/account/actions.ts` already fetches `membership.role` but never
checks it. Add an explicit guard: if `membership.role !== 'org_admin'`, return
`{ success: false, errors: ['Only organisation admins can add locations.'] }`
**before** any `stores` insert. Defense-in-depth mirror of the existing
`access.isOrgAdmin` UI gate.

## Change 2 — Rename customer-facing "quote" → "order" (B2B surfaces only)

Display strings only — no identifiers, DB columns, types, or status enums.

| File | Old → New |
| --- | --- |
| `app/(portal)/account/AccountClient.tsx` | "Recent Quotes" → "Recent Orders"; "View all quotes" → "View all orders"; `Quote {n}` → `Order {n}`; "No quotes yet" → "No orders yet"; "Your quote history will appear here" → "Your order history will appear here" |
| `app/(portal)/my-collections/MyCollectionsClient.tsx` | "Review your quotes and approved orders before they enter production." → "Review your orders before they enter production."; empty-state "When you submit a quote, it will appear here…" → "When you submit an order, it will appear here…" |
| `app/(portal)/my-collections/[collectionId]/page.tsx` | "No items recorded on this quote." → "No items recorded on this order." |
| `components/orders/JobTrackerOrderCard.tsx` | "View Quote" → "View Order"; "…reference the original quote." → "…reference the original order." |

### Explicitly NOT renamed

- **Leavers Gear Quote Builder** (`/leavers-quotes`, `components/leavers/*`,
  `components/leavers-admin/*`): a genuine quote-request product — a quote
  request is not an order. Stays "quote".
- All code: `quote_number`, `.from('quotes')`, `interface Quote`, `quote_id`,
  `mode === 'quote'`, the `quotes` table, statuses.

## Testing

- New: `app/(portal)/account/__tests__/actions.test.ts` — `createLocationAction`
  rejects a non-`org_admin` member without inserting; allows an `org_admin`.
- Rename is display-only; no existing test asserts the changed strings (verified).
  Full `vitest` + `next build` must stay green.

## Out of scope / Phase 2 follow-up

- **Order-tracker portal-native deep link.** The "Open tracker" button currently
  builds a dead external URL (`getTrackerUrl` → `theprintroom.nz/apps/order-tracker`
  app-proxy). Decision: add a portal-native per-order tracker page (e.g.
  `/order-tracker/<token>`) reading the existing `job_trackers` data and point the
  button there. Its own spec + plan.
