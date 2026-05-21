# IDE PROMPT — Job tracker auto-create on B2B checkout + customer tracking surface

**Date:** 2026-05-21
**Owner / controller:** Jamie (Print Room)
**Repos touched:**
- `print-room-portal` (customer checkout flow + `/order-tracker` surface)
- `print-room-staff-portal` (only if Stage 1 reveals the existing helper needs extending — see §Stage 1)
**Branches:**
- portal: `feat/checkout-job-tracker-and-portal-tracking`
- staff: `feat/upsert-portal-job-tracker-b2b-callsite` *(only if Stage 1 lands changes here)*

---

## Why this PR

After today's Checkout → Monday → Auto-proof + Pre-approved-inventory pipelines shipped, Jamie tested an end-to-end submit and surfaced the next gap: **B2B checkout doesn't create a `job_trackers` row**. The legacy Shopify + chatbot-quote paths do, the staff CSR path does (via `upsertPortalJobTrackerForOrder` in the staff repo), but the customer-portal B2B submit doesn't wire that helper in. Net effect: the customer's `/order-tracker` page shows nothing for orders they just placed.

Two coupled deliverables:

1. **Auto-create a `job_trackers` row on every B2B checkout submit**, linked to `quote_id`, `user_id`, and (when available) `monday_item_id`. Idempotent — re-running the submit (or a retry) must not duplicate.
2. **Surface those trackers on the customer's `/order-tracker` page** scoped to the authenticated user, in a list that updates as Monday webhooks flip statuses (already wired into the webhook log table — not in scope to rewrite).

---

## Recon already done (saves the executor a stage)

DB recon via Supabase MCP on project `bthsxgmcnbvwwgvdveek`:

- **`job_trackers` table exists in full shape** — `tracker_token` (text NOT NULL, public-facing token for `/track/[token]`), `monday_item_id` (**bigint NOT NULL** today), `quote_id` (uuid, FK target unverified), `user_id` (uuid), `customer_email`, `customer_name`, `company_id` (text), `status`, `platform` (text NOT NULL), `quote_data_source` (text NOT NULL), `status_history` jsonb NOT NULL, `production_updates` jsonb NOT NULL, `tracking_info` jsonb NOT NULL, plus status-timestamp columns (`design_approval_at`, `production_start_at`, `production_complete_at`, `estimated_delivery_at`) and file-attachment jsonb columns (`proof_files`, `artwork_files`, `packing_slip_files`).
- **`job_tracker_webhook_logs`** captures inbound Monday updates by `monday_item_id` + `column_id` + `event_type`. Already wired to update trackers when Monday columns flip — out of scope to rewrite.
- **`tracker_email_log`** captures outbound tracker emails (notifications) by `tracker_token` + `email_type`. Out of scope.

Repo recon:

- **Staff repo already has `upsertPortalJobTrackerForOrder(admin, { quoteId, organizationId, mondayItemId, proofDocument })`** at `print-room-staff-portal/src/lib/orders/job-tracker.ts:26`. Idempotent on `(quote_id)` — re-uses existing `tracker_token` if a row already exists. Used today on the staff-CSR path. **Not called from the customer portal.**
- **Portal already has** `/order-tracker` route (`app/(portal)/order-tracker/OrderTrackerClient.tsx`), a `JobTrackerOrderCard` component, `lib/job-tracker-queries.ts`, and a `ProductionProgressBar`. They consume `job_trackers` rows already — they don't need to be rebuilt, only verified to filter by the authenticated user.
- **Portal also has a `/tracking` route** — distinct from `/order-tracker`. Investigate whether it's a separate surface (e.g. tokenised public landing for the email link) or a legacy duplicate, and decide whether to keep, alias, or retire (Stage 2 decision below).
- **Submit flow:** `lib/checkout/submit.ts` step 5a pushes to Monday and step 5b runs proof autofill. Tracker creation would slot between Monday push (gets `monday_item_id`) and proof autofill (so the tracker exists when proof URLs land via webhook), OR be made best-effort like the Monday push itself.

