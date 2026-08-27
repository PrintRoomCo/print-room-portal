# Hide order-tracker for stock-on-hand orders (Chris #7) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox syntax.
> **Program note:** git is Jon's. NO commits. Each task ends at a green test run; a "what I'd commit" ledger is kept at the bottom for Jon. The S migration goes into `db/pending-migrations/` and is NOT applied (Jon's explicit go).

**Goal:** Stock-on-hand orders never appear in the customer order tracker (list, API, token deep-link) for anyone incl. org_admins; staff Monday pipeline untouched.

**Architecture:** Denormalise `order_type` onto `job_trackers` at creation, then filter `stock_on_hand` out at the single query-layer boundary (`lib/job-tracker-queries.ts`) every customer read funnels through. Confirmation page hides its "Track this order" CTA for stock orders.

**Tech Stack:** Next.js (App Router), TypeScript, Supabase (service-role admin client), vitest.

## Global Constraints

- **P has NO migrations** — the schema change is an S migration in `print-room-staff-portal/db/pending-migrations/`, NOT applied.
- **NULL-safe filter:** `order_type !== 'stock_on_hand'` (legacy/unstamped NULL rows stay visible).
- **Do NOT touch:** Monday webhook, `tracker-status-engine`, `tracker-provisioning`, `sync-job-tracker-items`, the Monday push inside `createJobTrackerShellForOrder`, `getJobTrackersByQuoteId`, `getLatestJobTrackerByQuoteId`, the reorder path.
- **tsc:** diff-against-baseline (P ~14 pre-existing errors). Green = no NEW errors in touched files.
- Run vitest from the P repo root.

---

### Task 1: `JobTracker.order_type` field + `isCustomerVisibleTracker` predicate

**Files:**
- Modify: `lib/job-tracker.ts` (add field to `JobTracker` interface near line 180)
- Modify: `lib/job-tracker-queries.ts` (add exported predicate near top)
- Test: `lib/__tests__/job-tracker-visibility.test.ts` (create)

**Interfaces:**
- Produces: `isCustomerVisibleTracker(t: { order_type?: string | null }): boolean`

- [ ] **Step 1: Write the failing test**

```ts
// lib/__tests__/job-tracker-visibility.test.ts
import { describe, it, expect } from 'vitest'
import { isCustomerVisibleTracker } from '../job-tracker-queries'

describe('isCustomerVisibleTracker', () => {
  it('hides stock_on_hand', () => {
    expect(isCustomerVisibleTracker({ order_type: 'stock_on_hand' })).toBe(false)
  })
  it('shows purchase_order', () => {
    expect(isCustomerVisibleTracker({ order_type: 'purchase_order' })).toBe(true)
  })
  it('shows legacy NULL / missing order_type', () => {
    expect(isCustomerVisibleTracker({ order_type: null })).toBe(true)
    expect(isCustomerVisibleTracker({})).toBe(true)
  })
})
```

- [ ] **Step 2: Run — expect FAIL** (`isCustomerVisibleTracker` not exported)

Run: `npx vitest run lib/__tests__/job-tracker-visibility.test.ts`

- [ ] **Step 3: Add the field to `JobTracker`** in `lib/job-tracker.ts` (alongside `quote_id`/`user_id`, ~line 185):

```ts
  /** Feature #7 — denormalised copy of orders.order_type. NULL = legacy row. */
  order_type?: 'stock_on_hand' | 'purchase_order' | null
```

- [ ] **Step 4: Add the predicate** near the top of `lib/job-tracker-queries.ts` (after imports):

```ts
/** Feature #7 — stock-on-hand orders are hidden from the customer tracker.
 *  NULL/legacy order_type stays visible (safe default). Applies to ALL roles
 *  incl. org_admin. */
export function isCustomerVisibleTracker(t: { order_type?: string | null }): boolean {
  return t.order_type !== 'stock_on_hand'
}
```

- [ ] **Step 5: Run — expect PASS**

Run: `npx vitest run lib/__tests__/job-tracker-visibility.test.ts`

---

### Task 2: Apply the filter in the three customer read functions

