# Job tracker auto-create on B2B checkout — 2026-05-21

## What shipped

A third bolt-on stacked on the morning's Checkout → Monday → Auto-proof and Pre-approved-inventory pipelines:

1. **B2B checkout submit now creates a `job_trackers` row** scoped to the authenticated customer's `user_id`, with `platform='b2b-portal'`, `status='need-proof'`, `quote_data_source='submit-quote'`, and `quote_data` populated from the same `quote_items` payload the confirmation page renders.
2. **Monday id attach** — after the Monday push in step 5a succeeds, `job_trackers.monday_item_id` is stamped (keyed by `quote_id`). This lets the existing `job_tracker_webhook_logs` path flip status as the deal moves through the Deals board, without any new webhook wiring.
3. **Schema relaxation** — `job_trackers.monday_item_id` is now nullable so the tracker shell can exist before the Monday push runs (or after a Monday push failure).

End-state: a customer who submits a B2B order sees a tracker card on `/order-tracker` immediately, with the same line breakdown the confirmation page shows. As Monday's status column flips, the card's progress bar advances via the already-wired webhook path.

## Why

The morning's two pipelines made order submission feel finished from the customer's side — confirmation page, AM gets a proof shell, inventory writes through. But `/order-tracker` was still empty for any order submitted via the B2B portal: legacy Shopify + chatbot-quote paths each had their own tracker creator, and the staff CSR path went through the `upsertPortalJobTrackerForOrder` helper, but B2B portal submit didn't wire any of them. Net: the customer placed an order, navigated to the tracker, saw nothing.

The "render the same data as the confirmation page" framing came directly from Jamie: don't build a legacy proof-shaped tracker payload, just snapshot the real order data and let Monday drive status. This sidesteps a separate "what shape does `quote_data` take" debate.

## How it works

1. **Stage 1 — Schema relaxation** (staff repo). New migration `20260521000020_job_trackers_monday_item_id_nullable.sql` drops `NOT NULL` on `monday_item_id`. Idempotent; applied via Supabase MCP.
2. **Stage 2 — Portal helper** (portal). New `lib/orders/job-tracker.ts` exports `createJobTrackerShellForOrder(admin, args)`. Internally fetches `b2b_accounts.company_id`, `quotes.{subtotal,decoration_cost,total_amount}`, `quote_items` joined with `product_variants(product_color_swatches, sizes)`, and master `products.image_url` rows. Builds a `QuoteData`/`QuoteDataItem` payload that `JobTrackerOrderCard` + `ProjectLineItem` already render without changes:
   - Each line: `productName`, `quantity`, `sizes: { [variantSizeLabel]: qty }` when a size exists (else absent — card falls back to total qty), `customizations.colors.garment = { name: swatchLabel, hex }`, `customizations.logos = decorations.map → { imageUrl, printMethod }`.
   - Summary: `{ subtotal, total, artworkTotal }` from `quotes`. Currency: `'NZD'`.
   - `product_images` populated from `products.image_url` for the lines.
3. **Stage 3 — Submit step 4c** (portal). `lib/checkout/submit.ts` inserts a `try { createJobTrackerShellForOrder(...) + audit } catch { audit failure }` block between the pre-approved-inventory write (step 4b) and the Monday push (step 5a). Best-effort: failure audits `order.job_tracker_create_failed` and the order still commits.
4. **Stage 4 — Monday id attach** (portal). Inside step 5a's existing `try`, after `pushOrderDeal` returns `itemId` and `orders.monday_item_id` is stamped, a nested `try` updates `job_trackers SET monday_item_id = Number(itemId), last_synced_at = now() WHERE quote_id = $1`. Failure audits `order.job_tracker_monday_link_failed`; the Monday push success itself is unaffected.
5. **Stage 5 — Audit constants** (both repos). Added `ORDER_JOB_TRACKER_CREATED`, `ORDER_JOB_TRACKER_CREATE_FAILED`, `ORDER_JOB_TRACKER_MONDAY_LINK_FAILED` to both `lib/audit/actions.ts`.

`/order-tracker` itself needed **no code changes** — `getPortalOrderTrackerData()` in `lib/portal-data.ts` already routes via `getJobsForUser(user.id, user.email)` for non-admins and `getJobsForCompany(company_id)` for `org_admin`. New rows carrying `user_id` slot into the existing query path. `/tracking` is already aliased (`export default OrderTrackerPage`).

