# Xero, Stock Handling & Integrations — working spec

> **Reconciled against the code on 2026-07-15.** This is the original onboarding/meeting spec, now
> **annotated in place** against the actual code in `print-room-portal` (the customer portal) and
> `print-room-staff-portal` (the staff/admin portal). Every intended change keeps its original wording
> (shown as a quote), followed by a grounded status. Findings come from a deep read of both repos, plus
> the live Supabase project where noted. The unedited meeting notes are preserved verbatim at the bottom.

**Legend:** ✅ implemented & wired · 🟡 partial (exists but not wired to the intent) · ❌ missing / net-new
**Repos:** **P** = print-room-portal · **S** = print-room-staff-portal · **studio** = legacy `print-room-studio` (out of scope for these repos, but still live in production)

---

## Key cross-cutting facts (read first — most items below depend on these)

1. **Customer roles are only `org_admin` and `staff`.** Stored on `user_organizations.role` (P `lib/company.ts:139,212-213`; DB constraint in S migration `20260612150000_fix_user_organizations_role_check_staff.sql`). It was called `buyer` until a June-2026 rename. `buildAccess()` is the single place "is this an admin" is decided, and **every** admin capability flag (`canManageUsers`, `canSeeAllOrgOrders`, `canViewReports`, …) is just `= isOrgAdmin` — there is no finer-grained customer permission system. Access queries run through a **service-role Supabase client that bypasses RLS** (P `lib/supabase.ts:8-13`), so access control is application-code `.eq()` filtering, not Postgres policy.

2. **"Demo user" is not a role.** It's the org-level flag `organizations.is_test = true` on the single "Print Room Demo" org (S `scripts/demo-org/seed-identity.ts:57`); members inherit demo-ness. Internal Print Room employees are a *separate* system again — `staff_users.role: staff|admin|super_admin` + a permissions array (S `src/types/staff.ts`). Don't conflate customer `org_admin` with staff-portal `admin`.

3. **The "pill" = `OrderIntentToggle`**, a **per-product** segmented control on the product detail page (P `components/shop/ProductDetailClient.tsx:1516-1549`); labels come from `lib/shop/fulfilment-mode.ts:14-17`. Fulfilment types: `'stocked'` = "Stock on hand", `'made_to_order'` = "Purchase order". The chosen mode is baked into each cart line's `fulfilmentType` at add-to-cart time. A **separate** catalogue-grid "Ordering mode" `<select>` filter also exists (P `components/shop/FilterRail.tsx:70-81`) and is **not role-gated**.

4. **Two different "paid" concepts — DO NOT CONFLATE (the spec mixes them):**
   - **The prepaid / not-paid *tag*** (lines 4 & 48): `variant_inventory.prepaid` boolean, default `false`, set **per stock-receipt batch** at the staff **"Mark Received"** step (S migration `20260513060604_variant_inventory_prepaid_and_order_intent.sql`; S `AdjustDrawer.tsx:254-286`). It is **never read by Xero.**
   - **Payment *terms*** (line 10 and the Xero gate): org-level `b2b_accounts.payment_terms` enum `prepay|net20|net30` (default `net30`), set on the staff account page. Xero eligibility currently keys on `payment_terms !== 'prepay'` — an *org billing arrangement*, a different thing from the per-batch tag above.

5. **There is no order-type column.** No `orders.order_type` / `is_stock_on_hand` / purchase-order field exists anywhere (exhaustive grep of both repos + migrations). Everything keys off the **per-line** `fulfilment_type: 'stocked' | 'made_to_order'`. Items **31**, **28**, and **54** all silently assume an *order-level* "this is a stock-on-hand order" signal that does not exist yet — the first real decision is whether to add a column or derive it from "all lines stocked".

6. **Xero creates a draft *quote*, inline at checkout, behind a deploy-dark flag.** It lives only in **P** `lib/xero/*` (the staff repo has **zero** Xero code). Despite the `draft-invoice.ts` filename it POSTs a **draft Quote** (`POST /Quotes`, `Status: DRAFT` — `lib/xero/draft-invoice.ts:37-38,312-316`). It fires synchronously, best-effort, as the *last* step of `submitCustomerOrder()` (P `lib/checkout/submit.ts:1515-1581`) — **no** webhook, cron, or manual staff trigger. Gated by `XERO_ENABLED` ("deploy-dark rollout flag", P `lib/xero/config.ts:16-19`), which is not set in any committed env file.

7. **Courier tracking today comes from Monday.com, not Starshipit.** `job_trackers.tracking_info` starts empty at order submit (P `lib/orders/job-tracker.ts:220`) and is later populated by the Monday webhook (P `app/api/webhooks/monday/tracker-status/route.ts:347`). The portal already renders it wherever it appears (`components/orders/JobTrackerOrderCard.tsx:150`, `lib/email/tracker-notification.ts:65-77`). This **couples line 28** (past-orders courier tracking) **with line 31** (stop making trackers for stock-on-hand) — the current tracking pipe can't be reused if the tracker is removed.

