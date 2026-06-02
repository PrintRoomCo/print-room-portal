# Chris Notes Sprint — Design Spec (2026-06-02)

**Date:** 2026-06-02
**Status:** Ready to build (grilled & locked)
**Repos:** print-room-portal (customer) + print-room-staff-portal (staff)
**Scope:** The five tomorrow-sized items from Chris's notes. The two net-new features in those notes are specced separately:
- [Reorder normalization](./2026-06-02-reorder-normalization-design.md)
- [Org inventory + audit view](./2026-06-02-org-inventory-audit-view-design.md)

> **Tell Chris before he tests:** this sprint ships items 1–5 below. The reorder-to-PDP flow and the inventory **audit** view are NOT in this build — they're on a separate track. The testing doc should cover items 1–5 only.

---

## Item 1 — Rename role `buyer` → `staff` (real value rename)

**What:** The customer-portal member role is currently `org_admin | buyer`. Rename `buyer` → `staff` end-to-end. "Staff" is the franchise's shop staff (restricted ordering); `org_admin` is the franchise owner/manager.

**Why it's the riskiest item:** `user_organizations.role` is a plain **TEXT** column (no PG enum — the only enum-style `role` is the unrelated `staff_users` table, `print-room-staff-portal/sql/001_staff_users.sql:9`), so no `ALTER TYPE`. But it's a **prod data migration + RLS + cross-repo TS** change.

**Steps (in order):**
1. **Prod data migration:** `UPDATE public.user_organizations SET role='staff' WHERE role='buyer';` (live DB, no staging — run deliberately, not at 5pm).
2. **RLS sweep:** update every policy hardcoding `'buyer'`. Known: `print-room-staff-portal/supabase/migrations/20260513000100_proof_amendment_requests.sql:88` (`uo.role IN ('org_admin','buyer')`). Grep both repos' `*.sql` for `'buyer'` and fix all — a miss silently breaks customer proof-amendment access.
3. **TS types + comparisons** (both repos): `role: 'org_admin' | 'buyer'` → `'staff'`. Hotspots: `print-room-portal/types/company.ts:17`, `lib/company.ts:137,183,208-209`, checkout/proof reads; `print-room-staff-portal` `EditRoleDialog.tsx`, `mcp-server/src/tools/members.ts`, the members role API route.
4. **UI labels:** anywhere "Buyer" shows to users → "Staff".
5. **Gate:** grep both repos for `'buyer'` / `"buyer"` → zero before done (excluding historical docs).

**Decisions locked:** real value rename (not UI-only relabel); `staff` is a single renamed role, NOT a new third role.

**Acceptance:** existing buyer members function identically as `staff`; proof amendments still work for them; no `'buyer'` left in live code paths or RLS.

---

## Item 2 — Two ordering-mode pills: `From inventory` / `Reorder`

**What:** A pill/segmented selector for the two ordering modes, driven by the catalogue item's fulfilment mode.