## Key decisions

- **Portal-side helper, not extending the staff helper.** The staff helper requires a `proofDocument` argument (used for `customer_email`, `product_images`, `quote_data` items, `monday_project_name`). At checkout step 4c no proof exists yet — proofs land in step 5b via `autofillProofForOrder`. Reusing the staff helper as-is wasn't viable, and cross-repo imports aren't possible. Writing a portal twin keeps each surface's contract clean.
- **`status='need-proof'`, `platform='b2b-portal'`, `quote_data_source='submit-quote'`.** These match the existing staff helper's choices (the plan's initial proposals — `'awaiting-proof-review'`, `'b2b_portal'`, `'b2b_checkout_submit'` — would have drifted, and `'b2b_checkout_submit'` would have hard-failed the `quote_data_source` CHECK constraint).
- **Idempotency via `job_reference` UNIQUE.** No new `quote_id` unique index was added — the existing `job_reference` UNIQUE constraint already catches duplicate submits at the DB layer (because `order_ref` is unique per submit). The helper's app-level "find by quote_id, then update or insert" handles retries from the same submit.
- **Render the confirmation page's data, not a legacy proof shape.** Jamie's call. The helper builds `QuoteData` from `quote_items` directly so the tracker reflects exactly what was submitted.
- **Monday id attach as a follow-up update, not part of the initial insert.** Keeps the two best-effort failure modes orthogonal — tracker create can succeed even when Monday is down, and the existing Monday retry route can re-stamp the id later (no new wiring needed).
- **Staff helper untouched.** Avoids blast radius into the staff CSR flow. Future refactor: extract a shared `buildTrackerRow` from both helpers if the duplication grows.

## Gotchas

- **`monday_project_name` doesn't exist as a column.** The staff helper writes it on every insert, but `information_schema.columns` shows no such column on `public.job_trackers`. PostgREST appears to silently drop the unknown key (or the staff path's row never actually contains it after a serialization step we didn't trace). The portal helper omits the field. This is worth a separate ticket against the staff repo.
- **`product_color_swatches.hex`, not `hex_value`.** Easy gotcha — the confirmation page query uses the same column.
- **`Number(itemId)` for the Monday id stamp.** `pushOrderDeal` returns `itemId` as a `string`, but `job_trackers.monday_item_id` is `bigint`. The cast lands the right type. Tests fix `itemId = '12345'` to verify.
- **Pre-existing tests now have "swallowed" stderr lines.** `submit.pre-approved-inventory.test.ts` doesn't mock `createJobTrackerShellForOrder`, so the real helper runs against the stub and throws on empty insert response — which the new step 4c best-effort catch swallows + audits. The pre-approved tests don't assert on tracker audits, so they still pass. This is incidental verification that the failure mode doesn't break the rest of the submit flow.

## Where things live

- **Schema:** `print-room-staff-portal/supabase/migrations/20260521000020_job_trackers_monday_item_id_nullable.sql`
- **Helper:** `print-room-portal/lib/orders/job-tracker.ts` (new file)
- **Wiring:** `print-room-portal/lib/checkout/submit.ts` (step 4c + step 5a Monday id attach)
- **Audit constants:** `print-room-portal/lib/audit/actions.ts` + `print-room-staff-portal/src/lib/audit/actions.ts`
- **Tests:** `print-room-portal/lib/orders/__tests__/job-tracker.test.ts` (3 helper unit tests) + `print-room-portal/lib/checkout/__tests__/submit.job-tracker.test.ts` (3 submit integration tests)
- **`/order-tracker` rendering:** untouched — `lib/portal-data.ts`, `lib/job-tracker-queries.ts`, `components/orders/JobTrackerOrderCard.tsx`, `components/orders/ProjectLineItem.tsx`

## Follow-ups

- **`monday_project_name` ghost-column in the staff helper.** Verify whether the column was renamed or whether the helper's been writing a no-op key for ages.
- **Tracker email on creation.** `tracker_email_log` infrastructure exists; whether to send a "your order is now trackable" email at submit is a separate copy/UX decision. Deferred.
- **Shared `buildTrackerRow` extraction.** Only if a third caller appears or if drift between the staff helper and the portal helper becomes annoying.
