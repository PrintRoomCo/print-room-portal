# Reorder + Inventory/Audit — E2E Test Script (2026-06-02)

**For:** Chris (manual acceptance testing)
**App:** Customer portal (`print-room-portal`)
**Covers:** the two features shipped to `main` on 2026-06-02 —
1. **Reorder from a past order** (the Reorder button on the order tracker)
2. **Inventory + stock-movement audit view** (the new Inventory tab)

> **NOT in this script:** the 5 "sprint" items from your notes (role rename `buyer`→`staff`, the From-inventory / Reorder ordering pills, PDP in-stock-only sizes, catalogue-item fulfilment-mode select, the basic Inventory nav link). Those are a separate build/test pass — Jamie will confirm when they're live. This script is just the two features above.

---

## ⚠️ Read first — this is the LIVE site

There is **no test/staging database** — the portal you're testing writes to the **real production** Supabase.

- Any order you **submit** is a **real order** (it posts through the normal approval/Monday pipeline). Either use a known throwaway test org, or stop at the `/cart` step (don't click final submit) unless Jamie says to push one through.
- The Inventory and audit views are **read-only** — looking at them changes nothing. Safe to click freely.
- If anything looks wrong, **stop and note it** (don't retry repeatedly) — write what you saw in the Notes line and move on.

---

## Before you start — what you need

| # | Prerequisite | Why |
|---|---|---|
| 1 | An **org-admin** login for an inventory-capable org (e.g. PRT "Test Catalogue", `hello@…`) | Both features are admin-only; the org must be a **franchise** or **studio + inventory** tenant for the Inventory tab |
| 2 | A **non-admin (staff)** login in the **same org** | To prove the admin-only gates actually hide things from staff. Ask Jamie if you don't have one |
| 3 | A **completed** past order that was placed through the **new catalogue checkout** (so it carries a re-order link) | Feature A's main path only appears on **completed** orders that came through the new flow. If none exists yet, ask Jamie to set one up — see note below |
| 4 | (Optional) A **legacy** past order (older order, not through the new catalogue flow) | To test the fallback path (A3) |

> **Setup note for #3:** the new "rebuild my cart" Reorder only shows on orders that (a) are marked **completed** and (b) were placed via the new catalogue checkout. Brand-new orders aren't "completed" yet. If there's no suitable order, Jamie can place one and advance it to completed, or point you at one. **Tell Chris which order to use** before he starts.

**How to read each test:** do the **Steps**, check the result against **Expected**, tick ☐ **Pass** or ☐ **Fail**, and jot anything odd in **Notes**.

---

## Feature A — Reorder from a past order

Where: the **Tracking** tab in the left menu (this is your past-orders / project list). The **Reorder** button sits on each finished order's card, next to "View Quote" / "Track Project".

### A1 — Reorder a catalogue order rebuilds the cart  *(org-admin)*
**Steps**
1. Sign in as the **org-admin**.
2. Open **Tracking**.
3. Find the **completed** order from prerequisite #3 and click **Reorder**.

**Expected**
- The button briefly shows **"Rebuilding…"**, then you land on the **Cart** (`/cart`).
- The cart contains the **same products, quantities, colours and sizes** as the original order.
- No error message appears.

☐ Pass ☐ Fail — **Notes:** ____________________

### A2 — Reorder uses CURRENT prices, not the old order's prices
**Steps**
1. From A1, look at the unit prices in the rebuilt cart.

**Expected**
- Prices reflect **today's** catalogue/agreed pricing for those products and quantities — **not** a frozen copy of what the order cost last time.
- (If the price for a product has changed since the original order, the reordered cart shows the **new** price. This is intended — the reorder re-prices fresh and re-checks minimums/stock.)

☐ Pass ☐ Fail — **Notes:** ____________________

### A3 — A legacy order falls back to the old "Reorder project" form
**Steps**
1. Still as **org-admin**, find a **legacy** order (prerequisite #4, an older one not from the new flow) and click **Reorder**.

**Expected**
- Instead of rebuilding the cart, a pop-up titled **"Reorder project"** opens (the existing form that emails your account manager).
- This is the **unchanged** old behaviour — correct for legacy orders.

☐ Pass ☐ Fail — **Notes:** ____________________
*(Skip if no legacy order is available — note "no legacy order to test".)*

### A4 — Staff (non-admin) see NO Reorder button at all
**Steps**
1. Sign out, sign in as the **non-admin / staff** member of the same org.
2. Open **Tracking** and look at the order cards — **completed** ones included.

**Expected**
- **No "Reorder" button appears on any order** — neither catalogue nor legacy.
- ("View Quote" / "Track Project" can still appear — only **Reorder** is hidden.)

☐ Pass ☐ Fail — **Notes:** ____________________

### A5 — Reorder only shows on completed orders
**Steps**
1. Back as **org-admin**, look at an order that is **still in progress** (not completed).

**Expected**
- That in-progress order has **no Reorder button** (it appears only once an order is completed).

☐ Pass ☐ Fail — **Notes:** ____________________

---

## Feature B — Inventory + stock-movement audit view

Where: the new **Inventory** item in the left menu. The page (`/inventory`) has two stacked panels: **Stock on hand** (current quantities) and **Stock movements** (the audit trail of every change — what moved, who ordered it, where it shipped, when).

### B1 — Who can see the Inventory tab  *(the gate)*
**Steps & Expected** — sign in as each and check:

| Sign in as | Expected |
|---|---|
| **Org-admin** of a franchise / studio+inventory org | **Inventory** appears in the menu and opens `/inventory` |
| **Non-admin / staff** of the same org | **No** Inventory menu item. Typing `/inventory` in the address bar **bounces you to the Catalogue** page |
| **Org-admin** of a plain **studio** org (no inventory) — if available | **No** Inventory menu item |
| Signed out, go straight to `/inventory` | Sent to **sign-in** |

☐ Pass ☐ Fail — **Notes:** ____________________

### B2 — Stock on hand table
**Steps**
1. As the **org-admin**, open **Inventory**.

**Expected**
- The **Stock on hand** table lists the org's variants with columns: **Product, Colour, Size, Available, In stock, Committed**, plus an **Audit** column with a **View** button.
- Numbers look sensible (match what you'd expect / the staff inventory view).

☐ Pass ☐ Fail — **Notes:** ____________________

### B3 — Stock movements show WHO ordered and WHERE it shipped  *(the headline)*
**Steps**
1. Scroll to the **Stock movements** panel.
2. Find a movement caused by an **order** (an order/commit type movement).

**Expected**
- It shows a real **Who** — the **name of the person who placed that order** (not blank, not a system id).
- It shows a real **Where** — the **ship-to store** for that order.
- **When** (date) and **Δ Stock** (the quantity change, e.g. −5) are populated.

☐ Pass ☐ Fail — **Notes:** ____________________

### B4 — Manual Print Room adjustments also appear, labelled by source
**Steps**
1. In **Stock movements**, find a **manual** adjustment (a stock intake or a count correction done by The Print Room, not an order).

**Expected**
- It appears in the **same** feed (nothing is hidden — full transparency).
- **Who** shows the staff member's name, or **"Print Room"** if no name is recorded.
- **Where** shows **"—"** (manual adjustments have no ship-to store).

☐ Pass ☐ Fail — **Notes:** ____________________
*(If the org has no manual adjustments, note "none to test".)*

### B5 — Filter the audit to one variant
**Steps**
1. In the **Stock on hand** table, click **View** on one row.
2. Then click **Clear filter**.

**Expected**
- After **View**: the Stock movements heading reads **"Stock movements · filtered to one variant"** and only that product/colour/size's movements show.
- After **Clear filter**: the full movement list returns.

☐ Pass ☐ Fail — **Notes:** ____________________

### B6 — Empty states (only if you have an empty org)
**Steps**
1. As an org-admin of an org with **no** tracked stock, open **Inventory**.

**Expected**
- Stock table shows **"No tracked stock yet."** and the movements panel shows **"No movements recorded."** — **not** an error or a blank page.

☐ Pass ☐ Fail — **Notes:** ____________________
*(Skip if you don't have an empty org.)*

---

## If a test fails

Write down, in the Notes line: **which login** you used, **which order/product**, **what you expected**, and **what actually happened** (a screenshot helps). Send the filled-in script back to Jamie. Don't keep retrying a failing step.

---

## Appendix — DB cross-checks (for Jamie, not Chris)

Run via Supabase MCP against the production project to confirm the UI matches the data.

**Reorder — confirm a placed catalogue order is re-orderable** (variant + catalogue identity persisted):
```sql
select qi.product_id, qi.variant_id, qi.catalogue_item_id,
       qi.qty_from_stock, qi.qty_to_make, qi.ship_to_store_id
from quote_items qi
join quotes q on q.id = qi.quote_id
where q.order_ref = 'ORDER_REF';   -- substitute the test order
-- expect: variant_id non-null on variant lines; catalogue_item_id populated for new-flow orders.
-- a null variant_id on a variant line => the rebuilt line degrades to variantless; fix submit persistence before relying on it.
```

**Audit — confirm Who/Where resolve from the real chain** (`quotes.created_by` + `ship_to_store_id`, NOT the always-null `staff_user_id`):
```sql
select e.reason, e.delta_stock,
       p.full_name as who, s.name as where_to, e.created_at
from variant_inventory_events e
left join quote_items qi on qi.id = e.reference_quote_item_id
left join quotes q       on q.id  = qi.quote_id
left join profiles p     on p.id  = q.created_by
left join stores s       on s.id  = qi.ship_to_store_id
where e.organization_id = 'ORG_ID'          -- substitute the test org
order by e.created_at desc
limit 10;
-- order_commit / pre_approved_inventory rows: who = order placer, where = ship-to store.
-- intake / count_correction rows: who = staff name or "Print Room", where = "—".
```

**Source of truth in code:**
- Reorder button + gate: [`components/orders/ReorderButton.tsx`](../components/orders/ReorderButton.tsx) (org-admin gate at L36; catalogue vs legacy branch at L73)
- Shown on: [`components/orders/JobTrackerOrderCard.tsx`](../components/orders/JobTrackerOrderCard.tsx) L72 (`completed && <ReorderButton/>`); page = [`app/(portal)/order-tracker/`](../app/(portal)/order-tracker/) (also reachable as `/tracking`)
- Rebuild API + pricing: [`app/api/reorder/rebuild/route.ts`](../app/api/reorder/rebuild/route.ts)
- Inventory page + gate: [`app/(portal)/inventory/page.tsx`](../app/(portal)/inventory/page.tsx)
- Inventory UI: [`app/(portal)/inventory/InventoryClient.tsx`](../app/(portal)/inventory/InventoryClient.tsx)
- Audit who/where logic: [`lib/inventory/audit.ts`](../lib/inventory/audit.ts) + route [`app/api/inventory/audit/route.ts`](../app/api/inventory/audit/route.ts)
- Nav gating: [`lib/nav/portal-nav.ts`](../lib/nav/portal-nav.ts)