**Files:**
- Modify: `lib/job-tracker-queries.ts` — `getJobsForUser`, `getJobsForCustomer`, `getJobsForOrganization`, `getJobTrackerForUserByToken`
- Test: `lib/__tests__/job-tracker-visibility.queries.test.ts` (create)

**Interfaces:**
- Consumes: `isCustomerVisibleTracker` (Task 1); `installClient` pattern from `job-tracker-queries.byToken.test.ts`.

- [ ] **Step 1: Write the failing test** (mirrors the `installClient` harness in `job-tracker-queries.byToken.test.ts`)

```ts
// lib/__tests__/job-tracker-visibility.queries.test.ts
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/product-images', () => ({
  resolveProductFrontImages: vi.fn(async () => ({})),
}))
const fromMock = vi.fn()
vi.mock('@/lib/supabase', () => ({ getSupabaseServer: () => ({ from: fromMock }) }))

import { getJobsForUser, getJobTrackerForUserByToken } from '../job-tracker-queries'

type AnyRow = Record<string, unknown>
function installList(rows: AnyRow[]) {
  fromMock.mockReset()
  fromMock.mockImplementation(() => {
    const builder: AnyRow = {
      select: () => builder,
      eq: () => builder,
      in: () => builder,
      order: () => builder,
      limit: () => builder,
      maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
      then: (r: (v: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(r),
    }
    return builder
  })
}

const stock = { id: 's', user_id: 'u1', order_type: 'stock_on_hand', quote_data: null }
const po = { id: 'p', user_id: 'u1', order_type: 'purchase_order', quote_data: null }

describe('tracker list hides stock_on_hand', () => {
  it('getJobsForUser drops stock rows, keeps PO', async () => {
    installList([stock, po])
    const out = await getJobsForUser('u1')
    expect(out.map((t) => t.id)).toEqual(['p'])
  })
})

describe('token deep-link hides stock_on_hand', () => {
  it('returns null for a stock tracker even for its owner', async () => {
    // single-row token lookup: maybeSingle returns the stock tracker
    fromMock.mockReset()
    fromMock.mockImplementation((table: string) => {
      const builder: AnyRow = {
        select: () => builder,
        eq: () => builder,
        maybeSingle: async () =>
          table === 'job_trackers'
            ? { data: { ...stock, tracker_token: 'tok', customer_email: null }, error: null }
            : { data: null, error: null },
      }
      return builder
    })
    const out = await getJobTrackerForUserByToken('tok', 'u1', null)
    expect(out).toBeNull()
  })
})
```

- [ ] **Step 2: Run — expect FAIL** (stock rows currently returned)

Run: `npx vitest run lib/__tests__/job-tracker-visibility.queries.test.ts`

- [ ] **Step 3: Filter in `getJobsForUser`** — after `const trackers = data as JobTracker[]`, before `fireAndForgetItemsSync`:

```ts
      const trackers = (data as JobTracker[]).filter(isCustomerVisibleTracker)
```

(Apply the same `.filter(isCustomerVisibleTracker)` at the point each function materialises its `JobTracker[]`.)

- [ ] **Step 4: `getJobsForCustomer`** — change `const trackers = (data || []) as JobTracker[]` to:

```ts
    const trackers = ((data || []) as JobTracker[]).filter(isCustomerVisibleTracker)
```

- [ ] **Step 5: `getJobsForOrganization`** — after the dedupe `Array.from(byId.values()).sort(...)`, filter the result before `fireAndForgetItemsSync`:

```ts
    const trackers = Array.from(byId.values())
      .filter(isCustomerVisibleTracker)
      .sort((a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')))
```

- [ ] **Step 6: `getJobTrackerForUserByToken`** — after `if (!tracker) return null`, add:

```ts
    // Feature #7 — a stock-on-hand order is never trackable; treat as not-found
    // (covers milestone-email deep links) BEFORE the authz check.
    if (!isCustomerVisibleTracker(tracker)) return null
```

- [ ] **Step 7: Run — expect PASS**, then the two existing suites still green:

Run: `npx vitest run lib/__tests__/job-tracker-visibility.queries.test.ts lib/__tests__/job-tracker-queries.byToken.test.ts lib/__tests__/job-tracker-org-scope.test.ts`

