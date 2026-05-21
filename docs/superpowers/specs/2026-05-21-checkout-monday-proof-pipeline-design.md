# Checkout → Monday CRM Deals → Auto-Proof Pipeline (retire AM gate) — Design

**Date:** 2026-05-21
**Repos:** `print-room-portal` (customer) + `print-room-staff-portal` (staff)
**Status:** draft — open questions resolved with Jamie 2026-05-21
**Sources:** Chris Brun notes 2026-05-21 §§5–8; supersedes the AM-gate decision baked in the 2026-04-20 customer-b2b-checkout-mvp spec §4.

## Why

Chris's 2026-05-21 notes describe a flow where customer checkout pushes straight to Monday, the account manager is *notified* (not gating), the proof is auto-generated from product data, staff edit it in the proof dashboard, then staff push it to the customer for approval. Customer approval is the gate, not staff.

The portal as built today does the opposite: customer checkout writes `orders.status = 'awaiting-approval'`, does not push to Monday, and waits for `POST /api/orders/:id/approve` (staff portal) to generate the production-proof PDF, push to Monday Production board, and only then mark the order approved. That decision was deliberate (`lib/checkout/submit.ts:745`) — the AM was the safety net for pricing/decoration drift before any production touched the board.

Jamie's call (2026-05-21): retire the AM gate. The auto-fill that already runs at checkout (`autofillProofForOrder`) gives staff a draft proof in their dashboard immediately; staff edits before pushing it to the customer; the customer is the sole approval gate. AM safety becomes a "review the autofill before push-to-customer" expectation, not a hard gate.

**One important departure from Chris's note:** Chris wrote "push to Monday Pre-production". Jamie's correction: orders should land in the **CRM Deals board** (`MONDAY_REORDERS_BOARD_ID`, e.g. `2046357917`) in the **"New Deals" group** — the same place customer reorders and chatbot quote requests already arrive. AMs live in that board today and route items into production themselves. Production board (`1992701981`) doesn't see anything until an AM moves it there. This makes the pipeline architecturally identical to the existing reorder flow (`lib/monday/reorder.ts`) — order items just become another flavour of "New Deal" alongside reorders and chatbot quotes.

The good news: ~70% of the pipeline already exists. The proof shell, the customer-side proof viewer, the amendment-request flow, the staff push-to-customer route (`POST /api/proofs/:id/approve`), and the customer email are all wired. The reorder-to-Monday wiring is also wired. What's missing is calling that wiring at checkout time, the order auto-approval, and the retirement of the now-redundant order-approve route.

## Goal

Three coupled deliverables, ordered:

1. **Customer checkout creates an item on the CRM Deals board at submit time** — lands in the "New Deals" group with `deal_source = "Portal - Order"`. Sub-items per cart line (one per `quote_items` row) named with product + decoration ("design") name. Order writes back `monday_item_id` and per-line `monday_subitem_id`.
2. **Order status flips to a customer-gate state at checkout** — no more `awaiting-approval`. The existing `order_proof_approval_gate` column (added in the 2026-05-12 proof spec) becomes the gate that production unblocks against, not `orders.status`.
3. **Staff-side order-approve route is retired** — its PDF generation moves to `POST /api/proofs/:id/approve` (the existing push-to-customer route). That route gains: render the production PDF, attach the PDF to the existing Monday Deals item, then flip proof to `sent_to_customer` and email the customer (existing behaviour).

## Non-goals