8. **Starshipit is greenfield in these repos, but live-and-broken in `print-room-studio`.** No Starshipit application code exists in either repo (the only hit is a perf-debt SQL script touching an unused index on `starshipit_webhook_logs`, P `db/perf-debt/B7_unused_duplicate_indexes.sql:314`). A real receiver + pusher lives in the legacy `print-room-studio/apps/job-tracker`, and the live Starshipit account is actively firing: **629 webhook rows on `starshipit_webhook_logs`, latest 2026-07-14, 100% `status='unmatched'`** — it's bound to old Shopify order numbers (`#PR42656`) rather than the portal's refs (`ANFI-000089`). Any build must decide: a fresh portal-owned integration vs. consolidating/redirecting that existing account (double-registration risk).

9. **Customer-side invites are retired.** Portal `/invite-accept` now just redirects to `/sign-in` (P `app/(auth)/invite-accept/page.tsx:1-10`). Onboarding is a **staff-initiated** OTP "sign-in code" email (`POST /api/b2b-accounts/[id]/invite`, S — gated to internal staff only). Every invite currently creates an `org_admin` (`ALLOWED_ROLES = ['org_admin']`, S `invite/route.ts:9`). The `canManageUsers` flag exists but has zero production consumers.

---

## Intended changes

### 1. Per-unit price in the product summary once QTYs selected — Purchase-order mode only

> *"Add per unit price in the summary on product once selected QTY's only applicable to Purchase orders'"*

- **Status:** ❌ Missing — **P**
- **Today:** The PDP price panel (`PriceBreakdown.tsx:24-53`) renders only Subtotal / Shipping / GST / Total; the "Your order" summary (`ProductDetailClient.tsx:1362-1404`) shows qty + in-stock/to-be-made only. The per-unit figure `unitEffective` is already computed and in scope (`lib/pricing/types.ts:17`, `lib/pricing/pricingMath.ts:16-29`) but never rendered there. The one per-unit display that exists is the **Volume-pricing bracket ladder** (`ProductDetailClient.tsx:1213-1230`, already correctly gated to `!isInventoryMode`), but that's a static table of all brackets, not a "your price at the selected qty" line.
- **Gap:** Add a per-unit price row to the PDP price panel, sourced from the already-fetched `pricing.unit_price`, shown only in Purchase-order mode (`!isInventoryMode`).

### 2. Tagging function for "not paid" / "pre paid" (default not-paid)

> *"Add the tagging function for 'not paid' and 'pre paid' (default is not-paid)"*

