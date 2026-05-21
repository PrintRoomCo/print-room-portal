# Checkout → Monday → Auto-Proof Pipeline — 2026-05-21

## What shipped

Customer checkout now pushes directly to Monday's CRM Deals board ("New Deals" group) instead of being held behind an AM-approve gate. The auto-proof is generated and the AM is emailed at the moment of submission. Staff edit the proof, then push it to the customer. The customer is the sole approval gate.

In short: the AM stops being a step in the assembly line and becomes a notified party. Lead time on customer-facing proof shrinks from ~hours-to-days (AM availability) to ~minutes (auto-proof) plus whatever the staff edit takes.

## Why

Chris's 2026-05-21 notes asked for orders to push to Monday immediately at checkout, with the AM as a recipient (not a gating approver). The legacy flow blocked every order behind `POST /api/orders/[id]/approve`, which required an AM to confirm pricing + decoration before anything moved. That's a bottleneck the new B2B portal model was designed to remove — accounts already have agreed catalogues and per-org pricing, so the AM-confirm step adds latency without adding value.

## How it works

1. Customer submits at `/checkout`. `lib/checkout/submit.ts` step 5 calls `pushOrderDeal` from `lib/monday/deal-item.ts` — creates a deal item on board 2046357917 (CRM Deals) in group `topics` ("New Deals"), labelled `deal_source = "Portal - Order"`, with one sub-item per cart line. Order flips to `awaiting-proof-review`.
2. `notifyAmBestEffort` (`lib/proofs/autofill-for-order.ts`) sends the AM the proof link + a deep Monday link (`MONDAY_BOARD_URL_PREFIX` env var, default = production tenant).
3. Auto-proof draft is generated from product data (existing autofill, unchanged).
4. Staff opens the proof in `/proofs/[id]`, edits, clicks **"Push to customer"** (renamed from "Approve & send to customer"). The staff `POST /api/proofs/[id]/approve` route renders the production PDF, attaches it to the Monday Deals item via `add_file_to_column` (column `file_mky94ym9`), flips order to `awaiting-customer-approval`, sends the customer email.
5. Customer opens `/orders/[id]/proof`, approves. Order proceeds to fulfilment.
6. On Monday-push failure at checkout, order still commits (status flips), audit row written (`order.monday_push_failed`), staff retries via the **"Retry Monday push"** button on `OrderDetailClient.tsx` → `POST /api/orders/[id]/retry-monday-push`.

## Key decisions

- **Push to CRM Deals, not Production board** (Spec Decision 2). Production board is the post-approval pipeline; Deals is where AMs route incoming work. New flow lives where AMs already work.
- **Add `orders.monday_item_id` column** rather than reuse `quotes.monday_item_id`. The latter holds legacy Production-board ids; conflating boards = future confusion. `quotes.monday_item_id` becomes vestigial after this sprint and is a follow-up cleanup. (Plan amendment Stage 3 dispatch.)
- **Order-mode-only mirror in staff `deal-item.ts`**. Portal's reorder mode depends on `@/lib/job-tracker` and `@/lib/config/reorder` — staff has neither, and staff has no reorder caller. Byte-identical mirror was impossible; the divergence is deliberate. (Plan amendment Stage 2 dispatch.)
- **Don't extract `build-monday-payload.ts` shared helper**. Stage 3's submit.ts had just shipped; re-touching it for an extraction risks regression. ~30 LOC duplicated between portal checkout step 5 and staff retry route, both tagged with a `TODO(2026-05-21)` for future extraction when a 3rd caller appears.
- **Don't delete `production-job.ts` from staff** (conservative deviation from plan). `quotes/approve.ts` and `orders/submit.ts` (driven by the legacy `monday-reconcile` route) still import it. Customer-facing entry point is gone (order-approve route deleted), but the back-end plumbing stays so in-flight legacy orders aren't broken.
- **Don't delete `retryOrderProductionPush`** for the same reason — `monday-reconcile` route is a second caller, undocumented in the plan.

## Gotchas