- **Shipping tier rules for the inventory branch** — Chris owes Jamie the myPR table; out of scope, parked.
- **DocuGEN integration** — the existing `sendProofReadyEmail` covers the proof-ready notification. No new vendor wiring.
- **Customer proof amendment loop** — already shipped (`proof_amendment_requests`, customer "Edit proof" → staging editor). Not touched.
- **Order tracker sync from Monday → Supabase** — already shipped (`sync-job-tracker-items.ts` + tracker-status webhook). Continues to work; it just keys off the AM-managed Production board item once the AM has moved a deal there, which is unchanged behaviour.
- **AM workflow on the CRM Deals board** — moving a deal from "New Deals" through the AM's pipeline groups (qualified, in production, etc.) is the AM's job in Monday, not our code. We hand off at "New Deals" and trust the existing AM workflow.
- **Production board (`1992701981`) integration at checkout** — no longer needed. Removing the only customer-portal path that touches it. Staff-portal code may still write there for non-customer-originated work (e.g. legacy CSR-built quotes); that's unchanged.
- **Staff portal "pending review" inbox UI changes** — the proof dashboard already lists `status='draft'` proofs, which is what auto-fill creates. No new list view needed.
- **Staff portal orders-list new-tab UI** — Jamie's call: v1 default, no new tab. `awaiting-proof-review` orders sit alongside existing actives.
- **Migrating existing `awaiting-approval` orders** — portal is not customer-facing yet (per Jamie 2026-05-21). No legacy sweep needed.

## Why this stack

Per `feedback_web_project_pre_plan_strategy.md`.

- **Rendering.** Checkout submit is a POST handler (`app/api/checkout/route.ts`), not a page. The new Monday call runs server-side in the existing route. No rendering concerns. The customer order-confirmation page already renders dynamically (`force-dynamic`).
- **Caching.** No new caches. The Monday item creation is a write; the read of `quote_items` for sub-items happens in the same request after `submit_b2b_order` returns. Nothing in this pipeline is currently cached.
- **Performance.** Monday API calls add wall-clock to checkout submit. Reorder pipeline is the working analogue — a single `create_item` + N×`create_subitem` with the existing 300ms inter-subitem delay (`production-job.ts:86`) is acceptable. A B2B order has 1–10 lines in practice; worst case adds ~3s. **Mitigation:** the push happens *after* the Supabase order is committed and *after* the order-confirmation email is queued, inside try/catch that never bubbles. On failure: `monday_item_id` stays null, audit event recorded, order persists. Customer sees no Monday latency or failure.
- **Ecommerce pattern.** "Customer is the gate on proof, not staff" is the Shopify / Vista / Custom Ink pattern — production starts as soon as the customer confirms artwork. Staff have a pre-customer review window (the edit-in-proof-dashboard step). Same flow Chris's myPR-trained customers already expect.

## Architecture

### State machine after this change

```
                 ┌──────────────────┐
                 │ customer submits │
                 └────────┬─────────┘
                          │
                          ▼
        ┌──────────────────────────────────────────────────┐
        │ submit_b2b_order RPC writes orders row           │
        │ status = 'awaiting-proof-review'  (new)          │
        │ + monday_item_id, per-line monday_subitem_id     │
        │ + design_proofs row + draft version (autofill)   │
        └────────┬─────────────────────────────────────────┘
                 │
       ┌─────────┴──────────┐
       ▼                    ▼
┌──────────────┐    ┌──────────────────────────┐
│ AM email     │    │ Monday CRM Deals board   │
│ (proof ready │    │ item in "New Deals"      │
│  for review  │    │ + sub-items per line     │
│  — Monday    │    │ + deal_source =          │
│  link incl.) │    │   "Portal - Order"       │
└──────┬───────┘    └──────┬───────────────────┘
       │                   │
       └─────────┬─────────┘
                 ▼
   ┌─────────────────────────────────┐
   │ staff edits proof in dashboard  │
   │ (existing proof editor)         │
   └────────┬────────────────────────┘
            │ POST /api/proofs/:id/approve
            ▼
   ┌─────────────────────────────────────────────────┐
   │ render production PDF (prepareOrderProof…)      │
   │ attach PDF to Monday Deals item                 │
   │ proof.proof_quality_status='sent_to_customer'   │
   │ orders.status='awaiting-customer-approval' (new)│
   │ email customer with proof link                  │
   └────────┬────────────────────────────────────────┘
            │ customer clicks "Approve"
            ▼
   ┌──────────────────────────────────────────────────┐
   │ orders.order_proof_approval_gate='approved'      │
   │ orders.status='in-production'                    │
   │ AM moves the Deal into their Production workflow │
   │ in Monday (their job, not ours)                  │
   └──────────────────────────────────────────────────┘
```

