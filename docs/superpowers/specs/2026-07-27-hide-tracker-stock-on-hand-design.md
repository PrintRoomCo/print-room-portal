# Hide order-tracker for stock-on-hand orders (Chris feature #7)

**Date:** 2026-07-27
**Repos:** P (print-room-portal) — bulk of work; S (print-room-staff-portal) — one migration
**Phase 0 decision (locked):** hide stock-on-hand orders from the customer order tracker for **everyone, including org_admins**. Staff fulfilment (Monday pipeline) untouched.

## Problem

Stock-on-hand orders draw from pre-paid inventory and dispatch fast (via Starshipit, feature #8). They don't move through the mockup → proof → production milestones the order tracker was built to show, so a stock order sitting in the tracker at a hardcoded "Need: Mockup" seed stage is misleading. Chris wants them out of the customer tracker entirely.

`job_trackers` has **no** `order_type` (only a `quote_id` hop to `orders.order_type`). Filtering by joining on every read would cost a round-trip per tracker list. We denormalise instead.

## Approach

**Denormalise `order_type` onto `job_trackers` at creation, then filter at the single query-layer boundary every customer-facing read funnels through.** This is one enforcement point (the query layer) rather than N gated UI entry points — the UI links all point at the generic list and inherit the filter automatically.

### 1. Schema — S migration (into `db/pending-migrations/`, NOT applied)

`20260727HHMMSS_job_trackers_order_type.sql`:

```sql
alter table public.job_trackers
  add column if not exists order_type text;

comment on column public.job_trackers.order_type is
  'Denormalised copy of orders.order_type (stock_on_hand | purchase_order), stamped at tracker creation. Powers customer order-tracker visibility gating (feature #7): stock_on_hand trackers are hidden from every customer-side read. NULL = legacy/unstamped row (kept visible).';

alter table public.job_trackers
  add constraint job_trackers_order_type_check
  check (order_type is null or order_type in ('stock_on_hand', 'purchase_order'));

-- Backfill from the owning order via the quote_id hop. One order per quote
-- today (Spec A keeps a mixed cart a single purchase_order), so no ambiguity.
update public.job_trackers jt
  set order_type = o.order_type
  from public.orders o
  where o.quote_id = jt.quote_id
    and jt.order_type is null
    and o.order_type is not null;
```

### 2. Creation-time stamp — P

- `CreateJobTrackerShellArgs` gains `orderType: 'stock_on_hand' | 'purchase_order'`.
- The insert/update `row` in `createJobTrackerShellForOrder` carries `order_type: args.orderType`.
- `lib/checkout/submit.ts` passes the `orderType` const (already computed at the F-1 classify step, in scope at the 4c tracker call) into the shell creator.

### 3. The gate — one predicate in `lib/job-tracker-queries.ts`

```ts
/** Feature #7 — stock-on-hand orders are hidden from the customer tracker.
 *  NULL/legacy order_type stays visible (safe default). Applied to ALL roles
 *  incl. org_admin — the tracker never surfaces a stock order. */
export function isCustomerVisibleTracker(t: { order_type?: string | null }): boolean {
  return t.order_type !== 'stock_on_hand'
}
```

Applied **unconditionally**, right after the DB fetch and before `attachProductImages`/`fireAndForgetItemsSync`, in:
- `getJobsForUser` + `getJobsForCustomer` — personal list
- `getJobsForOrganization` — org_admin list (filter the deduped set)
- `getJobTrackerForUserByToken` — token deep-link (a filtered tracker returns `null` → `notFound()` → portal 404; this covers milestone-email deep links at the security layer)

**NOT** applied to `getJobTrackersByQuoteId` / `getLatestJobTrackerByQuoteId` — these are internal data helpers (confirmation page, reorder), not tracker-viewing entry points; filtering them could break reorder/confirmation for stock orders.

### 4. JobTracker type — P

Add `order_type?: 'stock_on_hand' | 'purchase_order' | null` to the `JobTracker` interface (`lib/job-tracker.ts`) so `.select('*')` rows type-check and the predicate reads the field without a cast.

### 5. UX polish — hide the dead-end CTA on stock-order confirmation — P

- `app/(portal)/checkout/confirmation/[orderId]/page.tsx`: add `order_type` to the `orders` select; pass `isStockOnHandOrder={order.order_type === 'stock_on_hand'}` to `ConfirmationView`.
- `ConfirmationView`: new prop `isStockOnHandOrder?: boolean`. When true, omit the "Track this order" `<Link>` (keep "Continue shopping"). Stock orders aren't tracked.

`isInventoryOrder` (`intent === 'inventory'`) is a **different** concept (org replenishment) and is not reused here.

## Explicitly out of scope / untouched

- Monday webhook, `tracker-status-engine`, `tracker-provisioning`, `sync-job-tracker-items`, and the Monday push inside `createJobTrackerShellForOrder` — all staff-side, unchanged.
- The generic `/order-tracker` nav item and the list CTAs (`proofs`, `ProofNotReady`, `my-collections`) — a mixed customer still tracks their purchase-order lines; the list simply omits stock rows.
- `getJobTrackersByQuoteId` / `getLatestJobTrackerByQuoteId` and the reorder path.

## Go-live ordering (CRITICAL — same hazard as #9)

The tracker INSERT will write `order_type`, so **the migration must be applied before the P deploy** that stamps it. The `.select('*')`-based read filter is NULL-safe, so a pre-migration read only *degrades* (stock orders still visible) rather than breaking — but the insert is a hard dependency. Migration-first.

## Testing

- Pure predicate `isCustomerVisibleTracker`: stock hidden, PO visible, NULL visible.
- Query fns: given mixed rows, the returned list excludes stock_on_hand (mock the supabase client). Token fn: a stock tracker → null even for the owner.
- `createJobTrackerShellForOrder`: row carries `order_type`.
- `ConfirmationView`: CTA absent when `isStockOnHandOrder`, present otherwise.
