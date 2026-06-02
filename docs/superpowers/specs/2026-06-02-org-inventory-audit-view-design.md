# Org Inventory + Audit View — Design Spec

**Date:** 2026-06-02
**Status:** Draft for review (Jamie → Chris)
**Repo:** print-room-portal (customer side); data already in Supabase
**Relationship:** Carved out of the 2026-06-02 "Chris notes" sprint. The sprint ships only the **nav link + basic stock table**; this richer view is its own track.

---

## Problem

Chris wants org admins to have a real inventory surface in the customer portal: a separate **Inventory** tab (org-admin only) showing tracked stock across **all products and all variants** for their org — mirroring the staff-portal inventory page — **plus an audit trail** of where stock has been shipped and which of their staff placed each order.

Today there is **no Inventory nav item** in the customer portal ("Catalogue absorbs the previous Shop + Inventory surfaces" — `components/layout/Sidebar.tsx:30-31`). A basic `/inventory` page + `/api/inventory` route still exist but are unlinked and show only a flat per-variant availability list — no audit, no who/where.

## Goal

An org-admin-only Inventory tab that shows the org's full stock position per product/variant, and a per-variant (or per-event) audit trail answering: **what moved, who ordered it, where it shipped, when.**

---

## Current state (investigated 2026-06-02)

### Stock position — exists
- `variant_inventory` (per org/variant stock) and a `variant_availability` view feed the existing `/api/inventory` route (`stock_qty`, `committed_qty`, `available_qty`).
- The existing `/inventory` page renders a basic version of this (`CustomerInventoryRow`).

### Audit trail — derivable from existing data, NO new instrumentation
Ledger: `variant_inventory_events` — columns: `variant_id`, `organization_id`, `delta_stock`, `delta_committed`, `reason`, `note`, `reference_quote_item_id`, `staff_user_id`, `created_at`, `prepaid`, `unit_value`.

Live data shows the event reasons: `order_commit`, `pre_approved_inventory` (order-driven), `intake`, `count_correction` (manual staff).

**Key finding — `staff_user_id` is the wrong source for "who ordered":**

| reason | rows | has `staff_user_id` | has `reference_quote_item_id` |
|---|---|---|---|
| order_commit | 14 | 0 | 14 |
| pre_approved_inventory | 6 | 0 | 6 |
| intake | 3 | 3 | 0 |
| count_correction | 2 | 2 | 0 |

`staff_user_id` is NULL on all order-driven events (it only tags manual staff intake/corrections). The customer ordering user must be resolved through the order line:

- **Who ordered:** `variant_inventory_events.reference_quote_item_id` → `quote_items.quote_id` → `quotes.created_by` → `profiles` (the org staff member who placed the order).
- **Where shipped:** `quote_items.ship_to_store_id` → `stores`.
- **What / when / why:** straight off the ledger row.

So the audit view is buildable entirely from existing tables via joins. No schema change.

---

## Proposed design

### Inventory tab (nav)
- New **Inventory** nav item → `/inventory`, gated on `isOrgAdmin` (new `requiresOrgAdmin` flag in `getNavigationItems`) **and** `requiredTenantTypes: ['franchise','studio_plus_inventory']` (inventory-capable shapes; plain `studio` excluded).
- Drop `hasTrackedInventory` as a visibility condition — admins see the tab (with empty state) before stock exists.
- *(The nav link + basic table is the part that ships in the sprint; the page content below is this spec's scope.)*

### Stock table
- All products/variants for the org: product, colour, size, `stock_qty`, `committed_qty`, `available_qty`, last-updated. Mirror the staff inventory page's columns/feel. Org-scoped (RLS / service-role with `organization_id` filter).

### Audit trail
- Per variant (drill-in) or a filterable org-wide event feed, from `variant_inventory_events`:
  - **Movement:** reason + delta (stock/committed), note.
  - **Who:** resolved order-placer via `quotes.created_by` for order events; `staff_user_id` for manual events; "Print Room" for staff adjustments.
  - **Where:** ship-to store via `quote_items.ship_to_store_id` (order events only).
  - **When:** `created_at`.
- Read-only for org admin (no adjustments from the customer side in v1).

---

## Decisions locked
- Org-admin only; inventory-capable tenants only; org-scoped to their own data.
- Audit "who" = `quotes.created_by` for order events (NOT `staff_user_id`).
- "Where" = `quote_items.ship_to_store_id`.
- Read-only view; no customer-side stock edits in v1.
- No new schema / no new instrumentation — all joins over existing tables.

## Open questions for Chris
1. Audit granularity: **per-variant drill-in**, or a single **org-wide event feed** with filters (product, store, person, date)? (Rec: org-wide feed + per-variant filter.)
2. Should manual staff adjustments (`intake` / `count_correction`) appear in the customer's audit, or only customer-driven order movements? (Rec: show all, labelled by source — full transparency.)
3. Any export need (CSV) for the org admin? (Rec: defer to v2.)

## Out of scope
- Customer-side stock adjustments / counts (staff-portal only).
- The nav link + basic stock table (ships in the 2026-06-02 sprint).
- CSV export (v2).
