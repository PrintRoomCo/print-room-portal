# Spec B — Dispatch & Self-Service Integrations (deferred)

> **Scope:** the deferred half of the 2026-07-15 onboarding work — the heavy integrations and
> anything gated on an external decision. Split out from
> [`2026-07-15-xero-stock-handling-integrations.md`](./2026-07-15-xero-stock-handling-integrations.md)
> during the `/grilling` session on 2026-07-15. Build-now items are in
> [`2026-07-15-spec-a-xero-stock-portal-ux.md`](./2026-07-15-spec-a-xero-stock-portal-ux.md).
>
> **Repos:** **P** = `print-room-portal` · **S** = `print-room-staff-portal` · **studio** = legacy `print-room-studio`

---

## ⚠️ Thursday-critical slice — do not fully defer

Everything else here is genuinely later, **except** the staff-default invite (part of F2), which the
Doc onboarding on **Thursday** forces. It must ship by then even though it lives in Spec B.

- **What:** the existing staff-initiated invite (`POST /api/b2b-accounts/[id]/invite`, S — run by Chris/Jamie) gains a **role choice (`org_admin` | `staff`)** and **`default_store_id` capture**, so Doc's people are onboarded as `staff` (stock-on-hand only, no pill, no project tracker), not admins.
- **Rule:** first/primary contact = `org_admin`; everyone else = `staff`.
- **Why now:** today every invite hardcodes `org_admin` (`ALLOWED_ROLES = ['org_admin']`, S `invite/route.ts:9`), so without this, Doc's whole team lands as admins and the entire Spec A staff-vs-admin split (pill, Past-orders-only, hidden tracker) is invisible for them.
- This is the **narrow** slice. The customer-portal-facing self-serve invite UI (full F2 below) stays deferred.

---

## Depends on Spec A

Spec B assumes these Spec A foundations exist: `orders.order_type`, the push-with-note Monday flow, the Past-orders courier-tracking surface, and the order-placed notification abstraction (Slack + email).

---

## Item 12 — Starshipit dispatch integration

> *Push delivery details to Starshipit as a new order at placement; when "Shipped" in Starshipit, push the tracking link back to the portal.*

- **State today:** no Starshipit code in P or S. A real pipeline exists in **studio** (`print-room-studio/apps/job-tracker`: receiver `pages/api/webhooks/starshipit.js`, pusher `lib/starshipit.js:61 createTrackingOnlyOrder()`), but it fires *after* staff paste a tracking number into Monday (the reverse of "push at placement"), and the **live account is 100% failing to match — 629 `starshipit_webhook_logs` rows, all `status='unmatched'`**, keyed to old Shopify order numbers (`#PR42656`) not portal refs (`ANFI-000089`).
- **⚠️ Account decision (blocking):** stand up a **fresh portal-owned** Starshipit setup, or **redirect/consolidate** the existing "Print Room Dispatch" account so the portal owns matching. Double-registration risk if both the studio receiver and a new portal receiver run against one account.
- **Build:**
  1. **Push at placement** — new step in P `submit.ts` that creates a Starshipit order from the delivery details (guard behind an env flag, like Xero).
  2. **Portal-owned webhook** — `app/api/webhooks/starshipit/route.ts` that matches on the portal's own `job_reference` / tracker token and writes `job_trackers.tracking_info`.
- **Relationship to Spec A tracking:** Spec A keeps Monday-fed tracking for stock orders (push-with-note). Starshipit here is about **dispatch automation** + an authoritative tracking source; decide whether Starshipit tracking **supersedes** or **supplements** the Monday-fed pipe. The portal's render side already handles `tracking_info.{number,url,carrier}` (P `JobTrackerOrderCard.tsx:150`, `tracker-notification.ts:65-77`).

## F1 — Split a mixed cart into two orders

> *Cart-page per-line "Purchase order" / "Stock order"; a mixed admin cart creates two backend orders — one → tracker, one → the order-placed notification.*