---

### Task 3: Stamp `order_type` at tracker creation

**Files:**
- Modify: `lib/orders/job-tracker.ts` — `CreateJobTrackerShellArgs` + insert/update `row`
- Modify: `lib/checkout/submit.ts` — pass `orderType` at the 4c call (~line 1515)
- Test: `lib/orders/__tests__/job-tracker.test.ts` (extend) OR the seed test

**Interfaces:**
- Consumes: `orderType: 'stock_on_hand' | 'purchase_order'` (classifyOrderType result, already a const at submit.ts:1269).
- Produces: `CreateJobTrackerShellArgs.orderType`; `job_trackers.order_type` column written.

- [ ] **Step 1: Write the failing test** — assert the inserted row carries `order_type`. Extend the existing insert-capture test in `lib/orders/__tests__/job-tracker.test.ts` (match its existing mock harness; add a case):

```ts
  it('stamps order_type onto the inserted row', async () => {
    // ...arrange the same admin mock the file already uses; capture insert arg...
    // args include orderType: 'stock_on_hand'
    expect(capturedInsertRow.order_type).toBe('stock_on_hand')
  })
```

*(Reuse whatever capture mechanism the file already has for `insert`; if it asserts on a captured row variable, add `order_type` to that assertion instead of a new test.)*

- [ ] **Step 2: Run — expect FAIL**

Run: `npx vitest run lib/orders/__tests__/job-tracker.test.ts`

- [ ] **Step 3: Add to `CreateJobTrackerShellArgs`** (in `lib/orders/job-tracker.ts`):

```ts
  /** Feature #7 — denormalised order classification for tracker visibility. */
  orderType: 'stock_on_hand' | 'purchase_order'
```

- [ ] **Step 4: Add to the `row` object** (alongside `platform`):

```ts
    order_type: args.orderType,
```

- [ ] **Step 5: Pass it at the submit call site** (`lib/checkout/submit.ts` ~line 1515, inside the `createJobTrackerShellForOrder({...})` object — `orderType` is already in scope from line 1269):

```ts
      orderType,
```

- [ ] **Step 6: Run — expect PASS**, and the submit tracker test:

Run: `npx vitest run lib/orders/__tests__/job-tracker.test.ts lib/checkout/__tests__/submit.job-tracker.test.ts`

*(If `submit.job-tracker.test.ts` builds args without `orderType`, add `orderType: 'purchase_order'` to its fixture so tsc + the arg shape stay valid.)*

---

### Task 4: Hide the "Track this order" CTA on stock-order confirmation

**Files:**
- Modify: `app/(portal)/checkout/confirmation/[orderId]/page.tsx` — add `order_type` to the `orders` select + `OrderRow` type; pass prop
- Modify: `app/(portal)/checkout/confirmation/[orderId]/ConfirmationView.tsx` — new prop + conditional CTA
- Test: `app/(portal)/checkout/confirmation/[orderId]/ConfirmationView.stock-cta.test.tsx` (create)

**Interfaces:**
- Produces: `ConfirmationViewProps.isStockOnHandOrder?: boolean`

- [ ] **Step 1: Write the failing test**

```tsx
// ConfirmationView.stock-cta.test.tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ConfirmationView } from './ConfirmationView'

const base = {
  orderId: 'o1', orderRef: 'R1', status: 'in-production',
  awaitingApproval: false, mondaySynced: true, isInventoryOrder: false,
  customerEmail: 'jamie@theprint-room.co.nz', shippingAddress: null,
  fulfilmentLabel: 'Ship to store', requiredBy: null, lines: [],
  subtotalExGst: 10, decorationCost: 0, pickingFee: 0, prepaidGoodsValue: 0,
  gst: 1.5, totalIncGst: 11.5, gstRate: 0.15,
} as const

describe('ConfirmationView track CTA', () => {
  it('shows Track this order for a normal order', () => {
    render(<ConfirmationView {...base} />)
    expect(screen.getByText('Track this order')).toBeTruthy()
  })
  it('hides Track this order for a stock-on-hand order', () => {
    render(<ConfirmationView {...base} isStockOnHandOrder />)
    expect(screen.queryByText('Track this order')).toBeNull()
    expect(screen.getByText('Continue shopping')).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run — expect FAIL**

Run: `npx vitest run "app/(portal)/checkout/confirmation/[orderId]/ConfirmationView.stock-cta.test.tsx"`

- [ ] **Step 3: Add the prop** to `ConfirmationViewProps` (after `isInventoryOrder`):

```ts
  /** Feature #7 — stock-on-hand orders aren't tracked; hide the tracker CTA. */
  isStockOnHandOrder?: boolean