- **Status:** 🟡 Partial — **S** (defines & sets), **P** (hardcodes it off) · see cross-cutting fact #4
- **Today:** The data exists as `variant_inventory.prepaid` (bool, `DEFAULT false` = "not paid" ✓), mirrored on `variant_inventory_events.prepaid` (S migration `20260513060604_…:19-25`). It's **set per stock-receipt batch** at the staff Inventory "Mark Received" drawer (S `AdjustDrawer.tsx:254-286` → RPC `mark_inventory_received`), **not** on the product-upload/create form. The portal's checkout calls the same RPC but **hardcodes `p_prepaid: false`** (P `lib/checkout/submit.ts:1178`). Nothing outside the inventory ledger ever reads it — in particular Xero does not (fact #6).
- **Gap:** The tag is at (org, variant, receipt-batch) grain — not per product, not per order. To drive item 15b it must be aggregated to order/line grain and threaded into `XeroEligibilityInput`, which today has no such field. Decide where a customer-visible "not paid / pre-paid" tag actually lives (order? line? product?) — the current per-batch inventory flag is an accounting/valuation concept, not an order-payment tag.

### 3. Store admin can view all orders (pre-order + general portal)

> *"Allow visible for store admin to view all orders (across pre order and general portal)"*

- **Status:** 🟡 Partial — **P**
- **Today:** Admins already get org-wide data, but it's split across two disconnected pages with inconsistent scoping. The tracker feed (`lib/portal-data.ts:113-195`) *does* branch on role — `org_admin` sees company-wide trackers + org-wide pre-orders; `staff` sees only their own. But the "Orders" list at `/my-collections` (`lib/portal-data.ts:224-266`) filters by `organization_id` **only, with no role check**, so staff currently see the whole org's quotes too. The purpose-built `canSeeAllOrgOrders` flag (`lib/company.ts:233`) is computed but **never read** (dead).
- **Gap:** There's no single admin view that unifies pre-order + general/stock orders with filters (the notes explicitly ask for "filter functionality"). Today an admin must visit two pages. Side-fix: gate `/my-collections` so staff don't over-see the full org.

### 4. Untick payment terms for Demo user

> *"Untick payment terms for Demo user"* · (action item: *"Disable deposit requirement toggle for demo users in the staff portal"*)

- **Status:** 🟡 Partial — **S** (editor), **P** (checkout consequence) · see fact #2 & #4
- **Today:** The staff `AccountTermsCard` (S `AccountTermsCard.tsx:200-213`) exposes two per-org fields on `b2b_accounts`: `payment_terms` (dropdown `prepay|net20|net30`) and `default_deposit_percent` (dropdown `0|30|40|50|100`; `0` is a selectable "off"). There is **no boolean "requires deposit" / "terms enabled" toggle** anywhere — so there's literally nothing to "untick". The Demo org is seeded `payment_terms: 'net30'` (S `seed-identity.ts:66`), and because portal checkout shows the block whenever `depositPct > 0 || paymentTerms` (P `CheckoutReviewClient.tsx:81-82,442`) with no `is_test` branch, **the demo checkout currently displays "Payment terms: net30" even at 0% deposit**.
- **Gap:** Either (a) make `payment_terms` nullable/empty end-to-end (UI + `PATCH /api/b2b-accounts/[id]` enum guard at `[id]/route.ts:70-76` + the render condition), or (b) add `is_test`-aware suppression in `CheckoutReviewClient`. `is_test` is already read in ~3 other places, so the precedent exists.

### 5. Hide "Project tracker" from staff users

> *"Hide 'Project tracker' from staff user"*

- **Status:** ❌ Missing — **P**
- **Today:** No role gating at any layer. The "Track my Project" nav item is explicitly `requiresOrgAdmin: false` (`lib/nav/portal-nav.ts:42-50`); `/tracking/page.tsx` re-exports the `/order-tracker` page, whose loader (`app/(portal)/order-tracker/page.tsx:1-13`) has no role branch; `proxy.ts` only checks authentication, never role.
- **Gap:** Set `requiresOrgAdmin: true` on the nav item (removes it from the sidebar for staff — pattern already used for Inventory, `portal-nav.ts:73-81`) **and** add a server-side redirect/block in `order-tracker/page.tsx` + `tracking/page.tsx` (hiding the nav link alone doesn't stop a direct URL hit).

### 6. In Purchase-order mode, hide the "available" column and the "Stock available" title text

> *"When the pill is on Purchase order, hide the 'available' column. Remove 'Stock available' from beside the title in Purchase order mode"*

- **Status:** ❌ Missing — **P**
- **Today:** The multi-size grid's "Available" column (`ProductDetailClient.tsx:1242`) is gated only by `multiSize && visibleSizeRows.length > 0` — never by mode; only the *rows* are filtered by mode (`:362-368`), the column header always renders. The `AvailabilityBadge` beside the `<h1>` (`:1169-1174`, "In stock (N available)" / "Available to order") renders unconditionally in both modes.
- **Gap:** Wrap both in `!isInventoryMode` (i.e. hide when the pill is on Purchase order). (`VariantPicker.tsx:36-42` has a similar `inStockOnly` chip with *opposite* polarity, but it's dead — `showSizePicker={false}` at `:1198`.)

### 7. Pill only for admin; staff see "Stock on hand" view without the pill

> *"Pill only shows for admin user, staff users only see 'Stock on hand' view but without the pill"*

- **Status:** 🟡 Partial — true by default, but overridable by design — **P + S** · see fact #3
- **Today:** Gating is **permission-based, not a raw role check**: `orderingOptions(fulfilment_type, effectivePermission(role, stored))` (`lib/shop/fulfilment-mode.ts:59-65,83-94`). `org_admin` → `both`; a `staff` member with no stored permission → `stock_only` → pill hidden, mode forced to stock-on-hand → **matches the ask by default**. But a staff member *can* be granted `ordering_permission = 'reorder_only' | 'both'` from the staff portal (S `EditRoleDialog.tsx:193`), after which the pill **does** render for them (intentionally unit-tested). A strict literal-role helper `pillsFor(effective, isOrgAdmin)` exists (`fulfilment-mode.ts:32-40`) but has **zero call sites** — dead code.
- **Gap:** Decide: keep the deliberate permission-based model, or enforce an **absolute** admin-only rule (wire up `pillsFor` / a hard `isOrgAdmin` check). Either way, the catalogue-grid "Ordering mode" filter (`FilterRail.tsx:70-81`) is ungated and should be included in the decision.

### 8. Show the pill across products on the demo store

> *"Can you make the pill across products on the demo store"*

- **Status:** 🟡 Partial — works for **1 of 4** seeded demo products — **S (data), P (code)**
- **Today:** The demo store is real (org "Print Room Demo", `customer_code='DEMO'`), and the demo member is deliberately seeded `role:'staff'` + `ordering_permission:'both'` (S `seed-identity.ts:86-88`) so the *permission* half of the gate passes. But (verified live) only **Classic Tee** has `b2b_catalogue_items.fulfilment_type_override = 'mixed'`; the other three products have `override = null` and fall back to master `products.fulfilment_type = 'made_to_order'`, for which `canDrawStock` is structurally false — so the pill can't render for them even though they carry real stock.
- **Gap:** This is a **data/config** gap, not code. Set the other three demo items to "Both" via the staff catalogue-item "Fulfilment mode" dropdown (S `CatalogueItemEditor.tsx:541-559`).

### 9. Stock-on-hand: show the per-unit price (entered at product create + add-inventory)

> *"Stock on hand: Show the per unit price (this will be entered when we create the product and add inventory)"*

- **Status:** ❌ Missing — **P + S** · related to item 1
- **Today:** No per-unit price shows on the PDP for a stock-on-hand product (same summary gap as item 1); worse, for `'stocked'` the Volume-pricing ladder is also suppressed (mode forced to inventory), so only Subtotal/GST/Total show. Where a unit price *does* appear (cart/checkout — `CartTable.tsx:234-236`, `CheckoutReviewClient.tsx:418`) it comes from the shared computed pricing engine (`effective_unit_price` → tiers), **independent of fulfilment type**. Staff product-create captures "Base cost (per unit)" and/or manual qty-band tiers (S `PricingTab.tsx`) — a cost feeding the markup formula, not a fulfilment-specific sell price. Staff "add inventory" captures a "Per-unit value" (S `AdjustDrawer.tsx:249-304`) but that is a **stock-valuation/cost** figure written to `variant_inventory_events.unit_value` for audit — it never reaches customer pricing.
- **Gap:** There is no "selling price entered at inventory-add time" field/flow; `unit_value` is cost-basis only. Decide between (a) surfacing the existing computed price on the PDP for stocked items, or (b) introducing a genuine per-unit sell price captured at create/receive.

### 10. Rename "Orders" → "Past orders" (past stock-on-hand orders + courier tracking; no reorder)

> *"Update 'orders' to 'Past orders' - which will be used for showing past 'Stock on hand' orders and courier tracking for these orders. No reorder function here."*

- **Status:** 🟡 Partial — the "no reorder" bit is already true (incidentally); the rest isn't — **P** · see fact #5 & #7
- **Today:** Nav label is "Orders" → route `/my-collections` (`portal-nav.ts:51-59`); the page title is "My collections" but the client renders `<h1>Orders</h1>` (`MyCollectionsClient.tsx:93-95`). It lists **quotes** filtered to Awaiting/Approved status (`:34,82-85`) — a design/quote-approval view, **not** past fulfilled orders, with no order-type or courier-tracking concept, and **no reorder button** (confirmed). Courier tracking and the Reorder button both live on the **tracker** page instead (`JobTrackerOrderCard.tsx:86` reorder-when-completed, `:149-184` tracking_info).
- **Gap:** Rename label + heading, and repoint the page at actual stock-on-hand *orders* with courier tracking. But note the conflict from fact #7: today's courier tracking depends on the Monday-fed `job_trackers` row that **item 31 wants to stop creating** for stock-on-hand orders — so this page needs a new tracking source (Starshipit) rather than the existing pipe. "No reorder" falls out for free.

### 11. Stock-on-hand orders should not push to Monday.com or create an order tracker

> *"Stock on hand order does not need to push to Monday.com or require an order tracker."*

- **Status:** ❌ Missing — **P** (S has a duplicate push path, also unconditional) · see fact #5
- **Today:** In `submitCustomerOrder` every order **unconditionally** creates a job-tracker shell (step 4c, `lib/checkout/submit.ts:1225-1274`) and **unconditionally** pushes to the Monday Production board (step 5a, `:1281-1424`), stamping `monday_item_id` back onto `orders` + `job_trackers`. There is no order-type conditional and no field to condition on (fact #5). The per-line `fulfilment_type` today only affects MOQ exemption and the Xero `drawsStock` flag — it's never consulted before the Monday/tracker steps. The staff `retry-monday-push` route is likewise unconditional.
- **Gap:** Introduce an order-level "stock-on-hand order" signal (new `orders.order_type` column, or derive from "all lines `stocked`"), then wrap steps 4c + 5a (and the staff retry route) in that check.

### 12. Integrate Starshipit (push order on placement; pull tracking link on "Shipped")

> *"Integrate Starshipit with the portal so that deliver details push through to The Print Room Dispatch Starshipit as a new order. Then once order is 'Shipped' in starshup it, it will push the tracking link through to the portal."*

- **Status:** ❌ Missing in these repos — but **not greenfield system-wide** — **P** (new) · see fact #8
- **Today:** No Starshipit app code in portal or staff. A real, working pipeline exists in the legacy **studio** repo (`print-room-studio/apps/job-tracker`): a webhook receiver (`pages/api/webhooks/starshipit.js`) and a pusher `createTrackingOnlyOrder()` (`lib/starshipit.js:61`) — but the pusher is called *after* staff paste a tracking number into Monday (the **reverse** of "push at order placement"), and the live account is currently **100% failing to match** (629 unmatched rows) because it's keyed to old Shopify order numbers. The portal's "last mile" is already built: it renders `tracking_info.{number,url,carrier}` the moment it's populated (`JobTrackerOrderCard.tsx:150`, `tracker-notification.ts:65-77`).
- **Gap:** Build (a) a checkout-time Starshipit "create order" call (new step in `submit.ts`), and (b) a portal-owned `app/api/webhooks/starshipit/route.ts` that matches on the portal's own `job_reference`/tracker token. **Decision required:** stand up a fresh/separate Starshipit setup vs. redirect the existing "Print Room Dispatch" account so the portal takes over matching (avoid double-registration and stop feeding the broken studio receiver).

### 13. Webhook email to Charlotte on order placed (summary + portal hyperlink)

> *"Webhook to email Charlotte to let her know the order has been placed, order summary in email and a hyperlink to the portal with the order details."*

- **Status:** ❌ Missing (no email reaches Charlotte today) — but a near-identical wired mechanism exists — **P**
- **Today:** The order-confirmation email (`submit.ts:1657` → `lib/email/order-confirmation.ts:200`) always goes to the **customer** (`resolveOrderEmailRecipient`), has an order summary, but **no hyperlink** (only a `mailto:` reply). The closest existing analog is the **AM proof-notification** email (`lib/proofs/autofill-for-order.ts`, fired from `submit.ts:1469`): it triggers at order-submit, targets an internal staff recipient, and already includes an order summary **and** a hyperlink ("Open proof in staff portal"). But its recipient is resolved from the proof creator/assignee (not a fixed Charlotte/dispatch address) and it silently no-ops if unresolved. Charlotte's current touchpoint is a Monday item comment for manual-review Xero orders, not email. `sendEmail` supports a single `to` (no CC/BCC).
- **Gap:** Add a fixed Charlotte/dispatch recipient + a new order-placed notification. Cheapest path: clone the AM-email pattern at the existing `submit.ts` trigger point, reusing the order summary already assembled there (`emailLines`/`emailTotalAmount`, `:1584-1626`) and a deep link built like `tracker-notification.ts:27-28,50` (`PORTAL_ORIGIN` + `/order-tracker/<token>`, using the tracker shell from step 4c). All infra (Resend client, branded HTML shell) is reusable.

### 14. "Trouble logging in" — mailto hyperlink to Jamie

> *"Trouble logging in, mailto hyperlink to Jamie"*

- **Status:** ❌ Missing — **P** (also missing on staff sign-in)
- **Today:** The portal sign-in page (`SignInClient.tsx`) has "Forgot password?" (`:193-200`) and "Explore the demo" (`:298-304`) but **no** "Trouble logging in?" / `mailto:`. (The sibling `/request-access` page has a *captcha-fallback* email button at `RequestAccessClient.tsx:225`, scoped to that page only.) Two conventions already exist: customer support uses `mailto:hello@theprint-room.co.nz`; staff transactional emails route "Questions?" to `mailto:jamie@theprint-room.co.nz` (S `staff-invite.ts:180`).
- **Gap:** Add a "Trouble logging in?" mailto to the portal sign-in page. The spec says **Jamie** → `jamie@theprint-room.co.nz` (consistent with the existing staff-email convention). Confirm address before building since `hello@` is the customer-facing default.

### 15. Xero draft-quote triggers

> *"Xero draft quote triggers — All Purchase Orders (placed by admin user). Stock on hand - when tagged with 'not paid', trigger won't fire if tagged with 'pre-paid'."*
> *(Notes restate the intent: "Purchase orders always create draft quotes via Xero; stock on hand orders only do so if tagged as not prepaid.")*

- **Status:** 🟡 Partial — plumbing is fully wired & tested, but the eligibility **rule** is a v1 placeholder that implements **neither** half of the intent — **P** only · see facts #4 & #6
- **Today:** The client / config / contact-resolution / quote-build / persist / audit path is complete and unit-tested, firing inline at checkout (fact #6). The current rule (`lib/xero/eligibility.ts:35-42`) is: eligible **iff** `xeroEnabled` AND no existing draft AND org `!is_test` AND `payment_terms !== 'prepay'` AND **no line is `stocked`**. Consequences vs the intended rule:
  - **15a — "all POs, admin-placed"**: *not* unconditional — a purchase order can still be blocked by `prepay_org` / `test_org` / flag-off, and there's **no admin-role check** (checkout accepts `org_admin` *or* `staff`; `context.role` is available but unused).
  - **15b — "stock-on-hand only if not-paid"**: *not implemented* — **100% of stock-on-hand orders go to `manual_review`** regardless of paid status, because the `variant_inventory.prepaid` tag isn't wired into eligibility at all (the test suite documents this: `eligibility.test.ts:43-45`, "can not tell paid from unpaid stock in v1").
  - The `payment_terms` gate here is the **org billing arrangement**, *not* the per-batch tag (fact #4) — the spec's "not paid / pre-paid" ≠ this field.
- **Gap:** Rewrite `evaluateXeroEligibility` / `XeroEligibilityInput` to (1) decide whether POs should override the `prepay_org`/`test_org` gates to be truly unconditional; (2) replace the blanket `draws_stock` kill-switch with a real per-order not-paid vs pre-paid check sourced from a properly-grained version of item 2's tag; (3) decide whether/how to gate on actor role for "admin-placed" POs (`context.role` is already in `submit.ts`). Also confirm the `XERO_ENABLED` flag rollout.

---

## Future

### F1 (was item 16). Cart-page "Purchase order" / "Stock order" per line → two orders in one transaction

> *"Add 'Purchase order' and 'Stock order' to products on the cart page for when a admin orders a purchase order and stock order in one transaction. Ensure this creates two different orders in the background - one generates order tracker, one the webhook to notify staff at print room as above."*

- **Status:** ❌ Missing — **P** · depends on items 11 & 13
- **Today:** The only per-line ordering-mode concept is set on the **PDP** (not the cart) and carried as an immutable `fulfilmentType` on each cart line (`CartProvider.tsx:169,180`). The cart page only *reads* it for MOQ warnings (`CartTable.tsx:56,94,133`) — there's no control to set/change mode there. `POST /api/checkout` always makes exactly **one** `submitCustomerOrder` call producing one order, even when the cart mixes `stocked` + `made_to_order` lines.
- **Gap:** Everything — a cart-page per-line "Purchase order / Stock order" selector, plus new orchestration that partitions one checkout into two order submissions (one → Monday/tracker path per today's flow; one → stock-on-hand path that skips Monday and fires the staff webhook from item 13). Builds directly on items 11 and 13.

### F2 (was item 17). Store admin can invite and add staff users only

> *"Store admin can invite and add staff users only"* · (action item: *"organization admins to add and invite users on the portal with appropriate permission controls"*)

- **Status:** ❌ Missing for the target model — **S** (entire live mechanism), **P** (retired dead-end + unused flag) · see fact #9
- **Today:** The only live invite path is staff-initiated (`POST /api/b2b-accounts/[id]/invite`, gated to internal Print Room staff via `requireB2BAccountsStaffAccess`) — a customer's own `org_admin` **cannot** invite anyone. Worse for this feature, every invite is hardcoded to create an `org_admin` (`ALLOWED_ROLES = ['org_admin']`, S `invite/route.ts:9`; the `MembersPanel` dialog offers no role choice), because the `staff` role requires a `default_store_id` the invite form doesn't capture. The forward-declared `canManageUsers` / `canViewAccountRequests` flags (`types/company.ts:31,34`) have zero consumers.
- **Gap (net-new, non-trivial):** (1) a **customer-portal-facing** invite UI/API for `org_admin`s (none exists); (2) constrain it to create `staff` only (flip `ALLOWED_ROLES` **and** solve the `default_store_id` capture the staff form currently punts on); (3) explicitly prevent a portal org_admin from ever minting another `org_admin`. The existing staff-side components target a different actor and aren't reusable as-is.

---

## Suggested build order (derived from the above — for discussion, not yet agreed)

Grouped so shared foundations land first:

1. **Foundations that unblock several items:** decide the **order-type signal** (fact #5) — needed by items 11, 10, F1; and decide where the customer **"not paid / pre-paid" tag** lives (item 2) — needed by item 15b.
2. **Quick, self-contained UI wins:** items 1, 6, 9 (PDP price + column/badge hiding), 5 (hide tracker from staff), 8 (demo data config), 14 (login mailto).
3. **Role/visibility:** items 7 (pill rule decision) and 3 (unified admin orders view + `/my-collections` gate).
4. **Order routing:** item 11 (gate Monday/tracker for stock-on-hand) → item 10 (Past orders page) → item 13 (Charlotte email).
5. **Xero rule rewrite:** item 15 (needs foundations from step 1).
6. **Integrations & future:** item 12 (Starshipit — needs the account-consolidation decision), then F1 (split orders) and F2 (org-admin invites).

---

## Original meeting notes (unedited)

*Preserved verbatim for reference. The actionable items above supersede these where they conflict; note in particular the "Notes" claim that stock-on-hand orders "only [create Xero drafts] if tagged as not prepaid" describes the **intended** behaviour, which item 15 shows is **not** how the code works today.*

Future

Add ‘Purchase order’ and ‘Stock order’ to products on the cart page for when a admin orders a purchase order and stock order in one transaction. Ensure this creates two different orders in the background - one generates order tracker, one the webhook to notify staff at print room as above.

Store admin can invite and add staff users only

KEY_TAKEAWAYS_OVERVIEW
Order Management: Store admins get full order visibility with filters; tracking links auto-update after shipment to improve transparency.  Product & Inventory: Dual ordering modes clarify stock vs purchase orders; unit pricing shown pre-cart; prepaid tags control invoicing via Xero.  User Access: Admins can invite staff users; login upgrades include password options and quick support reporting; onboarding uses Loom videos.  Process Refinement: Mixed orders split backend-wise; clear cart labels for order types; minimum order price tier shown to reduce buyer confusion.  Strategic Planning: Major onboarding set for Thursday; focus on per unit pricing, user invites, and order tracking; legacy ERP limits integrations.  Product Upload: Master upload tool tested internally; made-to-order types added; pricing input ensures invoicing accuracy and stock clarity.
Notes
Order Management and Visibility
The team agreed on improving order visibility and filtering to streamline order tracking and customer transparency.
Store admins to gain full order visibility across portals to allow filtering and viewing all orders, addressing customer needs to see order statuses without direct requests (03:01)This feature targets org admins to reduce confusion and improve self-service.Jamie proposed adding filter functionality so admins can sort orders by criteria.Chris highlighted risks with domain-based automatic access due to role confusion among users sharing the same domain.The solution avoids auto-assigning org admin roles to all same-domain users to prevent unauthorized access.Order tracking integration with Starship IT will push delivery details and tracking links into the portal to improve shipment transparency (20:45)Charlotte will receive webhook email notifications for new orders with order summaries and direct backend hyperlinks for efficiency.Jamie confirmed hyperlink creation is feasible to simplify order processing.Tracking links are currently pushed automatically once shipments dispatch, ensuring seamless customer updates.Past orders and order tracking display differentiation was clarified for stock on hand versus purchase orders to align user access and feature availability (33:22)Staff users will only see past stock on hand orders without project tracking access.Project tracker functionality will remain for purchase order management only, maintaining clarity between order types.The system will hide project tracker from staff users, limiting it to admin roles.Pricing display adjustments planned to reduce buyer confusion on tiered pricing by hiding lower volume price tiers and showing only minimum order price points (50:18)Jordan’s feedback highlighted customers’ hesitation due to seeing lower tier prices they cannot commit to.Jamie added a checkbox in the staff portal to control if price brackets display, enabling better customer clarity.The approach aims to increase buyer confidence by showing the lowest relevant price only.
Product and Inventory Management
The discussion focused on refining product ordering modes, inventory visibility, and pricing to support diverse customer needs.
Dual ordering mode implementation—stock on hand vs. purchase order—with UI adjustments to clarify product availability and pricing for users (14:04)When purchase order mode is active, the stock availability column will be hidden to avoid confusion.Chris emphasized the need for users to replenish stock without triggering unwanted shipments.Jamie agreed to implement hiding the available inventory column when toggled to purchase order mode.Purchase order pill indicator will appear only for organization admins, while staff users see stock on hand data only.Per unit pricing visibility improvements on order pages to help users see exact costs before adding products to cart (16:06)Chris requested unit price display on product selection pages for better cost clarity.Jamie confirmed adding this is straightforward and will enhance order accuracy.This improvement applies primarily to stock purchase orders where pricing is relevant.Inventory assignment and automatic stock reduction process for stock on hand orders clarified to maintain accurate stock levels (31:53)When stock on hand orders are placed, inventory reduces automatically.Jamie is working on order pages to track stock movements and order statuses.Manual intervention for stock allocation will be minimized, relying on integration with Shopify backend.Tagging products as prepaid or not prepaid to control invoicing and draft quote generation through Xero integration (37:47)Chris outlined the necessity to tag products during upload to indicate payment status.Purchase orders always create draft quotes via Xero; stock on hand orders only do so if tagged as not prepaid.Jamie confirmed webhook triggers tied to tags can automate draft quote creation selectively.This tagging ensures accurate invoicing aligned with customer agreements and payment terms.
User Access and Onboarding
The team prioritized smoother user management and onboarding workflows to reduce support overhead and improve customer experience.
Allowing organization admins to invite and add staff users directly in the portal to improve user management autonomy (09:57)Jamie and Chris agreed this would reduce reliance on support for user additions.The feature will initially target staff user roles only, keeping admin assignments controlled.This change aligns with scaling needs as customer bases grow and require self-service capabilities.Login and authentication improvements to reduce access issues including options for password login or one-time codes (07:42)Jamie suggested a chatbot integration for users to report login problems directly, triggering support email alerts.Chris recommended a simple clickable mailto link for quick reporting to start.They discussed offering password login as an alternative to six-digit codes due to email filtering issues.The goal is minimizing support calls by offering clear and easy login troubleshooting options.Onboarding documentation and demo store usage to educate customers on platform features and reduce onboarding friction (11:44)Chris described creating Loom videos and a living one-pager onboarding doc updated with new features.The demo store helps showcase product variations and ordering processes.Jamie plans to have team members like Ollie test the master product upload feature for feedback before wider rollout.Integration considerations for HR software connections were briefly discussed to support future user onboarding automation (52:11)Jamie explored potential API connections to popular HR systems like BambooHR for automated user invites.Chris noted many legacy systems lack modern APIs making integration challenging.The approach will remain manual for now, pending better system standardization.
Process and Workflow Refinement
Efforts focused on aligning system behaviors, clarifying user experiences, and reducing manual workload.
Splitting orders into purchase order and stock order segments in one transaction with separate backend handling to track different fulfillment types (28:31)Jamie and Chris agreed the system should generate two distinct orders in the backend when mixed orders occur.This enables clear workflows for inventory fulfillment and purchase order invoicing.They plan to document this flow and train users on split shipment setups.Clarifying order states and UI labels to improve user understanding of ordering modes (28:23)Jamie will add labels on the cart page distinguishing "purchase order" and "stock order" items.This labeling helps prevent confusion when admins mix order types in one cart.The UI will preserve order state when toggling between stock and purchase order modes during checkout.Managing minimum order quantities and pricing display to better align customer expectations and order feasibility (49:32)Jordan’s insight showed customers hesitate due to misunderstanding tiered minimum order volumes.The team decided to show only the minimum order price tier that triggers production, hiding smaller tiers.This reduces perceived risk and buyer hesitation.Avoiding user overload in support by tracking common login errors and user misunderstandings via simple reporting features (07:46)Chris stressed the need to identify patterns in user login errors to improve documentation and UX.Jamie agreed this would guide future improvements and reduce repetitive support queries.
Strategic and Operational Planning
The team is preparing for upcoming onboarding milestones and prioritizing development work to meet customer launch goals.
Next major onboarding scheduled for Thursday with Doc organization to implement new portal features and upload product imagery and pricing (54:14)Chris will coordinate with Jesse to finalize image exports and pricing data.Jamie and Chris will manage product uploads and portal testing to smooth the onboarding.They anticipate about two days of development work to complete prioritized features before the session.Prioritized feature list includes per unit pricing, hiding available stock on purchase orders, user invitation, and order tracking updates as key to supporting new customers (47:46)Chris organized these features into a rough priority order to focus efforts.Jamie confirmed ongoing work on order pages and product upload improvements.The goal is to resolve operational gaps before scaling to more customers.Long-term vision embraces separating pre order and general ordering models as distinct silos with tailored features (31:40)Chris emphasized treating pre order organizations differently for special reporting and ordering behaviors.This approach allows customized workflows and clearer product handling per organization type.Differentiation supports future growth in corporate and pre order market segments.Recognition of legacy system challenges at large customers impacting integrations and stock visibility (52:51)Chris shared examples of outdated ERP systems lacking APIs causing stock sync delays.These limitations affect inventory accuracy and ordering efficiency.The team expects continued manual or workaround solutions for complex enterprise clients.
Product Upload and Master Data Management
The discussion covered enabling internal teams to manage product catalogs more independently and showcase product variety.
Master product upload feature working well but requiring user feedback for refinement (12:39)Jamie plans to have internal users like Ollie test it to identify improvements.Chris offered to assist with testing and feedback cycles.This tool is key to reducing dependency on developers for product catalog updates.Adding “made to order” product types to the portal to showcase more product variations and meet diverse customer needs (13:28)Jamie suggested expanding product types to better represent custom offerings.This supports richer catalogs and more accurate ordering options.Chris sees this as important for presenting options clearly to customers.UI improvements for product stock and ordering modes including hiding stock availability when purchase order mode is active and showing clear labels (26:54)Jamie to hide the available stock column when toggled to purchase order.Chris wants consistent behavior where stock input does not incorrectly affect inventory counts.These changes improve user clarity and prevent accidental stock depletion.Need for clear pricing input and display per product on upload to reflect paid/prepaid status and support invoicing processes (36:48)Pricing information will be entered during product creation to inform users.Prepaid tagging will indicate if invoicing is required on fulfillment.This improves accounting accuracy and customer billing transparency.
Action items
Jamie Horsefield
Provide feedback on the MTI master product upload feature; have Ollie test it and report back (12:45)Implement hiding of the "available" stock column in purchase order mode and add labels distinguishing purchase order vs stock order on the cart page (25:30)Ensure order summary emails to dispatch staff (Charlotte) include hyperlinks to orders in the portal for easier access (23:50)Hide the project tracker from staff users and update the UI label from “orders” to “past orders.” (33:40)Implement functionality for organization admins to add and invite users on the portal with appropriate permission controls (10:30)Add tagging capability on products for prepaid/not prepaid status to govern invoicing and draft quote triggers via Xero integration (38:30)Disable deposit requirement toggle for demo users in the staff portal to avoid confusion (47:20)
Jamie Horsefield & Chris Print Room NZ
Collaborate with Chris to upload Doc’s product imagery and pricing, test, and validate portal and upload workflow before Thursday onboarding (49:15)
Chris Print Room NZ
Communicate with Jesse regarding Doc’s order export readiness and upload coordination (48:40)Follow up on potential customer portal order visibility filters and organization admin login domain concerns; keep as future consideration (03:20)Prepare onboarding documentation and Loom video for demo store customers to assist in easing adoption (12:00)Validate that purchase order toggle controls Xero draft quote workflow; ensure system handles separate triggers for stock on hand invoicing based on tags (43:40)Check inventory and order state handling in systems for mixed orders (stock and purchase) to maintain correct stock updates and order processing (28:00)Work with Jamie to surface unit pricing clearly before orders are added to cart (16:00)Ensure Starship IT integration is correctly pushing dispatch tracking links to portal and proper notifications to dispatch staff (Charlotte) (22:20)