- **State today:** ordering mode is set on the **PDP** only and carried as an immutable `fulfilmentType` per cart line (P `CartProvider.tsx:169,180`); the cart only reads it for MOQ warnings (`CartTable.tsx:56,94,133`). `POST /api/checkout` always makes **one** `submitCustomerOrder` call, even for a mixed cart.
- **Build:** a cart-page per-line "Purchase order / Stock order" selector, plus orchestration that partitions one checkout into **two** `submitCustomerOrder` calls — the made-to-order partition → Monday/tracker path; the stock partition → `order_type='stock_on_hand'` (push-with-note + notification from Spec A).
- **Supersedes** Spec A's interim "mixed → purchase_order" rule (F1 is what makes mixed carts split cleanly).
- **Depends on:** Spec A items 11 (note) + 13 (notification) + `order_type`.

## F2 — Org-admin self-serve invites (staff only)

> *Store admins can invite/add **staff** users on the portal, with permission controls.*

- **State today:** the only live invite is staff-initiated (gated to internal Print Room staff); a customer's own `org_admin` **cannot** invite anyone. Every invite creates an `org_admin`. The `canManageUsers` / `canViewAccountRequests` flags (P `types/company.ts:31,34`) have zero consumers.
- **Build (beyond the Thursday slice above):**
  1. A **customer-portal-facing** invite UI + API for `org_admin`s (none exists — the retired `/invite-accept` just redirects to `/sign-in`).
  2. Constrain it to create **`staff` only** (with `default_store_id` capture) — reuse the Thursday slice's role+store handling.
  3. **Guard:** a portal `org_admin` can **never** mint another `org_admin`.
- The existing staff-side components (S `MembersPanel`, `EditRoleDialog`) target internal staff and aren't reusable as-is.

## Prepaid — the deferred "paid vs not-paid" implementation

Bundles item 2 + Chris's 2026-07-15 follow-up. In Spec A everything is invoiced; this makes prepaid real.

- **Tag (decided grain):** new column on **`b2b_catalogue_items`** (per customer × product), default **not-paid**. *Do not reuse the name `prepaid`* — collides with `variant_inventory.prepaid`; use e.g. `invoice_on_dispatch` / `billing_mode`. Leave `variant_inventory.prepaid` as **valuation-only** (it's a per-(variant,org) aggregate set at Mark Received; commingled stock means it can't answer "is this order paid?").
  - Staff control on the catalogue-item editor (S `CatalogueItemEditor.tsx`, same surface as fulfilment-mode).
  - Order-level rule: **order needs invoicing iff any stocked line is not-paid.**
- **Customer-facing display (Chris):** show a "pre-paid" indicator on the **product page** and **checkout summary** for stock-on-hand products that carry the tag.
- **Xero handling (Chris's revised trigger):** push **every** stock-on-hand order to Xero, but for **pre-paid** products **zero the product value (100% discount)** and add the **picking fee on a separate line** (see below). So the Spec A rule "all orders invoiced" becomes: prepaid goods → $0 line + pick fee; not-paid goods → normal draft quote.
- **Monday note becomes conditional again** (re-splits the Spec A flat note):
  > pre-paid → "Prepaid — no Xero invoice required (pick fee only)." · not-paid → "Not paid — draft quote raised, invoice before dispatch."

## Picking fees

> *Apply picking fees at checkout as a separate line, banded by order value.*

- **Domestic NZ table (from Chris's image):**

  | Order value (NZD) | Picking fee |
  |---|---|
  | $0–$99 | $35 |
  | $100–$199 | $30 |
  | $200–$299 | $25 |
  | $300–$399 | $20 |
  | $400+ | $15 |

- **Open:** the image is **Domestic NZ only** — decide the behaviour for other regions (per-region tables? NZ-only for now?).
- **Build:** a new checkout fee line feeding into totals, **GST**, the **Xero draft** lines, and the **Monday** summary. Tightly coupled to prepaid (the pick fee is what's charged when goods are prepaid) — build alongside the prepaid work.
- **Open:** does the pick fee apply to **all** orders, **stock-on-hand only**, or **prepaid only**? (Chris frames it both as a general checkout rule and as the prepaid charge.)

---

## Sequencing within Spec B

1. **Thursday-critical:** staff-default invite slice (before Doc onboarding).
2. Prepaid tag + display + Xero handling + picking fees (one coherent block — they interlock).
3. Item 12 Starshipit (after the account decision).
4. F1 split orders (needs Spec A order_type + item 11/13).
5. F2 full self-serve invites (extends the Thursday slice).