### Decision 1 — Two new order statuses, or repurpose existing

We need two transitions distinct from today: "submitted but proof not yet sent to customer" and "proof sent, awaiting customer". Options:

- **A.** Add `awaiting-proof-review` and `awaiting-customer-approval` as new statuses on `orders.status`. Explicit. One migration, one CHECK update.
- **B.** Reuse `order_proof_approval_gate` alone, leave `orders.status` at a single post-submit value. Less schema churn but masks the staff-review-before-customer-sees window in `orders.status` queries.

**Recommendation: A.** Staff dashboards filter on `orders.status`; collapsing the two windows into one makes "what's on my plate" harder.

### Decision 2 — Which Monday board

Resolved 2026-05-21 with Jamie: **CRM Deals board** (`MONDAY_REORDERS_BOARD_ID` env var, ID `2046357917`), in the **"New Deals" group** (group_id `'topics'`, already hardcoded in `lib/monday/reorder.ts:33`). Same place reorders and chatbot quote requests land today; AMs route from there. No new groups need to be created on any board.

`deal_source` column gets a new label: `"Portal - Order"` (existing `"Portal - Reorder"` label stays for the reorder pipeline). Monday's `create_labels_if_missing: true` parameter (already used in reorder.ts mutation) auto-creates the label on first use.

### Decision 3 — Production PDF: at checkout, or at push-to-customer?

The PDF is the assembled "this is the design we're printing" document, currently rendered by `prepareOrderProofForApproval` (staff-portal `lib/proofs/order-approval.ts`).

- **A.** Generate at customer checkout, attach to Monday immediately.
- **B.** Generate when staff push-to-customer (`POST /api/proofs/:id/approve`). PDF carries any staff edits.

**Recommendation: B.** Staff edits are the whole point of the dashboard step. Generating at checkout would attach the un-edited autofill to Monday and AMs might act on it before staff has touched it. Option B keeps the existing `prepareOrderProofForApproval` logic — just move its call site from the (retired) order-approve route to the proof-approve route.

### Decision 4 — Fate of `POST /api/orders/:id/approve`

Currently does five things:
- Generates production PDF
- Pushes Monday item (Production board)
- Attaches PDF to Monday
- Upserts portal job tracker
- Flips `orders.status` to `approved`

After this spec, each loses its reason or moves:
- Production PDF → moves to `POST /api/proofs/:id/approve`
- Monday push (now to Deals board) → moves to `lib/checkout/submit.ts`
- PDF attachment → moves to `POST /api/proofs/:id/approve`
- Tracker upsert → moves to `lib/checkout/submit.ts` (no, actually — see Decision 4b)
- Status flip → `POST /api/proofs/:id/approve` (already sets `order_proof_approval_gate`; we extend it to flip `orders.status` to `awaiting-customer-approval`)

**Recommendation: delete the route.** Remove the route file, the staff-portal `OrderDetailClient.tsx` "Approve" button, and the `retryOrderProductionPush` helper.

### Decision 4b — Job tracker upsert timing

The `upsertPortalJobTrackerForOrder` helper currently fires in the order-approve route and writes the Monday item id into the portal's local job tracker mirror. After this change, the Monday item exists from checkout, so the upsert should also happen at checkout — inside the same try/catch as the Monday push. If the Monday push fails, the tracker upsert is skipped, audit event recorded.

### Decision 5 — Monday push failure handling at checkout

Wrap in try/catch *after* `submit_b2b_order` returns success.

- On failure: leave `monday_item_id = null`, write `audit_events` row (`ORDER_MONDAY_PUSH_FAILED` + error), proceed with proof autofill and customer confirmation email as if push succeeded.
- New staff-portal surface: "Retry Monday push" button on `OrderDetailClient.tsx`, visible only when `monday_item_id IS NULL`. Wraps a new helper that mirrors the same calls done at checkout.