---

## Decisions to lock before Stage 3 (need Jamie's call)

| # | Question | Recommendation |
|---|----------|----------------|
| 1 | `monday_item_id bigint NOT NULL` — if the Monday push fails at checkout, do we still create the tracker? | **Allow NULL** via staff-repo migration. Tracker shell created at submit; Monday id stamped later by the existing retry route. Customer's `/order-tracker` shows the order immediately even if Monday is misbehaving. |
| 2 | Where does tracker creation live in `submit.ts`? | **New step 4c**, between the pre-approved inventory write (4b) and the Monday push (5a). Reuse the staff helper signature — but call it with `mondayItemId: null` initially, then update with the id once Monday returns. Or split into create-shell + update-monday-id. (Stage 2 dispatches between these two shapes.) |
| 3 | `platform` value for B2B orders | `'b2b_portal'` (new value). Existing chatbot/Shopify paths use their own values — confirm in Stage 1. |
| 4 | `status` on creation | `'awaiting-proof-review'` (mirrors the order status the checkout flow already sets at step 5b). |
| 5 | Should the customer-portal `/order-tracker` and `/tracking` routes merge? | **Stage 2 decision** — depends on what `/tracking` is doing today. If it's the tokenised public landing for the email link, keep them separate. If it's a duplicate, alias. |
| 6 | RLS on `job_trackers` for `/order-tracker` | Service-role read filtered by `user_id` server-side is fine for v1. RLS audit deferred to a separate ticket. Confirm `user_id` is the right FK (vs `customer_email`) given the per-member work shipped 2026-05-08. |
| 7 | Idempotency key | `(quote_id)` unique index. Existing helper already keys on this. Confirm the unique index exists in Stage 1 — if not, add it. |
| 8 | `quote_data_source` value | `'b2b_checkout_submit'` so the audit trail makes the origin obvious. |

Nothing Jon-blocked — these are Jamie's calls. Surface in Slack or via the morning shipping note if you'd like Jon's view.

---

## Files in scope (read-only references for the executor)

**Portal:**
- `lib/checkout/submit.ts` — Step 4b ends at the pre-approved inventory write block; Step 5a starts the Monday push. New step 4c lands here.
- `lib/job-tracker-queries.ts` — Existing customer-side query helpers. Likely needs an "all trackers for user X" function if one doesn't already exist.
- `app/(portal)/order-tracker/OrderTrackerClient.tsx` — Verify it lists trackers scoped to the authenticated user.
- `app/(portal)/order-tracker/page.tsx` (find via Glob — should be a sibling) — Server page; this is where the user-scoped query needs to fire.
- `app/(portal)/tracking/page.tsx` — Determine its purpose (tokenised public landing vs duplicate of `/order-tracker`).
- `components/orders/JobTrackerOrderCard.tsx` — Existing card component; should render without changes if our new rows match the schema.
- `lib/monday/deal-item.ts` — Touch only if Stage 2 decides the Monday push should also stamp `job_trackers.monday_item_id` on success.

**Staff portal:**
- `src/lib/orders/job-tracker.ts:26` (`upsertPortalJobTrackerForOrder`) — Existing helper. Decision #1 may require extending its signature to accept `mondayItemId: number | null`.
- `src/lib/orders/__tests__/job-tracker.test.ts` — Existing test; mirror its mocking pattern for the new B2B-flow test.