- **`MONDAY_REORDERS_BOARD_ID` env var name is misleading.** It now holds the *Deals* board id (2046357917) — same board the reorder helper already pushed to. The variable name predates the rename; renaming it is a follow-up. For now: both reorder and order flows read from the same env var.
- **Subitems column must stay enabled on board 2046357917.** If admin disables it, order-mode `pushOrderDeal` still creates the parent item but `createOrderDealSubitem` calls will silently fail (caught + audit-logged, item survives). Subitems pre-flight item #1 of this sprint — confirmed via `get_board_info`.
- **`"Portal - Order"` label on `color_mkzhwkjn` (deal_source) was added via Monday MCP this sprint** — id 14, colour `dark_purple` (#784bd1), distinct from `"Portal - Reorder"` (sofia_pink). `create_labels_if_missing: true` in the mutation is a belt-and-braces; pre-creation is the load-bearing safeguard.
- **`MONDAY_BOARD_URL_PREFIX`** is the env var to override if the tenant subdomain changes. Default lives in `resolveMondayItemUrl` (`lib/proofs/autofill-for-order.ts`) AND in `.env.example`.
- **Pre-existing test failure unrelated to this branch:** `lib/checkout/__tests__/CheckoutClient.review-redirect.test.tsx` fails on `useCurrency must be used within a CurrencyProvider`. Predates Stage 1; out of scope this sprint.
- **AM email "Monday link" line is omitted when push failed** — `mondayItemId === null` → no broken link in email. Staff sees this via the retry-Monday-push button surfacing.

## Deferred

- **Monday person-assignment** (AM Monday-user lookup → assign deal to specific AM). Out of scope per Spec Decision 7. Currently deals land in "New Deals" and AMs route manually.
- **Shipping tier rules** awaiting Chris's myPR table (Chris-owed). No code touched.
- **Extract `build-monday-payload.ts`** when a 3rd caller appears.
- **Drop `quotes.monday_item_id` column** once legacy Production-board flow is fully wound down.
- **Delete staff `production-job.ts` + `retryOrderProductionPush`** once `monday-reconcile` route + `quotes/approve.ts` are also retired.

## Where to find it

**Customer portal** (`print-room-portal`, branch `feat/checkout-monday-pipeline-2026-05-21`):
- Entry point — checkout: `lib/checkout/submit.ts:745-855` (step 5)
- Monday client: `lib/monday/deal-item.ts` (order + reorder modes, mode-discriminated)
- AM email enrichment: `lib/proofs/autofill-for-order.ts` (`resolveMondayItemUrl`)
- Audit action: `lib/audit/actions.ts` (`ORDER_MONDAY_PUSH_FAILED`)
- Status labels: `lib/orders/status-labels.ts`
- Migrations: `supabase/migrations/20260521000000_orders_status_proof_review_states.sql`, `20260521000001_orders_monday_item_id.sql`
- Confirmation copy: `app/(portal)/checkout/confirmation/[orderId]/ConfirmationView.tsx`
- Test: `lib/checkout/__tests__/submit.monday-push-failure.test.ts`

**Staff portal** (`print-room-staff-portal`, branch `feat/checkout-monday-pipeline-2026-05-21`):
- Entry point — proof approve: `src/app/api/proofs/[id]/approve/route.ts`
- Retry route: `src/app/api/orders/[id]/retry-monday-push/route.ts`
- Monday helpers: `src/lib/monday/deal-item.ts` (order mode + `attachPdfToMondayItem`)
- Retry button: `src/components/orders/OrderDetailClient.tsx`
- Button rename: `src/components/proofs/proof-editor.tsx`
- Status labels: `src/lib/orders/status-labels.ts`
- Audit actions: `src/lib/audit/actions.ts` (`ORDER_MONDAY_PUSH_FAILED`, `ORDER_MONDAY_PUSH_RETRIED`)

**Monday board:**
- CRM Deals = 2046357917
- New Deals group = `topics`
- Files column = `file_mky94ym9`
- Deal Source column = `color_mkzhwkjn` (label id 14 = "Portal - Order", id 12 = "Portal - Reorder")

**Env vars:**
- `MONDAY_REORDERS_BOARD_ID` (holds Deals board id despite the name — both modes)
- `MONDAY_BOARD_URL_PREFIX` (default `https://theprint-room-group.monday.com`)
- `MONDAY_API_TOKEN` (existing)

**Supabase:** project `bthsxgmcnbvwwgvdveek`. Migrations live in `print-room-portal/supabase/migrations/` (staff repo doesn't host migrations).

**Commits:**
- Portal: `193dfaf`, `d1d4c28`, `bad487c`, `98ced23`
- Staff: `f5c3139`, `71b541d`, `94bc599`