Mirrors how the existing order-confirmation email failure is handled (`submit.ts` step 6). Customers and finance never feel the failure.

### Decision 6 — Sub-item name format

Jamie's pick (2026-05-21): **prefix with decoration name even when there is none.** Format: `"{design_name}: {product_name} — {variant_label} × {quantity}"`. For a line with no decorations, `design_name` defaults to `"No decoration"`. Resolves to e.g. `"No decoration: Tee Black/M × 12"`. Production reads item names as the primary signal in Monday; the prefix makes "this line has no decoration" explicit at a glance.

`design_name` source: `quote_items.decorations[0].name` (the first decoration's name). For multi-decoration lines, the rest of the decorations end up in the proof PDF + the deal item's long-text breakdown column — they don't multiply sub-items. That mirrors the existing single-line-per-quote-item shape from reorder.ts.

### Decision 7 — AM resolution

`autofillProofForOrder` already resolves AM via `design_proofs.created_by_user_id || orders.assigned_to`. AM email already fires. For the Monday item, options:

- **A.** Look up Monday user by AM's email via Monday `users` query at push time.
- **B.** Cache `auth.users.id → monday_user_id` mapping in Supabase.
- **C.** Skip Monday person-assignment in v1. AM email already fires.

**Recommendation: C.** AM gets the email + the New Deals group is monitored by AMs anyway. Person-assignment is a follow-up.

### Decision 8 — AM email enrichment

Jamie's pick (2026-05-21): **add the Monday item link to the AM email body.** Source: `{staffPortalUrl}/proofs/{proofId}` already in the email + new line for the Monday item URL constructed from the item ID (`https://printroomco.monday.com/boards/{boardId}/pulses/{itemId}` — confirm domain at implementation).

Failure mode: if the Monday push at checkout failed, `monday_item_id` is null. The email helper conditionally renders the Monday link only if the ID is present. If absent, the email body says "Monday item creation failed — see audit log; you can retry from the order detail page in the staff portal".

### Decision 9 — Customer copy for new statuses

Jamie's pick: I pick.

- `awaiting-proof-review` (order submitted, staff hasn't pushed proof yet) → confirmation page reads **"Order received — we're preparing your proof"** (replaces the current "Order received — we'll send your proof shortly"; slight active-voice tighten). Order-tracker pill: **"Preparing proof"**.
- `awaiting-customer-approval` (proof pushed by staff, ball in customer's court) → order-tracker pill: **"Proof ready — review on your order page"**. Confirmation page (if customer revisits) reads **"Your proof is ready — open the order to review"** with a button to the proof viewer.

Status labels live in `lib/orders/status-labels.ts` (or wherever today's labels live; one source of truth across confirmation + tracker + my-collections views).

### Decision 10 — Sub-items on the CRM Deals board

The reorder pipeline (`lib/monday/reorder.ts`) does NOT use sub-items — it puts the line breakdown into `COL_FULL_FORM_RESPONSE` long-text column. Chris's note explicitly asks for sub-items "with products and design names".

Two routes:

- **A.** Use sub-items on the Deals board. Monday subitems are enabled per-board via the Subitems column. We assume it's already enabled on `2046357917` (manual board admin check at implementation time — if disabled, Jamie enables it; not a code change).
- **B.** Skip sub-items, use the long-text breakdown like reorder.ts. Diverges from Chris's request.

**Recommendation: A.** Subitems give AMs the same scannable line breakdown they're used to from the Production board. Implementation: extend `lib/monday/reorder.ts` (rename to `lib/monday/deal-item.ts` to reflect the broader purpose) so it supports an `order` mode that also creates subitems. The subitem creation call is identical to `createMondayProductionSubitem`.

## File structure

### `print-room-portal` (customer)

| File | Change |
|---|---|
| `lib/checkout/submit.ts` | Step 5: replace the `update({ status: 'awaiting-approval' })` block with a new block that (a) creates the CRM Deals item via the renamed helper, (b) creates subitems per `quote_items` row with the design-name-prefixed name, (c) writes `monday_item_id` to the order and `monday_subitem_id` to each `quote_item`, (d) optionally upserts the portal job tracker (Decision 4b), (e) flips `orders.status` to `awaiting-proof-review`. Everything inside try/catch with audit-log fallback (Decision 5). The autofill block (5b) stays where it is. |
| `lib/monday/deal-item.ts` (new — replaces / supersedes `lib/monday/reorder.ts`) | Existing reorder logic moves here under a `mode: 'reorder' \| 'order'` discriminator. `order` mode: adds `deal_source = "Portal - Order"`, creates subitems via `create_subitem` mutation, returns `itemId + subitemIds: Record<quoteItemId, string>`. `reorder` mode: behaviour-identical to today, no subitems. |
| `lib/monday/reorder.ts` | Delete after callers (`app/api/reorder/route.ts`) updated to import from `lib/monday/deal-item.ts`. |
| `lib/monday/column-ids.ts` | No changes needed for the new path — Deals board column IDs already live as constants inside reorder.ts and move with it to deal-item.ts. Remove the unused `PRODUCTION_BOARD_ID` + `PRODUCTION_SUBITEMS_BOARD_ID` constants if grep confirms no other portal callers (likely safe — `production-job.ts` becomes orphaned). |
| `lib/monday/production-job.ts` | **Delete** — only called by the (also-deleted) order-approve route. Confirmed by grep: zero in-portal callers today. |
| `app/api/checkout/route.ts` | No change. |
| `app/(portal)/checkout/confirmation/[orderId]/ConfirmationView.tsx` | Update the "Order received" copy per Decision 9. |
| `lib/orders/status-labels.ts` (or wherever current labels live) | Add labels for `awaiting-proof-review` ("Preparing proof") and `awaiting-customer-approval` ("Proof ready — review on your order page"). |
| `app/(portal)/order-tracker/OrderTrackerClient.tsx` | Pick up new labels via the central source — no per-component logic change. |
| Supabase migration `20260521_orders_status_proof_review_states.sql` | Extend `orders.status` CHECK constraint to allow `awaiting-proof-review` and `awaiting-customer-approval`. |

### `print-room-staff-portal`

| File | Change |
|---|---|
| `src/app/api/orders/[id]/approve/route.ts` | **Delete.** |
| `src/lib/orders/submit.ts` | Delete `retryOrderProductionPush`. |
| `src/lib/orders/retry-monday-push.ts` (new) | Server action / helper that re-runs the checkout-time Monday push for an order missing `monday_item_id`. Reuses `lib/monday/deal-item.ts` from the portal (or its staff-portal mirror — see note below). |
| `src/app/api/orders/[id]/retry-monday-push/route.ts` (new) | POST route. Wraps `retry-monday-push.ts`. Staff-only. Idempotent. |
| `src/lib/proofs/order-approval.ts` | `prepareOrderProofForApproval` keeps its current contract. Only the caller moves. |
| `src/app/api/proofs/[id]/approve/route.ts` | Slice H additions (Decision 3 + 4): before the existing `proof_quality_status='sent_to_customer'` flip, (a) call `prepareOrderProofForApproval` to render the PDF, (b) attach the PDF to the existing Monday Deals item (look up id via `orders.monday_item_id`), (c) flip `orders.status` to `awaiting-customer-approval` (new state). The existing `setOrderProofApprovalGate` logic stays. Email customer (existing). |
| `src/components/orders/OrderDetailClient.tsx` | Remove "Approve order" button + handler. Add a "Retry Monday push" button visible only when `monday_item_id IS NULL`, posts to the new retry route. |
| `src/lib/monday/production-job.ts` | **Delete** — no callers remain in staff portal once order-approve route is gone. Confirmed by grep. |
| `src/lib/monday/deal-item.ts` (mirror) | Same shape as the portal file (per the existing manual-sync pattern noted in production-job.ts:1). |
| `src/components/proofs/proof-editor.tsx` | Cosmetic: rename "Approve & send to customer" button to "Push to customer" to match the spec language. |

### Supabase

| Migration | Purpose |
|---|---|
| `20260521_orders_status_proof_review_states.sql` | Extend `orders.status` CHECK to add `awaiting-proof-review`, `awaiting-customer-approval`. |

### Env vars

No new env vars. Reuses the existing `MONDAY_REORDERS_BOARD_ID` (which the deal-item.ts helper reads). The previously-listed `MONDAY_PRODUCTION_PENDING_REVIEW_GROUP_ID` and `MONDAY_PRODUCTION_PRE_PRODUCTION_GROUP_ID` are no longer needed — production board isn't touched by this flow.

### Monday admin precondition

Confirm sub-items are enabled on board `2046357917`. If not enabled, the board admin enables them via Monday's board settings UI before deploy. Sub-items will sit on whichever subitems board Monday auto-creates. The `create_subitem` mutation doesn't require us to know the subitems board id explicitly.

If subitems turn out to be unsupported on the Deals board for any reason, fallback path = Decision 10 option B (long-text breakdown like reorder.ts). The deal-item.ts helper can support both modes behind a feature flag with minimal code churn — flag defaults to subitems.

## Open questions

All five resolved with Jamie 2026-05-21. Captured in Decisions 2, 6, 8, 9, 10 above and the "no UI change" non-goal. Nothing left in flight.

## Risk register

- **Subitems not enabled on Deals board (2046357917).** Mitigation: pre-flight check in Monday admin during plan execution. Code includes the long-text fallback path in case.
- **`create_labels_if_missing` quirks for `deal_source`.** Monday occasionally rejects a brand-new label if the column is in restricted-list mode. Mitigation: pre-create the `"Portal - Order"` label by hand in Monday admin before first checkout fires post-deploy. One-minute task.
- **Reorder helper rename risks breaking `app/api/reorder/route.ts`.** Mitigation: rename + re-export from old path as a deprecation step, then delete in a follow-up commit once both repos compile and tests pass.
- **Race between checkout Monday push and proof autofill** — both write to the same `orders` row (different columns) and `submit_b2b_order` returns before either runs. Both are sequential in `submit.ts` so no real race. Worth a comment in the file.
- **Deleting `POST /api/orders/:id/approve` breaks direct callers.** Grep both repos confirms only `OrderDetailClient.tsx` calls it. Plan-time grep before delete commit: zero external callers.
- **AM email body Monday URL format.** Hard-coded domain risks breaking on Monday account migration. Mitigation: build the link from a `MONDAY_BOARD_URL_PREFIX` env var defaulting to `https://printroomco.monday.com`. If env var missing, helper falls back to omitting the Monday link from the email (audit warning logged).

## Hand-off to plan

Spec is ready for `superpowers:writing-plans`. Recommended plan structure (4 independently shippable stages):

1. **Migration + label scaffold** — Supabase migration; Monday admin label + subitem-enable confirmation. Zero behaviour change yet.
2. **`lib/monday/deal-item.ts` extraction + `order` mode** — pure refactor of `lib/monday/reorder.ts` adding subitem support, behind no caller. Tests: existing reorder flow continues to work; new `order` mode tested in isolation.
3. **Portal checkout submit wiring** — call deal-item.ts from `submit.ts` step 5, flip to `awaiting-proof-review`, AM email Monday-link enrichment, confirmation copy update, status-label updates. Tests: integration test for the Monday-push-failure path (audit row + order still committed).
4. **Staff cleanup + proof-approve route extension** — extend proof-approve route to render PDF + attach to Deals item + flip status, delete order-approve route, delete production-job.ts in both repos, add retry-Monday-push button. Tests: e2e smoke walking customer submit → staff proof edit → staff push → customer proof approve → orders.status final transitions.

Stages 1–2 can land in either order. Stage 3 depends on 1 + 2. Stage 4 depends on 3.