```

- [ ] **Step 4: Guard the CTA** — wrap the `<Link href="/order-tracker">Track this order</Link>` block:

```tsx
              {!props.isStockOnHandOrder && (
                <Link
                  href="/order-tracker"
                  className="flex w-full items-center justify-center rounded-full bg-gray-900 px-6 py-3 text-sm font-medium text-white transition-opacity hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 focus-visible:ring-offset-2"
                >
                  Track this order
                </Link>
              )}
```

(Reference the prop as `props.isStockOnHandOrder` — the component signature is `function ConfirmationView(props: ConfirmationViewProps)`.)

- [ ] **Step 5: Wire the page** — in `page.tsx`: add `order_type` to the `orders` `.select('id, status, total_price, intent, order_type, ...')`; add `order_type: string | null` to the `OrderRow` type; pass to the component:

```tsx
          isStockOnHandOrder={order.order_type === 'stock_on_hand'}
```

- [ ] **Step 6: Run — expect PASS**

Run: `npx vitest run "app/(portal)/checkout/confirmation/[orderId]/ConfirmationView.stock-cta.test.tsx"`

---

### Task 5: S migration (written, NOT applied)

**Files:**
- Create: `print-room-staff-portal/db/pending-migrations/20260727HHMMSS_job_trackers_order_type.sql`

- [ ] **Step 1: Write the migration** (content is the SQL block from the spec §1 — add column, comment, CHECK constraint, backfill from `orders` via `quote_id`).

- [ ] **Step 2: Do NOT apply.** Leave in `db/pending-migrations/`. Note it in the ledger + memory. Verify it is NOT in `supabase/migrations/`.

---

## Full-suite + tsc gate (after all tasks)

- [ ] `npx vitest run` (P) — expect the pre-existing `ProductDetailClient.fulfilment-fallback.test.tsx` failure ONLY (flagged to Jon), everything else green.
- [ ] `npx tsc --noEmit` (P) — no NEW errors vs the ~14 baseline in touched files.

## What I'd commit (ledger for Jon)

**P (print-room-portal):**
- `lib/job-tracker.ts` — `JobTracker.order_type` field
- `lib/job-tracker-queries.ts` — `isCustomerVisibleTracker` predicate + filter in `getJobsForUser`/`getJobsForCustomer`/`getJobsForOrganization`/`getJobTrackerForUserByToken`
- `lib/orders/job-tracker.ts` — `CreateJobTrackerShellArgs.orderType` + `row.order_type`
- `lib/checkout/submit.ts` — pass `orderType` at the 4c call
- `app/(portal)/checkout/confirmation/[orderId]/page.tsx` — select `order_type`, pass `isStockOnHandOrder`
- `app/(portal)/checkout/confirmation/[orderId]/ConfirmationView.tsx` — prop + CTA guard
- new tests: `job-tracker-visibility.test.ts`, `job-tracker-visibility.queries.test.ts`, `ConfirmationView.stock-cta.test.tsx`; extended `job-tracker.test.ts` / `submit.job-tracker.test.ts`
- docs: this plan + the spec

**S (print-room-staff-portal):**
- `db/pending-migrations/20260727HHMMSS_job_trackers_order_type.sql` (NOT applied)

## Go-live steps (for Jon)

1. **Apply the S migration first** (`supabase db push` after moving it into `supabase/migrations/`, or Jon's normal flow) — the tracker INSERT writes `order_type`, so this precedes the P deploy.
2. Deploy P.
3. Smoke: place a fully-stocked order → confirm it is ABSENT from `/order-tracker` (list + token) and the confirmation page shows no "Track this order"; place a PO/mixed order → still tracked.