**Supabase migrations (only if Decision #1 lands as "Allow NULL"):**
- New staff-repo migration `supabase/migrations/20260521000020_job_trackers_monday_item_id_nullable.sql` — ALTER COLUMN DROP NOT NULL on `monday_item_id`. Idempotent (`IS NOT NULL` guard).

---

## Stage 1 — Investigate

**Goal:** Pin down the unknowns Recon couldn't resolve so Stage 3 doesn't ship with a signature drift like this morning's RPC surprise.

Steps (each one a TodoWrite item):

1. **Read `print-room-staff-portal/src/lib/orders/job-tracker.ts` in full.** Note its signature, idempotency strategy, and what it derives from `proofDocument`. Question: does it require a proof to exist, or can it be called pre-proof?
2. **Read `app/(portal)/order-tracker/page.tsx` + `OrderTrackerClient.tsx`.** Document:
   - Which client (service-role or user-scoped)?
   - Filter clause — `user_id`, `customer_email`, or something else?
   - Sort order + pagination?
3. **Read `app/(portal)/tracking/page.tsx`.** Document its purpose. Decide for Decision #5.
4. **Check existing unique constraints on `job_trackers`** via Supabase MCP: `SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = 'public.job_trackers'::regclass`. Confirm `(quote_id)` is unique. If not, add an index in a new staff-repo migration.
5. **Confirm `quote_id` FK target.** If it's `quotes.id` → great. If it's a legacy text column → flag for Decision #7.
6. **List existing `platform` values currently in use** via `SELECT DISTINCT platform FROM job_trackers`. Validate `'b2b_portal'` is new and not colliding.
7. **Spot-check the Monday-deal-item callsite** in `lib/monday/deal-item.ts` — does it already attempt a tracker write today? If yes, the new step 4c collapses to a no-op verification.

**Acceptance:** A short investigation note appended to this file (under §Stage 1 findings) so the strategising step has the facts.

---

## Stage 2 — Strategise

Given Stage 1 findings, lock the following before writing code:

- **Tracker shape on create.** Decide between (A) call the existing staff helper with `mondayItemId: null`, requiring it to be extended; (B) write a portal-side twin of the helper that doesn't require Monday. Recommendation: (A), via Decision #1's migration. (B) duplicates ~80 LOC.
- **`monday_item_id` update path.** After step 5a's Monday push succeeds, stamp `job_trackers.monday_item_id = <id>` keyed by `quote_id`. Best-effort, audited as `job_tracker.monday_id_attached_failed` if the update fails.
- **`/order-tracker` filter.** If Stage 1 finds the page filters by `customer_email` (legacy), switch to `user_id` for B2B and keep the email branch for legacy rows (`OR`).
- **Audit actions to add.** Likely `ORDER_JOB_TRACKER_CREATED`, `ORDER_JOB_TRACKER_CREATE_FAILED`, `ORDER_JOB_TRACKER_MONDAY_LINK_FAILED`. Mirror in both repos.

---

## Stage 3 — Implement

### 3.1 — Staff repo migration (only if Decision #1 = NULL allowed)

New migration `supabase/migrations/20260521000020_job_trackers_monday_item_id_nullable.sql`:

```sql
BEGIN;
ALTER TABLE public.job_trackers
  ALTER COLUMN monday_item_id DROP NOT NULL;

-- If Stage 1 confirms (quote_id) isn't already unique, also add:
-- CREATE UNIQUE INDEX IF NOT EXISTS job_trackers_quote_id_unique ON public.job_trackers (quote_id) WHERE quote_id IS NOT NULL;
COMMIT;
```

Apply via Supabase MCP `apply_migration`. Smoke-test with a NULL insert; rollback.

### 3.2 — Staff helper extension (only if Decision #1)

Open `print-room-staff-portal/src/lib/orders/job-tracker.ts:26`. Change `mondayItemId: string` to `mondayItemId: string | null`. Inside the row builder, switch:

```ts
monday_item_id: mondayItemId === null ? null : Number(mondayItemId),
```

Add a unit test scenario where `mondayItemId === null`. Existing callsites pass through unchanged.

### 3.3 — Portal callsite — new step 4c in `lib/checkout/submit.ts`

Between the pre-approved inventory block (step 4b) and the Monday push (step 5a):

```ts
// 4c. Auto-create the public job tracker for the order. Best-effort: a
//     failure here logs + audits but does NOT roll back the order. The
//     customer sees the tracker on /order-tracker the moment they land on
//     the confirmation page.
try {
  // Defer to the staff helper, which already handles idempotency on quote_id.
  // We pass mondayItemId: null because the Monday push hasn't run yet — step
  // 5a stamps the id after it succeeds (see "Monday id attach" below).
  const { upsertPortalJobTrackerForOrder } = await import(
    // Cross-repo import is not possible; create a thin portal-side wrapper
    // OR copy the helper signature. Stage 2 picks one.
    '@/lib/orders/job-tracker'
  )
  await upsertPortalJobTrackerForOrder(admin, {
    quoteId: quote_id,
    organizationId: input.context.organizationId,
    userId: input.context.userId,
    mondayItemId: null,
    orderRef: order_ref,
    customerEmail: input.context.email,
    customerName: input.context.organizationName,
    platform: 'b2b_portal',
    quoteDataSource: 'b2b_checkout_submit',
    status: 'awaiting-proof-review',
  })
  await recordAuditEvent(
    {
      orgId: input.context.organizationId,
      actorUserId: input.context.userId,
      action: AUDIT_ACTIONS.ORDER_JOB_TRACKER_CREATED,
      targetType: 'order',
      targetId: order_id,
      metadata: { order_ref, quote_id },
    },
    admin,
  )
} catch (e) {
  // Best-effort audit + log; do not roll back.
}
```

### 3.4 — Monday id attach in step 5a

After `pushOrderDeal` returns `itemId`:

```ts
await admin
  .from('job_trackers')
  .update({ monday_item_id: Number(itemId), last_synced_at: new Date().toISOString() })
  .eq('quote_id', quote_id)
```

Wrap in best-effort try/catch; audit `ORDER_JOB_TRACKER_MONDAY_LINK_FAILED` on error.

### 3.5 — `/order-tracker` page wiring

Verify the existing server page:
- Uses the authenticated user's `userId` (from `requireB2BCustomer`).
- Filters `job_trackers.user_id = userId` (or via `customer_email` fallback if Stage 1 finds the schema demands it).
- Renders existing `JobTrackerOrderCard` rows.

If the page is empty / hardcoded / filters by Shopify columns only, patch the filter to include `user_id` rows.

### 3.6 — Audit constants

Mirror in both repos (`lib/audit/actions.ts` portal + `src/lib/audit/actions.ts` staff):

```ts
ORDER_JOB_TRACKER_CREATED: 'order.job_tracker_created',
ORDER_JOB_TRACKER_CREATE_FAILED: 'order.job_tracker_create_failed',
ORDER_JOB_TRACKER_MONDAY_LINK_FAILED: 'order.job_tracker_monday_link_failed',
```

---

## Stage 4 — Tests + sprint doc

1. **Portal unit test** `lib/checkout/__tests__/submit.job-tracker.test.ts`:
   - intent='customer' + 'inventory': asserts `job_trackers.upsert` is called once with `mondayItemId: null` and the right shape.
   - Monday push success: asserts a follow-up update stamps `monday_item_id`.
   - Helper failure: asserts the failure audit row lands and the order still commits.
2. **Staff helper test** update — new scenario for `mondayItemId === null`.
3. **Run** `pnpm exec tsc --noEmit` + focused `pnpm exec vitest run lib/checkout/__tests__/submit.*.test.ts` in portal. `npx tsc --noEmit` in staff.
4. **Manual smoke** after deploy:
   - Submit a fresh checkout. Confirm a `job_trackers` row lands with the correct user_id, quote_id, status, platform.
   - Confirm `monday_item_id` is stamped after Monday push completes.
   - Confirm `/order-tracker` shows the new card.
5. **Sprint doc** at `print-room-portal/docs/superpowers/sprint-docs/2026-05-21-job-tracker-on-b2b-checkout.md`. Same template as today's morning doc.

---

## PR template

```
## Summary
- B2B checkout submit now auto-creates a job_trackers row linked to the order, scoped by user_id
- Monday push stamps job_trackers.monday_item_id once the deal lands; failure is best-effort + audited
- /order-tracker now surfaces these rows so customers can see their order's production status immediately after submission
- (Staff) job_trackers.monday_item_id is now nullable so the tracker can exist before the Monday push

## Test plan
- [ ] Submit checkout — job_trackers row lands with status='awaiting-proof-review', platform='b2b_portal', user_id=current user, quote_id=submitted quote
- [ ] /order-tracker shows the order as a card within seconds of submit
- [ ] Monday push success: monday_item_id stamps within the same submit
- [ ] Monday push failure: tracker still exists, audit row 'order.job_tracker_monday_link_failed' present
- [ ] No duplicate trackers when the same idempotency_key replays
```

---

## Why this stack (4-axis)

- **Rendering:** Server Next.js for `/order-tracker` (same as the rest of the customer portal). Job cards are server-rendered for SEO-irrelevant pages + the data is per-user so caching is per-request.
- **Caching:** `revalidateTag(['job-trackers', userId])` after the submit; the existing webhook log path also writes to the same table so the tracker tag should already be revalidated on inbound Monday updates (verify in Stage 1).
- **Performance:** A single `from('job_trackers').select(...).eq('user_id', userId)` query is sub-50ms with an index on `user_id`. If the index is missing, add it in the same migration as Decision #1.
- **Ecommerce pattern:** This is a tokenised order-status page (Shopify / Etsy / WooCommerce all ship the same thing). The tokenised public landing already exists (`/tracking` if Stage 1 confirms) for email-link recipients; `/order-tracker` is the authenticated-customer dashboard view of the same rows.

---

## Out of scope (deferred)

- **`/tracking` migration / consolidation** beyond the Stage 2 decision. If they're separate surfaces with separate purposes, leave them both.
- **Webhook reconciliation logic.** `job_tracker_webhook_logs` is already wired — not re-touched here.
- **Tracker email send on creation.** `tracker_email_log` infrastructure exists; whether to send a "your order is now trackable" email at submit is a separate copy/UX decision.
- **Old chatbot/Shopify tracker creators.** They keep using their existing paths; this PR only adds the B2B path.
- **`/order-tracker` performance pass.** If the list is slow at the next milestone, separate ticket.

---

## Open questions for Jamie (please answer before Stage 3)

1. **Allow `monday_item_id` to be NULL?** (Decision #1 — recommendation: yes, via staff migration.) Want me to walk through the tradeoff or happy for me to go with the recommendation?
2. **Keep `/tracking` and `/order-tracker` as separate surfaces, or merge?** (Pending Stage 1 read of `/tracking`.)
3. **Do we want a tracker-creation email at submit?** (Out of scope by default — flag if you want it added.)
4. **Anything else Jon should be looped into here?** The morning's pre-approved-inventory PR didn't need his input. This one introduces a new `platform` value + a schema relaxation, which feel like the level he might want to know about — your call whether to route via a question-form Slack ping or just ship and tell.

---

## Notes for the executor

- Auto mode + Jamie's standing workflow = commit/push to feature branches, Jamie merges via PR. Do NOT commit straight to main (lesson from today's confirmation-fix sequence — I learned it the hard way).
- Memory rule "Default to Best Data Modelling": if Stage 1 reveals `job_trackers.user_id` is awkward (e.g. text vs uuid), propose the clean fix first before patching around it.
- This is web-project scoped, so the 4-axis block above already covers the stack decision — no additional brainstorming needed at execution time.

---

## Stage 1 findings (appended 2026-05-21 by executor)

1. **Staff helper requires `proofDocument`** at [src/lib/orders/job-tracker.ts:26](../../../../print-room-staff-portal/src/lib/orders/job-tracker.ts#L26) — uses it for `monday_project_name`, `customer_email`/`name`, `product_images`, and `quote_data`. At checkout submit step 4c we have no proof yet (proofs land in step 5b). Reusing the staff helper as-is is not viable; cross-repo import isn't possible either. **→ Stage 2 picks option (B): portal-side shell-creator.**
2. **Existing helper sets `status: 'need-proof'`, `platform: 'b2b-portal'` (hyphen), `quote_data_source: 'submit-quote'`.** Plan's proposed `'awaiting-proof-review'`/`'b2b_portal'`/`'b2b_checkout_submit'` would all drift (and the last would FAIL the CHECK constraint).
3. **`quote_data_source` has a CHECK constraint** allowing only `('unknown', 'submit-quote', 'monday-subitems', 'manual')`. Plan's `'b2b_checkout_submit'` is invalid. **→ Use `'submit-quote'`.**
4. **`/tracking` is a literal alias** — `export default OrderTrackerPage` in [app/(portal)/tracking/page.tsx](../../../app/(portal)/tracking/page.tsx). Decision #5 resolved: no merge needed; they're the same surface.
5. **`getPortalOrderTrackerData()`** in [lib/portal-data.ts:73](../../../lib/portal-data.ts#L73) already routes via `getJobsForUser(user.id, user.email)` with `getJobsForCompany` for org_admin. **Stage 3.5 is mostly a no-op — just set `user_id` on insert.**
6. **`job_trackers` constraints:** `quote_id` FK→`quotes(id)` ON DELETE SET NULL ✓; `user_id` FK→`auth.users(id)` ✓; `tracker_token` UNIQUE; `job_reference` UNIQUE (serves as de-facto idempotency via `order_ref`). NO unique on `quote_id`.
7. **Platform values today:** only `'print-room'` (1011 rows). No CHECK constraint on `platform`. Safe to add `'b2b-portal'`.
8. **`autofillProofForOrder` does NOT touch `job_trackers`** — creates `design_proofs` + versions only. Clean separation — new tracker write needed.
9. **`deal-item.ts` does NOT touch `job_trackers`** — only `lib/monday/sync-job-tracker-items.ts` and `lib/job-tracker-queries.ts`. New step 4c is genuinely required.

## Stage 2 strategy locked

- **Helper shape:** Portal-side **`createJobTrackerShellForOrder()`** at `print-room-portal/lib/orders/job-tracker.ts`. Mirrors staff helper structure but: no proof argument, `mondayItemId: number | null`, takes `userId`, leaves `product_images`/`quote_data` null (filled later by Monday subitems sync, which is already wired).
- **Migration:** Single staff-repo migration `20260521000020_job_trackers_monday_item_id_nullable.sql` — `ALTER COLUMN monday_item_id DROP NOT NULL`. Skip adding a `quote_id` unique index — `job_reference` UNIQUE already provides DB-level dedupe via `order_ref`. The app-level "find by quote_id then upsert" race is theoretical for single-user submits and won't survive `order_ref` reuse anyway.
- **Staff helper:** **Left untouched.** Avoids signature churn into the staff CSR flow.
- **Values:** `status='need-proof'`, `platform='b2b-portal'`, `quote_data_source='submit-quote'`. Matches existing helper convention.
- **Step 4c placement:** Between pre-approved-inventory (4b) and Monday push (5a). Best-effort: failure audits `ORDER_JOB_TRACKER_CREATE_FAILED`, never rolls back.
- **Step 5a patch:** After `pushOrderDeal` succeeds and we have `itemId`, also UPDATE `job_trackers SET monday_item_id=$1 WHERE quote_id=$2`. Best-effort; failure audits `ORDER_JOB_TRACKER_MONDAY_LINK_FAILED`.
- **Audit constants:** Add `ORDER_JOB_TRACKER_CREATED`, `ORDER_JOB_TRACKER_CREATE_FAILED`, `ORDER_JOB_TRACKER_MONDAY_LINK_FAILED` to BOTH repos (portal: order.submit hub; staff: cross-repo audit query parity).
