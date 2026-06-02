# Reorder Normalization — Design Spec

**Date:** 2026-06-02
**Status:** Draft for review (Jamie → Chris)
**Repo:** print-room-portal (primary); schema in print-room-staff-portal / Supabase
**Relationship:** Separate from the 2026-06-02 "Chris notes" sprint (role rename, pill modes, inventory menu, availability column). Do NOT fold into that batch.

---

## Problem

The customer "Reorder" flow is a **silo**. It is built on legacy `job_trackers.quote_data` — a free-text snapshot of product *names*, colours and sizes sourced from the chatbot-api / Monday quote pipeline. It carries **no link to the catalogue product** the customer actually ordered. On reorder it just repacks that snapshot into a Monday "Deal" long-text item (`lib/monday/deal-item.ts` → `createReorderItem`), where staff "pull details from Monday/quote" by hand.

Meanwhile, orders placed through the **new B2B portal** (Phase 2 order identity) DO carry full catalogue identity per line. So the reorder flow ignores the very data that would make it self-service.

**Consequence:** reorder can't take the customer back to where the product lives, can't re-price at current rates, can't re-run stock/MOQ/access checks, and dumps manual work on staff.

## Goal

Make reorder a first-class catalogue re-order: from a past **portal order**, reconstruct the lines against the live catalogue product and route the customer through the **normal cart → `submit_b2b_order`** path — re-priced at today's rates, current skin, with all existing guards running for free. Retire the Monday-silo reorder for catalogue orders.

---

## Current state (investigated 2026-06-02)

### Order-line persistence — sufficient to rebuild ✅
Order lines = `quote_items` (orders → quotes → quote_items). Per line, available for rebuild:

| `CartLine` need | `quote_items` source |
|---|---|
| productId | `product_id` (text) |
| variantId (colour+size) | `variant_id` (uuid) |
| variantLabel | `catalogue_variant_label` (text) |
| qty | `quantity` (int) |
| decorations | `decorations` (jsonb) |
| catalogueItemId | `catalogue_item_id` (uuid) |
| fulfilmentType | derive from `route_to_inventory` / `qty_from_stock` / `qty_to_make` |
| unitPrice / brackets | **re-fetch fresh — never restore the snapshot** |

- **No size-breakdown jsonb.** Colour+size is encoded in `variant_id`: one `quote_items` row *per variant*. Rebuild = map each row → one cart line.
- **Linchpin risk:** `variant_id` is nullable on the checkout input (`lib/checkout/submit.ts:27`). If catalogue multi-skin lines persist only the text `catalogue_variant_label` and leave `variant_id` null, colour/size can't be resolved reliably. **`quote_items` is empty in prod today (no portal orders placed) — UNCONFIRMABLE until a test order lands. Verify first.** If null, persisting `variant_id` is a small fix, not a redesign.

### Cart rebuild — trivial ✅
Cart is **client-side**: localStorage `pr-cart:{orgId}` + React context, exposed as `addLine(Omit<CartLine,'lineId'>)` (`components/cart/CartProvider.tsx:18-20`). Rebuild = loop `addLine` over the order's lines, route to `/checkout`. **No backend work.**

### PDP prefill — not built ✗
`ProductDetailClient` reads **no** URL searchParams today. "Deep-link to a prefilled PDP" is the only net-new plumbing this feature needs.

### Re-pricing is automatic ✅
Rebuilding from `product_id`/`variant_id` and letting the cart/checkout re-resolve means reorder picks up current pricing, the current catalogue skin, and re-runs MOQ + stock + member-access checks via the existing `submit_b2b_order` path. This is the core scalability win — and the reason snapshots must never be restored.

---

## Proposed design

### v1 — cart-rebuild (recommended first ship)
1. "Reorder" button on a past **portal order** (orders list / order detail).
2. Read the order's `quote_items`; map each row → a `CartLine` (table above), deriving `fulfilmentType`, **omitting** stale price/brackets.
3. `addLine` each; route the customer to `/cart` (or `/checkout`) to review, tweak, submit.
4. Submits through the normal pipeline — re-priced, guard-checked, normal approval gate.

Works identically for single- and multi-product orders. No PDP changes.

### v2 — PDP deep-link (later)
Single-product reorders deep-link to the prefilled PDP (`/shop/[productId]?...`) instead of the cart, so the customer lands on the product and can adjust before adding. Requires new searchParams → state plumbing in `ProductDetailClient` + `VariantPicker`. Multi-product still uses cart-rebuild.

### Legacy job_trackers (pre-catalogue)
No `product_id` → cannot deep-link. **Keep the existing Monday-silo reorder as a fallback** for these. The population only shrinks. Do not attempt name→catalogue fuzzy matching (the unscalable trap). Optionally hide "Reorder" on trackers with no resolvable product.

---

## Decisions locked
- Reorder for catalogue orders = direct re-order through normal checkout (no separate "request" concept, no Monday-silo deal).
- Source of truth = `quote_items` (product_id-linked), NOT `job_trackers` snapshot.
- Always re-price fresh; never restore `unitPrice`/`brackets`.
- v1 = cart-rebuild for all line counts; PDP deep-link deferred to v2.
- Legacy trackers keep the Monday fallback; no backfill.

## First task / gate
**Confirm `quote_items.variant_id` is persisted non-null on catalogue lines** once a test order exists. Everything downstream assumes it. If null, add it to the persistence path before building rebuild.

## Open questions for Chris
1. v1 lands the customer at the **cart** to review before submitting — happy with that, or expect one-click "reorder placed"?
2. Reorder honours the current **approval gate** (re-priced order goes through normal approval) — correct, or should trusted reorders skip approval?
3. Hide "Reorder" entirely on legacy (non-catalogue) orders, or keep the Monday fallback visible?

## Out of scope
- Role-gating of the Reorder pill (covered by the Chris-notes sprint: staff = From inventory only).
- PDP prefill plumbing (v2).
- Any change to legacy job_tracker reorder beyond keeping it as fallback.