**Vocabulary (two layers — don't conflate):**
- Catalogue-item nature: enum `product_fulfilment_type` = `stocked | made_to_order | mixed` (stored as `b2b_catalogue_items.fulfilment_type_override`, base on `products.fulfilment_type`).
- Checkout-line routing: `'stocked' | 'make_to_stock'` (`lib/checkout/submit.ts:48`).

**Mapping:**
- Pill **From inventory** ← effective mode `stocked`; orders as line `fulfilment_type: 'stocked'`.
- Pill **Reorder** ← effective mode `made_to_order` (this label *replaces* "Made to order"); orders as `make_to_stock`.
- `mixed` products appear under **both** pills.
- Effective mode = `fulfilment_type_override ?? products.fulfilment_type`.

**Styling:** "Pill buttons" in Chris's notes = **this mode selector** rendered as a pill/segmented control (PDP order-mode toggle + catalogue mode filter). NOT a global button restyle.

**Decisions locked:** two pills (3→2; Reorder = made_to_order); mixed → both pills.

**Acceptance:** selector renders as pills; switching filters the catalogue / sets the PDP order mode; line submits with the correct checkout `fulfilment_type`.

---

## Item 3 — PDP size picker: From-inventory shows only in-stock sizes

**What:** Under the **From inventory** pill, the size picker shows **only sizes with `available_qty > 0`** and **never** the "Available to order" affordance or an availability status. Under **Reorder**, the full size range shows (made-to-order is fine).

**Where:** `print-room-portal/components/shop/VariantPicker.tsx:150-192`
- Line 178 renders **"Available to order"** (untracked/no-stock branch) — suppress in From-inventory mode.
- Line 192 renders `"{qty} in stock"` / `"0 in stock"` — drop the status text in From-inventory mode; just show selectable in-stock sizes.

**Decisions locked:** From-inventory = strictly in-stock sizes, no "available to order", no availability status column. Cart oversell guard (`CartTable`) stays as the safety net.

**Acceptance:** in From-inventory mode, zero-stock/untracked sizes are not selectable and no "Available to order" text appears; Reorder mode unchanged.

---

## Item 4 — Catalogue item editor: fulfilment-mode select

**What:** Add a control to set the catalogue item's fulfilment mode → writes `b2b_catalogue_items.fulfilment_type_override`. This is the missing piece behind "base templates from the master" — the column exists but the editor doesn't expose it (`print-room-staff-portal/src/components/catalogues/CatalogueItemEditor.tsx` has no fulfilment reference today).

**Behaviour:**
- Options: `stocked` (From inventory) / `made_to_order` (Reorder) / `mixed`.
- **Default = inherit** master `products.fulfilment_type` (so the master literally is the "base template"); AM overrides per catalogue item.
- Edits are **org/catalogue-level only** — write to `fulfilment_type_override`, **never** touch the master `products` row.

**Context (already built, no change needed):** AM adds master products to an org catalogue via the `is_b2b_only`-gated picker (`gate-filters.ts`, `products/search`); fork via `source_product_id`; override columns (`*_override`) already exist.

**Decisions locked:** editor sets override only; default inherits master; master untouched.

**Acceptance:** AM can set/clear the mode on a catalogue item; unset = inherits master; value drives which pill (Item 2) the product appears under.

---

## Item 5 — Inventory nav link (org-admin only)

**What:** Re-add an **Inventory** nav item to the customer side panel → `/inventory` (page + `/api/inventory` route already exist; just unlinked — `components/layout/Sidebar.tsx:30-31`). This sprint ships the **link + the existing basic stock table only**. The richer all-variants + audit view is the [separate spec](./2026-06-02-org-inventory-audit-view-design.md).

**Gating:** add a `requiresOrgAdmin` flag to `allNavItems` + `getNavigationItems` (`components/layout/Sidebar.tsx:32-85`); also `requiredTenantTypes: ['franchise','studio_plus_inventory']`. **Drop** `hasTrackedInventory` as a visibility condition (admins see the tab with empty state before stock exists).

**Decisions locked:** org-admin only; inventory-capable tenants only; not gated on tracked-inventory presence; basic table this sprint, audit view later.

**Acceptance:** Inventory appears in the menu for org_admins of franchise/studio_plus_inventory tenants only; hidden for staff and for plain `studio`; links to the existing stock table.

---

## Cross-cutting

- **Franchise = one org admin** is an *expectation only* — no enforcement, no constraint. Multi-member/multi-admin orgs stay supported.
- **Role-gated ordering** (sits across items 1+2): `staff` see only the **From inventory** pill; `org_admin` see both pills. Gate the Reorder pill + the job-tracker reorder entry on `isOrgAdmin`.

## Build order (suggested)
1. Item 1 role rename (do the migration/RLS first, carefully) — everything else's gating depends on the role being settled.
2. Item 4 editor mode select (so catalogue items have modes to filter on).
3. Item 2 pills + role gating.
4. Item 3 PDP size-picker behaviour.
5. Item 5 inventory nav link.

## Open for Chris (non-blocking for build, needed for sign-off)
- Confirm 3→2 pill merge (Reorder replaces Made to order).
- Confirm `mixed` → both pills.
