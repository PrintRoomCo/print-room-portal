# Org-Admin Order Data View (Sort + Export) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Evolve the Past Orders view in `/my-collections` into an "Orders" view: all order types, sortable table, server-generated CSV export (order-level and line-item), org_admin org-wide / staff own-orders — per `docs/superpowers/specs/2026-07-17-org-admin-order-data-view-design.md`.

**Architecture:** Extract the past-orders scoping query + row mapper into a shared module (`lib/orders/past-orders-query.ts`) consumed by both the list fetcher and a new export route, so list and export can never drift on who sees what. Money figures come exclusively from the existing `billedFigures()` helper. Sort and filters stay client-side (22 orders total in prod); the export is a fresh uncached server route streaming CSV with UTF-8 BOM.

**Tech Stack:** Next.js App Router, Supabase (service-role client — the scoping query IS the security boundary), vitest (+ jsdom/@testing-library for the one component test), TypeScript.

## Global Constraints

- **Read the spec first:** `docs/superpowers/specs/2026-07-17-org-admin-order-data-view-design.md`.
- **Branch:** all work on `feat/org-order-data-view` (created in Task 1). Never commit to `main`.
- **No DB migration, no RLS change, no schema change of any kind.**
- **`npx tsc --noEmit` is NEVER clean in this repo** — 5 pre-existing errors (`next-config-redirects` ×1, `tracker-notification` ×4). "Green" means exactly those 5, not 0. If a cross-branch typecheck reports phantom route errors, `rm -rf .next` first.
- **Money:** all billed/product figures derive from `billedFigures()` (`lib/checkout/billed-figures.ts`). Never reimplement the NULL-`billed_total` fallback.
- **Security:** queries run on the service-role client (RLS bypassed). Org id must come from the session-derived membership row — never from request params. Staff with no auth email fail CLOSED (empty result).
- **Copy:** page heading is exactly `Orders` (was `Past orders`). CSV headers exactly as specified in Task 4.
- Test runner: `npx vitest run <file>` for single files, `npm test` for the suite.

---

### Task 1: Shared scoping query + row mapper (`past-orders-query.ts`)

**Files:**
- Create: `lib/orders/past-orders-query.ts`
- Test: `lib/orders/__tests__/past-orders-query.test.ts`

**Interfaces:**
- Consumes: `billedFigures({goodsExGst, billedTotal, pickingFee})` from `@/lib/checkout/billed-figures`; `SupabaseClient` type from `@supabase/supabase-js`.
- Produces (later tasks import all of these from `@/lib/orders/past-orders-query`):
  - `interface PortalPastOrder { orderId: string; quoteId: string | null; orderRef: string | null; quoteNumber: string | null; reference: string | null; status: string; orderType: string; customerName: string | null; customerEmail: string | null; customerCompany: string | null; subtotal: number; totalAmount: number; currency: string; pickingFee: number; billed: number; createdAt: string; tracking: PastOrderTracking | null }`
  - `interface PastOrderTracking { carrier: string | null; trackingNumber: string | null; url: string | null }`
  - `interface PastOrderRow` (raw Supabase row, see code)
  - `interface PastOrdersScope { organizationId: string; canSeeAllOrgOrders: boolean; userEmail: string | null }`
  - `queryPastOrders(adminClient: SupabaseClient, scope: PastOrdersScope): Promise<PastOrderRow[]>`
  - `mapPastOrderRow(row: PastOrderRow): PortalPastOrder`

- [ ] **Step 1: Create the branch**

```bash
git checkout main && git pull && git checkout -b feat/org-order-data-view
```

- [ ] **Step 2: Write the failing tests**

Create `lib/orders/__tests__/past-orders-query.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { mapPastOrderRow, queryPastOrders, type PastOrderRow } from '@/lib/orders/past-orders-query'

function row(overrides: Partial<PastOrderRow['quotes'] & { id: string; status: string; order_type: string }> = {}): PastOrderRow {
  return {
    id: overrides.id ?? 'order-1',
    status: overrides.status ?? 'shipped',
    order_type: overrides.order_type ?? 'purchase_order',
    created_at: '2026-07-10T00:00:00.000Z',
    quote_id: 'quote-1',
    quotes: {
      organization_id: 'org-1',
      order_ref: 'ANFI-000083',
      quote_number: 'Q-1',
      reference: null,
      customer_name: 'Buyer',
      customer_email: 'buyer@example.com',
      customer_company: 'PRT',
      customer_code: 'ANFI',
      subtotal: 100,
      total_amount: 115,
      currency: 'NZD',
      picking_fee: null,
      billed_total: null,
      ...overrides,
    },
  }
}

describe('mapPastOrderRow', () => {
  it('falls back billed to the goods value when billed_total is NULL (pre-parity order)', () => {
    const mapped = mapPastOrderRow(row())
    expect(mapped.subtotal).toBe(100)
    expect(mapped.billed).toBe(100)
    expect(mapped.pickingFee).toBe(0)
    expect(mapped.orderType).toBe('purchase_order')
  })

  it('uses the stored billed_total when present (prepaid: $0 goods + picking fee)', () => {
    const mapped = mapPastOrderRow(row({ picking_fee: 17.25, billed_total: 17.25 }))
    expect(mapped.subtotal).toBe(100)
    expect(mapped.billed).toBe(17.25)
    expect(mapped.pickingFee).toBe(17.25)
  })

  it('carries identity fields through', () => {
    const mapped = mapPastOrderRow(row())
    expect(mapped).toMatchObject({
      orderId: 'order-1',
      quoteId: 'quote-1',
      orderRef: 'ANFI-000083',
      customerEmail: 'buyer@example.com',
      currency: 'NZD',
      tracking: null,
    })
  })
})

function mockClient(recordEq: (col: string, val: unknown) => void) {
  const b: Record<string, unknown> = {
    select: vi.fn(() => b),
    eq: vi.fn((col: string, val: unknown) => {
      recordEq(col, val)
      return b
    }),
    order: vi.fn(async () => ({ data: [row()], error: null })),
  }
  return { from: vi.fn(() => b) }
}

describe('queryPastOrders scoping', () => {
  it('org_admin: scopes to the org only — no email filter', async () => {
    const eqCalls: unknown[][] = []
    const client = mockClient((c, v) => eqCalls.push([c, v]))
    const rows = await queryPastOrders(client as never, {
      organizationId: 'org-1',
      canSeeAllOrgOrders: true,
      userEmail: 'admin@x.co',
    })
    expect(eqCalls).toContainEqual(['quotes.organization_id', 'org-1'])
    expect(eqCalls).not.toContainEqual(['quotes.customer_email', 'admin@x.co'])
    expect(rows).toHaveLength(1)
  })

  it('staff: adds the customer_email filter on top of the org filter', async () => {
    const eqCalls: unknown[][] = []
    const client = mockClient((c, v) => eqCalls.push([c, v]))
    await queryPastOrders(client as never, {
      organizationId: 'org-1',
      canSeeAllOrgOrders: false,
      userEmail: 'staff@x.co',
    })
    expect(eqCalls).toContainEqual(['quotes.organization_id', 'org-1'])
    expect(eqCalls).toContainEqual(['quotes.customer_email', 'staff@x.co'])
  })

  it('staff with no auth email fails CLOSED: empty result, no query issued', async () => {
    const client = mockClient(() => {})
    const rows = await queryPastOrders(client as never, {
      organizationId: 'org-1',
      canSeeAllOrgOrders: false,
      userEmail: null,
    })
    expect(rows).toEqual([])
    expect(client.from).not.toHaveBeenCalled()
  })

  it('returns [] on a query error', async () => {
    const b: Record<string, unknown> = {
      select: vi.fn(() => b),
      eq: vi.fn(() => b),
      order: vi.fn(async () => ({ data: null, error: { message: 'boom' } })),
    }
    const client = { from: vi.fn(() => b) }
    const rows = await queryPastOrders(client as never, {
      organizationId: 'org-1',
      canSeeAllOrgOrders: true,
      userEmail: null,
    })
    expect(rows).toEqual([])
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run lib/orders/__tests__/past-orders-query.test.ts`
Expected: FAIL — `Cannot find module '@/lib/orders/past-orders-query'`

- [ ] **Step 4: Write the implementation**

Create `lib/orders/past-orders-query.ts`:

```ts
import type { SupabaseClient } from '@supabase/supabase-js'
import { billedFigures } from '@/lib/checkout/billed-figures'

export interface PastOrderTracking {
  carrier: string | null
  trackingNumber: string | null
  url: string | null
}

export interface PortalPastOrder {
  orderId: string
  quoteId: string | null
  orderRef: string | null
  quoteNumber: string | null
  reference: string | null
  status: string
  orderType: string
  customerName: string | null
  customerEmail: string | null
  customerCompany: string | null
  /** Ex-GST full GOODS value (quotes.subtotal) — "Product value" in the UI. */
  subtotal: number
  totalAmount: number
  currency: string
  pickingFee: number
  /** Ex-GST total invoiced, billedFigures().billedExGst (NULL billed_total ⇒ goods value). */
  billed: number
  createdAt: string
  tracking: PastOrderTracking | null
}

export interface PastOrderRow {
  id: string
  status: string | null
  order_type: string | null
  created_at: string | null
  quote_id: string | null
  quotes: {
    organization_id: string | null
    order_ref: string | null
    quote_number: string | null
    reference: string | null
    customer_name: string | null
    customer_email: string | null
    customer_company: string | null
    customer_code: string | null
    subtotal: number | null
    total_amount: number | null
    currency: string | null
    picking_fee: number | null
    billed_total: number | null
  } | null
}

export const PAST_ORDERS_SELECT = `id, status, order_type, created_at, quote_id,
   quotes!inner (
     organization_id, order_ref, quote_number, reference,
     customer_name, customer_email, customer_company, customer_code,
     subtotal, total_amount, currency, picking_fee, billed_total
   )`

export interface PastOrdersScope {
  organizationId: string
  /** true for org_admin (org-wide); false for staff (own orders only). */
  canSeeAllOrgOrders: boolean
  /** The requester's auth email — staff scoping keys on quotes.customer_email. */
  userEmail: string | null
}

/**
 * The ONE org/role scoping rule for the orders view — shared by the list
 * fetcher and the CSV export route so the two can never drift on who sees
 * what. Runs on the service-role client (RLS bypassed): this function IS the
 * security boundary.
 *
 * Staff scoping keys on quotes.customer_email, not quotes.created_by:
 * created_by is NULL on every ordered quote (checkout never stamps it). Email
 * is safe here because organization_id is constrained first — the Phase 1
 * prohibition on email is about cross-org tenancy, not own-orders scoping.
 * Staff with no auth email fail CLOSED.
 */
export async function queryPastOrders(
  adminClient: SupabaseClient,
  scope: PastOrdersScope,
): Promise<PastOrderRow[]> {
  if (!scope.canSeeAllOrgOrders && !scope.userEmail) return []

  let query = adminClient
    .from('orders')
    .select(PAST_ORDERS_SELECT)
    .eq('quotes.organization_id', scope.organizationId)

  if (!scope.canSeeAllOrgOrders) {
    query = query.eq('quotes.customer_email', scope.userEmail)
  }

  const { data, error } = await query.order('created_at', { ascending: false })
  if (error) {
    console.error('[PastOrders] query failed:', error)
    return []
  }
  return (data ?? []) as unknown as PastOrderRow[]
}

export function mapPastOrderRow(row: PastOrderRow): PortalPastOrder {
  const figures = billedFigures({
    goodsExGst: Number(row.quotes?.subtotal ?? 0),
    billedTotal: row.quotes?.billed_total,
    pickingFee: row.quotes?.picking_fee,
  })
  return {
    orderId: row.id,
    quoteId: row.quote_id,
    orderRef: row.quotes?.order_ref ?? null,
    quoteNumber: row.quotes?.quote_number ?? null,
    reference: row.quotes?.reference ?? null,
    status: row.status ?? 'awaiting-approval',
    orderType: row.order_type ?? 'purchase_order',
    customerName: row.quotes?.customer_name ?? null,
    customerEmail: row.quotes?.customer_email ?? null,
    customerCompany: row.quotes?.customer_company ?? null,
    subtotal: Number(row.quotes?.subtotal ?? 0),
    totalAmount: Number(row.quotes?.total_amount ?? 0),
    currency: row.quotes?.currency ?? 'NZD',
    pickingFee: figures.pickingFee,
    billed: figures.billedExGst,
    createdAt: row.created_at ?? new Date().toISOString(),
    tracking: null,
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run lib/orders/__tests__/past-orders-query.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 6: Commit**

```bash
git add lib/orders/past-orders-query.ts lib/orders/__tests__/past-orders-query.test.ts
git commit -m "feat: shared past-orders scoping query + billedFigures row mapper"
```

---

### Task 2: Rewire the list fetcher — all order types, email scoping

**Files:**
- Modify: `lib/portal-data.ts` (the `PortalPastOrder`/`PastOrderTracking`/`PastOrderRow`/`mapPastOrderRow` definitions at lines ~52-99 and ~338-355, and `fetchPastOrdersForUser` at ~392-458)
- Modify: `app/(portal)/my-collections/__tests__/past-orders.scope.test.ts`
- Modify: `app/(portal)/my-collections/__tests__/past-orders.data.test.ts`

**Interfaces:**
- Consumes: `queryPastOrders`, `mapPastOrderRow`, types from Task 1.
- Produces: `getPortalPastOrdersData(): Promise<PortalPastOrdersData>` unchanged in name/shape, but `PortalPastOrdersData.orders: PortalPastOrder[]` now uses the Task 1 `PortalPastOrder` (adds `orderType`, `pickingFee`, `billed`) and contains BOTH order types. `lib/portal-data.ts` re-exports `type { PortalPastOrder, PastOrderTracking }` so every existing `import ... from '@/lib/portal-data'` keeps compiling.

- [ ] **Step 1: Update the scope test to the new rules (RED)**

In `app/(portal)/my-collections/__tests__/past-orders.scope.test.ts`, replace the `describe` block (keep all mocks/builders as they are — the mocked auth user is `{ id: 'user-1', email: 'b@x.co' }`):

```ts
describe('Orders view role scope', () => {
  it('staff: scopes to own orders via quotes.customer_email (created_by is NULL on all ordered quotes)', async () => {
    const calls = await run('staff')
    expect(calls).toContainEqual(['quotes.organization_id', 'org-1'])
    expect(calls).toContainEqual(['quotes.customer_email', 'b@x.co'])
    expect(calls).not.toContainEqual(['quotes.created_by', 'user-1'])
  })
  it('org_admin: org-wide — no email or created_by filter', async () => {
    const calls = await run('org_admin')
    expect(calls).toContainEqual(['quotes.organization_id', 'org-1'])
    expect(calls).not.toContainEqual(['quotes.customer_email', 'b@x.co'])
    expect(calls).not.toContainEqual(['quotes.created_by', 'user-1'])
  })
  it('includes every order type: no order_type filter', async () => {
    const calls = await run('org_admin')
    expect(calls.map((c) => c[0])).not.toContain('order_type')
  })
})
```

- [ ] **Step 2: Update the data test to assert the new fields (RED)**

In `app/(portal)/my-collections/__tests__/past-orders.data.test.ts`:
- In the `orders` fixture row, add `order_type: 'purchase_order'` as a sibling of `status`, and inside `quotes` add `customer_code: 'PRT'`, `picking_fee: null`, `billed_total: null` (leave `created_by` — it is simply no longer read).
- Extend the final assertion's `objectContaining` with the new mapped fields:

```ts
    expect(data.orders).toEqual([
      expect.objectContaining({
        orderId: 'order-1',
        orderRef: 'PR-1001',
        status: 'shipped',
        orderType: 'purchase_order',
        subtotal: 100,
        billed: 100, // billed_total NULL ⇒ falls back to goods value
        pickingFee: 0,
        totalAmount: 115,
        currency: 'NZD',
        tracking: { carrier: 'NZ Post', trackingNumber: '1234567890', url: 'https://track/1234567890' },
      }),
    ])
```

- [ ] **Step 3: Run both tests to verify they fail**

Run: `npx vitest run "app/(portal)/my-collections/__tests__"`
Expected: FAIL — staff test still sees `['order_type', 'stock_on_hand']` + `['quotes.created_by', 'user-1']`; data test misses `orderType`/`billed`.

- [ ] **Step 4: Rewire `lib/portal-data.ts`**

4a. Imports — add to the import block at the top:

```ts
import {
  mapPastOrderRow,
  queryPastOrders,
  type PortalPastOrder,
  type PastOrderTracking,
} from '@/lib/orders/past-orders-query'

export type { PortalPastOrder, PastOrderTracking } from '@/lib/orders/past-orders-query'
```

4b. Delete the local `export interface PastOrderTracking {...}` (lines ~52-56), `export interface PortalPastOrder {...}` (~58-73), `interface PastOrderRow {...}` (~81-99), and the local `function mapPastOrderRow(...)` (~338-355). `PortalPastOrdersData` and `overlayTrackingInfo` stay — they now use the imported types.

4c. Replace the body of `fetchPastOrdersForUser` (currently `void email` + the stores read + the inline `orderQuery` block) with:

```ts
const fetchPastOrdersForUser = unstable_cache(
  async (userId: string, email: string | null): Promise<PortalPastOrdersData> => {
    const adminClient = getSupabaseServer()
    const { data: membership } = await adminClient
      .from('user_organizations')
      .select('organization_id, role')
      .eq('user_id', userId)
      .maybeSingle()

    let orders: PortalPastOrder[] = []
    let stores: PortalAccountStore[] = []

    if (membership?.organization_id) {
      const { data: storesData } = await adminClient
        .from('stores')
        .select('id, name, address, location, city, state, country, postal_code, phone')
        .eq('organization_id', membership.organization_id)
        .order('created_at', { ascending: true })
      stores = (storesData || []) as PortalAccountStore[]

      // Orders view = every placed order for the org, both order types,
      // including awaiting-period-close pre-orders. Scoping (org_admin
      // org-wide, staff own-by-email) lives in queryPastOrders — shared with
      // the CSV export route so the two can never drift.
      const rows = await queryPastOrders(adminClient, {
        organizationId: membership.organization_id,
        canSeeAllOrgOrders: membership.role === 'org_admin',
        userEmail: email,
      })

      orders = await overlayTrackingInfo(adminClient, rows.map(mapPastOrderRow))
    }

    return {
      orders,
      stores,
      ownerKey: membership?.organization_id
        ? `org:${membership.organization_id}`
        : `user:${userId}`,
    }
  },
  ['portal-past-orders-data'],
  {
    tags: [cacheTags.accountData],
    revalidate: cacheRevalidate.accountData,
  },
)
```

- [ ] **Step 5: Run the full my-collections + lib/orders tests**

Run: `npx vitest run "app/(portal)/my-collections/__tests__" lib/orders`
Expected: PASS

- [ ] **Step 6: Typecheck (baseline = 5 errors)**

Run: `npx tsc --noEmit 2>&1 | tail -8`
Expected: exactly the 5 pre-existing errors (`next-config-redirects` ×1, `tracker-notification` ×4). Anything new in `portal-data`, `my-collections`, or `lib/orders` must be fixed before committing.

- [ ] **Step 7: Commit**

```bash
git add lib/portal-data.ts "app/(portal)/my-collections/__tests__"
git commit -m "feat: orders view covers all order types; fix dead staff scoping via customer_email"
```

---

### Task 3: `sortPastOrders` helper

**Files:**
- Modify: `lib/orders/past-orders-filter.ts` (append; `filterPastOrders`/`withinDateRange` unchanged)
- Test: `lib/orders/__tests__/past-orders-sort.test.ts`

**Interfaces:**
- Consumes: `PortalPastOrder` from `@/lib/portal-data` (the file already imports it).
- Produces:
  - `type PastOrderSortKey = 'createdAt' | 'orderRef' | 'placedBy' | 'orderType' | 'status' | 'productValue' | 'billed'`
  - `interface PastOrderSort { key: PastOrderSortKey; dir: 'asc' | 'desc' }`
  - `sortPastOrders(orders: PortalPastOrder[], sort: PastOrderSort): PortalPastOrder[]` — non-mutating, stable.

- [ ] **Step 1: Write the failing tests**

Create `lib/orders/__tests__/past-orders-sort.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { sortPastOrders } from '@/lib/orders/past-orders-filter'
import type { PortalPastOrder } from '@/lib/portal-data'

function order(overrides: Partial<PortalPastOrder>): PortalPastOrder {
  return {
    orderId: 'o',
    quoteId: 'q',
    orderRef: null,
    quoteNumber: null,
    reference: null,
    status: 'shipped',
    orderType: 'purchase_order',
    customerName: null,
    customerEmail: null,
    customerCompany: null,
    subtotal: 0,
    totalAmount: 0,
    currency: 'NZD',
    pickingFee: 0,
    billed: 0,
    createdAt: '2026-07-01T00:00:00.000Z',
    tracking: null,
    ...overrides,
  }
}

describe('sortPastOrders', () => {
  const a = order({ orderId: 'a', billed: 50, createdAt: '2026-07-03T00:00:00.000Z', customerEmail: 'zoe@x.co' })
  const b = order({ orderId: 'b', billed: 200, createdAt: '2026-07-01T00:00:00.000Z', customerEmail: 'amy@x.co' })
  const c = order({ orderId: 'c', billed: 100, createdAt: '2026-07-02T00:00:00.000Z', customerEmail: null })

  it('sorts numerically by billed, both directions', () => {
    expect(sortPastOrders([a, b, c], { key: 'billed', dir: 'asc' }).map((o) => o.orderId)).toEqual(['a', 'c', 'b'])
    expect(sortPastOrders([a, b, c], { key: 'billed', dir: 'desc' }).map((o) => o.orderId)).toEqual(['b', 'c', 'a'])
  })

  it('sorts by createdAt desc (the default view order)', () => {
    expect(sortPastOrders([b, c, a], { key: 'createdAt', dir: 'desc' }).map((o) => o.orderId)).toEqual(['a', 'c', 'b'])
  })

  it('placedBy sorts null emails first ascending (empty string) and does not throw', () => {
    expect(sortPastOrders([a, b, c], { key: 'placedBy', dir: 'asc' }).map((o) => o.orderId)).toEqual(['c', 'b', 'a'])
  })

  it('orderRef falls back reference → quoteNumber when orderRef is null', () => {
    const x = order({ orderId: 'x', orderRef: 'B-2' })
    const y = order({ orderId: 'y', orderRef: null, reference: 'A-1' })
    expect(sortPastOrders([x, y], { key: 'orderRef', dir: 'asc' }).map((o) => o.orderId)).toEqual(['y', 'x'])
  })

  it('is stable on ties and does not mutate the input', () => {
    const input = [a, b, c].map((o) => order({ ...o, billed: 7 }))
    const out = sortPastOrders(input, { key: 'billed', dir: 'asc' })
    expect(out.map((o) => o.orderId)).toEqual(['a', 'b', 'c'])
    expect(out).not.toBe(input)
    expect(input.map((o) => o.orderId)).toEqual(['a', 'b', 'c'])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/orders/__tests__/past-orders-sort.test.ts`
Expected: FAIL — `sortPastOrders` is not exported.

- [ ] **Step 3: Append the implementation to `lib/orders/past-orders-filter.ts`**

```ts
export type PastOrderSortKey =
  | 'createdAt'
  | 'orderRef'
  | 'placedBy'
  | 'orderType'
  | 'status'
  | 'productValue'
  | 'billed'

export interface PastOrderSort {
  key: PastOrderSortKey
  dir: 'asc' | 'desc'
}

const SORT_VALUE: Record<PastOrderSortKey, (o: PortalPastOrder) => string | number> = {
  createdAt: (o) => o.createdAt,
  orderRef: (o) => o.orderRef ?? o.reference ?? o.quoteNumber ?? '',
  placedBy: (o) => o.customerEmail ?? '',
  orderType: (o) => o.orderType,
  status: (o) => o.status,
  productValue: (o) => o.subtotal,
  billed: (o) => o.billed,
}

/** Non-mutating; Array.prototype.sort is stable, so ties keep fetch order. */
export function sortPastOrders(orders: PortalPastOrder[], sort: PastOrderSort): PortalPastOrder[] {
  const value = SORT_VALUE[sort.key]
  const sign = sort.dir === 'asc' ? 1 : -1
  return [...orders].sort((x, y) => {
    const vx = value(x)
    const vy = value(y)
    if (vx === vy) return 0
    if (typeof vx === 'number' && typeof vy === 'number') return (vx - vy) * sign
    return String(vx).localeCompare(String(vy)) * sign
  })
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/orders/__tests__/past-orders-sort.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/orders/past-orders-filter.ts lib/orders/__tests__/past-orders-sort.test.ts
git commit -m "feat: sortPastOrders helper for the orders table"
```

---

### Task 4: CSV builders

**Files:**
- Create: `lib/orders/past-orders-csv.ts`
- Test: `lib/orders/__tests__/past-orders-csv.test.ts`

**Interfaces:**
- Consumes: `PortalPastOrder` from `@/lib/orders/past-orders-query`.
- Produces:
  - `interface PastOrderLineItem { quote_id: string | null; product_name: string | null; size_label: string | null; quantity: number | null; unit_price: number | null; total_price: number | null; qty_from_stock: number | null; qty_to_make: number | null; ship_to_store_id: string | null }`
  - `buildOrdersCsv(orders: PortalPastOrder[]): string`
  - `buildLineItemsCsv(orders: PortalPastOrder[], itemsByQuoteId: Map<string, PastOrderLineItem[]>, storeNameById: Map<string, string>): string`
  - Both return BOM (`\ufeff`)-prefixed, CRLF-terminated CSV text.

- [ ] **Step 1: Write the failing tests**

Create `lib/orders/__tests__/past-orders-csv.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { buildLineItemsCsv, buildOrdersCsv, type PastOrderLineItem } from '@/lib/orders/past-orders-csv'
import type { PortalPastOrder } from '@/lib/orders/past-orders-query'

function order(overrides: Partial<PortalPastOrder>): PortalPastOrder {
  return {
    orderId: 'ord-aaaa',
    quoteId: 'quote-1',
    orderRef: 'ANFI-000083',
    quoteNumber: 'Q-1',
    reference: null,
    status: 'shipped',
    orderType: 'purchase_order',
    customerName: 'Buyer',
    customerEmail: 'buyer@example.com',
    customerCompany: 'Anytime Fitness',
    subtotal: 100,
    totalAmount: 115,
    currency: 'NZD',
    pickingFee: 0,
    billed: 100,
    createdAt: '2026-07-10T03:04:05.000Z',
    tracking: null,
    ...overrides,
  }
}

const ORDER_HEADER =
  'order_ref,placed_at,placed_by,order_type,status,product_value_ex_gst,picking_fee,billed_ex_gst,currency'

describe('buildOrdersCsv', () => {
  it('emits BOM + CRLF + header + one row per order', () => {
    const csv = buildOrdersCsv([order({})])
    expect(csv.startsWith('\ufeff')).toBe(true)
    expect(csv).toContain('\r\n')
    const lines = csv.replace('\ufeff', '').trimEnd().split('\r\n')
    expect(lines[0]).toBe(ORDER_HEADER)
    expect(lines[1]).toBe('ANFI-000083,2026-07-10,buyer@example.com,purchase_order,shipped,100,0,100,NZD')
    expect(lines).toHaveLength(2)
  })

  it('falls back order_ref → reference → quoteNumber, and escapes commas/quotes', () => {
    const csv = buildOrdersCsv([
      order({ orderRef: null, reference: null, quoteNumber: 'Q "big", one' }),
    ])
    const lines = csv.replace('\ufeff', '').trimEnd().split('\r\n')
    expect(lines[1].startsWith('"Q ""big"", one",')).toBe(true)
  })
})

describe('buildLineItemsCsv', () => {
  const items = new Map<string, PastOrderLineItem[]>([
    [
      'quote-1',
      [
        {
          quote_id: 'quote-1',
          product_name: 'Staple Tee',
          size_label: 'M',
          quantity: 10,
          unit_price: 10,
          total_price: 100,
          qty_from_stock: 10,
          qty_to_make: 0,
          ship_to_store_id: 'store-1',
        },
      ],
    ],
  ])
  const storeNames = new Map([['store-1', 'Invercargill']])

  it('emits one row per line item with order fields repeated and store name resolved', () => {
    const csv = buildLineItemsCsv([order({})], items, storeNames)
    const lines = csv.replace('\ufeff', '').trimEnd().split('\r\n')
    expect(lines[0]).toBe(
      `${ORDER_HEADER},product_name,size_label,quantity,unit_price,line_total,qty_from_stock,qty_to_make,ship_to_store`,
    )
    expect(lines[1]).toBe(
      'ANFI-000083,2026-07-10,buyer@example.com,purchase_order,shipped,100,0,100,NZD,Staple Tee,M,10,10,100,10,0,Invercargill',
    )
  })

  it('an order with no line items still gets one row (never silently dropped)', () => {
    const csv = buildLineItemsCsv([order({ quoteId: 'quote-none' })], items, storeNames)
    const lines = csv.replace('\ufeff', '').trimEnd().split('\r\n')
    expect(lines).toHaveLength(2)
    expect(lines[1].startsWith('ANFI-000083,')).toBe(true)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/orders/__tests__/past-orders-csv.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `lib/orders/past-orders-csv.ts`:

```ts
import type { PortalPastOrder } from '@/lib/orders/past-orders-query'

/** quote_items columns the line-item export reads (subset). */
export interface PastOrderLineItem {
  quote_id: string | null
  product_name: string | null
  size_label: string | null
  quantity: number | null
  unit_price: number | null
  total_price: number | null
  qty_from_stock: number | null
  qty_to_make: number | null
  ship_to_store_id: string | null
}

type Cell = string | number | null | undefined

// Excel needs the BOM to detect UTF-8 on double-click; CRLF per RFC 4180.
const BOM = '\ufeff'

function csvField(value: Cell): string {
  if (value == null) return ''
  const s = String(value)
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function toCsv(rows: Cell[][]): string {
  return BOM + rows.map((row) => row.map(csvField).join(',')).join('\r\n') + '\r\n'
}

const ORDER_HEADER: Cell[] = [
  'order_ref',
  'placed_at',
  'placed_by',
  'order_type',
  'status',
  'product_value_ex_gst',
  'picking_fee',
  'billed_ex_gst',
  'currency',
]

function orderCells(o: PortalPastOrder): Cell[] {
  return [
    o.orderRef ?? o.reference ?? o.quoteNumber ?? o.orderId,
    o.createdAt.slice(0, 10),
    o.customerEmail ?? '',
    o.orderType,
    o.status,
    o.subtotal,
    o.pickingFee,
    o.billed,
    o.currency,
  ]
}

export function buildOrdersCsv(orders: PortalPastOrder[]): string {
  return toCsv([ORDER_HEADER, ...orders.map(orderCells)])
}

const LINE_HEADER: Cell[] = [
  ...ORDER_HEADER,
  'product_name',
  'size_label',
  'quantity',
  'unit_price',
  'line_total',
  'qty_from_stock',
  'qty_to_make',
  'ship_to_store',
]

export function buildLineItemsCsv(
  orders: PortalPastOrder[],
  itemsByQuoteId: Map<string, PastOrderLineItem[]>,
  storeNameById: Map<string, string>,
): string {
  const rows: Cell[][] = [LINE_HEADER]
  for (const order of orders) {
    const items = (order.quoteId && itemsByQuoteId.get(order.quoteId)) || []
    if (items.length === 0) {
      // An order with no quote_items must still appear — an export that
      // silently drops orders reads as "covered everything" when it didn't.
      rows.push([...orderCells(order), '', '', '', '', '', '', '', ''])
      continue
    }
    for (const item of items) {
      rows.push([
        ...orderCells(order),
        item.product_name,
        item.size_label,
        item.quantity,
        item.unit_price,
        item.total_price,
        item.qty_from_stock,
        item.qty_to_make,
        item.ship_to_store_id
          ? (storeNameById.get(item.ship_to_store_id) ?? item.ship_to_store_id)
          : '',
      ])
    }
  }
  return toCsv(rows)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/orders/__tests__/past-orders-csv.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/orders/past-orders-csv.ts lib/orders/__tests__/past-orders-csv.test.ts
git commit -m "feat: order-level and line-item CSV builders (BOM, CRLF, RFC 4180 escaping)"
```

---

### Task 5: Export route `GET /api/past-orders/export`

**Files:**
- Create: `app/api/past-orders/export/route.ts`
- Test: `app/api/past-orders/export/__tests__/route.test.ts`

**Interfaces:**
- Consumes: `getPortalUser` from `@/lib/portal-data`; `getSupabaseServer` from `@/lib/supabase`; `queryPastOrders`/`mapPastOrderRow` (Task 1); `filterPastOrders` (existing); `buildOrdersCsv`/`buildLineItemsCsv`/`PastOrderLineItem` (Task 4).
- Produces: `GET /api/past-orders/export?granularity=order|line[&status=...&from=yyyy-mm-dd&to=yyyy-mm-dd]` → `text/csv` attachment. 400 bad granularity, 401 unauthenticated, 403 no org membership. **Org id comes only from the session-derived membership row.** Round trips ≤ 4 (membership, orders, quote_items, stores).

- [ ] **Step 1: Write the failing tests**

Create `app/api/past-orders/export/__tests__/route.test.ts` (same mocking pattern as `past-orders.scope.test.ts`):

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  admin: { from: vi.fn() },
  authUser: { id: 'user-1', email: 'admin@x.co' } as { id: string; email: string } | null,
}))

vi.mock('@/lib/supabase-server-component', () => ({
  getSupabaseServerComponent: vi.fn(async () => ({
    auth: { getUser: vi.fn(async () => ({ data: { user: mocks.authUser } })) },
  })),
}))
vi.mock('@/lib/supabase', () => ({ getSupabaseServer: () => mocks.admin }))
vi.mock('next/cache', () => ({ unstable_cache: (fn: unknown) => fn }))

const orderRow = {
  id: 'order-1',
  status: 'shipped',
  order_type: 'purchase_order',
  created_at: '2026-07-10T00:00:00.000Z',
  quote_id: 'quote-1',
  quotes: {
    organization_id: 'org-1',
    order_ref: 'ANFI-000083',
    quote_number: 'Q-1',
    reference: null,
    customer_name: 'Buyer',
    customer_email: 'buyer@example.com',
    customer_company: 'AF',
    customer_code: 'ANFI',
    subtotal: 100,
    total_amount: 115,
    currency: 'NZD',
    picking_fee: null,
    billed_total: null,
  },
}

function membershipBuilder(role: string | null) {
  const b: Record<string, unknown> = {
    select: vi.fn(() => b),
    eq: vi.fn(() => b),
    maybeSingle: vi.fn(async () =>
      role ? { data: { organization_id: 'org-1', role }, error: null } : { data: null, error: null },
    ),
  }
  return b
}
const eqCalls: unknown[][] = []
function ordersBuilder() {
  const b: Record<string, unknown> = {
    select: vi.fn(() => b),
    eq: vi.fn((col: string, val: unknown) => {
      eqCalls.push([col, val])
      return b
    }),
    order: vi.fn(async () => ({ data: [orderRow], error: null })),
  }
  return b
}
function itemsBuilder() {
  const b: Record<string, unknown> = {
    select: vi.fn(() => b),
    in: vi.fn(async () => ({
      data: [
        {
          quote_id: 'quote-1',
          product_name: 'Staple Tee',
          size_label: 'M',
          quantity: 10,
          unit_price: 10,
          total_price: 100,
          qty_from_stock: 0,
          qty_to_make: 10,
          ship_to_store_id: 'store-1',
        },
      ],
      error: null,
    })),
  }
  return b
}
function storesBuilder() {
  const b: Record<string, unknown> = {
    select: vi.fn(() => b),
    eq: vi.fn(async () => ({ data: [{ id: 'store-1', name: 'Invercargill' }], error: null })),
  }
  return b
}

function setup(role: string | null) {
  eqCalls.length = 0
  mocks.admin.from.mockImplementation((table: string) => {
    if (table === 'user_organizations') return membershipBuilder(role)
    if (table === 'orders') return ordersBuilder()
    if (table === 'quote_items') return itemsBuilder()
    if (table === 'stores') return storesBuilder()
    throw new Error(`unexpected table ${table}`)
  })
}

async function get(query: string) {
  vi.resetModules()
  const { GET } = await import('@/app/api/past-orders/export/route')
  return GET(new Request(`http://localhost/api/past-orders/export${query}`))
}

describe('GET /api/past-orders/export', () => {
  beforeEach(() => {
    mocks.authUser = { id: 'user-1', email: 'admin@x.co' }
    setup('org_admin')
  })

  it('400 when granularity is missing or invalid', async () => {
    expect((await get('')).status).toBe(400)
    expect((await get('?granularity=weird')).status).toBe(400)
  })

  it('401 when unauthenticated', async () => {
    mocks.authUser = null
    expect((await get('?granularity=order')).status).toBe(401)
  })

  it('403 when the user has no organisation membership', async () => {
    setup(null)
    expect((await get('?granularity=order')).status).toBe(403)
  })

  it('org_admin order CSV: BOM, attachment headers, org-code filename, data row', async () => {
    const res = await get('?granularity=order')
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toContain('text/csv')
    expect(res.headers.get('Content-Disposition')).toMatch(/attachment; filename="orders-ANFI-\d{4}-\d{2}-\d{2}\.csv"/)
    const body = await res.text()
    expect(body.startsWith('\ufeff')).toBe(true)
    expect(body).toContain('ANFI-000083,2026-07-10,buyer@example.com,purchase_order,shipped,100,0,100,NZD')
    expect(eqCalls).toContainEqual(['quotes.organization_id', 'org-1'])
    expect(eqCalls).not.toContainEqual(['quotes.customer_email', 'admin@x.co'])
  })

  it('staff export is scoped to their own email', async () => {
    setup('staff')
    await get('?granularity=order')
    expect(eqCalls).toContainEqual(['quotes.customer_email', 'admin@x.co'])
  })

  it('granularity=line emits one row per quote_item with order fields repeated', async () => {
    const res = await get('?granularity=line')
    const body = await res.text()
    expect(body).toContain(
      'ANFI-000083,2026-07-10,buyer@example.com,purchase_order,shipped,100,0,100,NZD,Staple Tee,M,10,10,100,0,10,Invercargill',
    )
  })

  it('status filter narrows the exported set', async () => {
    const res = await get('?granularity=order&status=cancelled')
    const body = await res.text()
    expect(body).not.toContain('ANFI-000083')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run app/api/past-orders/export/__tests__/route.test.ts`
Expected: FAIL — route module not found.

- [ ] **Step 3: Write the route**

Create `app/api/past-orders/export/route.ts`:

```ts
import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getPortalUser } from '@/lib/portal-data'
import { getSupabaseServer } from '@/lib/supabase'
import {
  mapPastOrderRow,
  queryPastOrders,
  type PortalPastOrder,
} from '@/lib/orders/past-orders-query'
import { filterPastOrders } from '@/lib/orders/past-orders-filter'
import {
  buildLineItemsCsv,
  buildOrdersCsv,
  type PastOrderLineItem,
} from '@/lib/orders/past-orders-csv'

// An export must reflect the DB now, never the list cache.
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams
  const granularity = params.get('granularity')
  if (granularity !== 'order' && granularity !== 'line') {
    return NextResponse.json({ error: 'granularity must be "order" or "line"' }, { status: 400 })
  }

  const user = await getPortalUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const adminClient = getSupabaseServer()
  // Org id comes from the session-derived membership only — request params can
  // narrow the scoped set but never choose the org (service-role client, so
  // this scoping is the security boundary).
  const { data: membership } = await adminClient
    .from('user_organizations')
    .select('organization_id, role')
    .eq('user_id', user.id)
    .maybeSingle()
  if (!membership?.organization_id) {
    return NextResponse.json({ error: 'No organisation membership' }, { status: 403 })
  }

  const rows = await queryPastOrders(adminClient, {
    organizationId: membership.organization_id,
    canSeeAllOrgOrders: membership.role === 'org_admin',
    userEmail: user.email ?? null,
  })

  const orders = filterPastOrders(rows.map(mapPastOrderRow), {
    status: params.get('status') ?? 'all',
    from: params.get('from'),
    to: params.get('to'),
  })

  const csv =
    granularity === 'order'
      ? buildOrdersCsv(orders)
      : await buildLineCsv(adminClient, membership.organization_id, orders)

  const orgCode = rows[0]?.quotes?.customer_code ?? 'export'
  const today = new Date().toISOString().slice(0, 10)
  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="orders-${orgCode}-${today}.csv"`,
      'Cache-Control': 'no-store',
    },
  })
}

async function buildLineCsv(
  adminClient: SupabaseClient,
  organizationId: string,
  orders: PortalPastOrder[],
): Promise<string> {
  const quoteIds = orders.map((o) => o.quoteId).filter(Boolean) as string[]

  const [itemsResult, storesResult] = await Promise.all([
    quoteIds.length
      ? adminClient
          .from('quote_items')
          .select(
            'quote_id, product_name, size_label, quantity, unit_price, total_price, qty_from_stock, qty_to_make, ship_to_store_id',
          )
          .in('quote_id', quoteIds)
      : Promise.resolve({ data: [] as PastOrderLineItem[], error: null }),
    adminClient.from('stores').select('id, name').eq('organization_id', organizationId),
  ])

  const itemsByQuoteId = new Map<string, PastOrderLineItem[]>()
  for (const item of (itemsResult.data ?? []) as PastOrderLineItem[]) {
    if (!item.quote_id) continue
    const bucket = itemsByQuoteId.get(item.quote_id) ?? []
    bucket.push(item)
    itemsByQuoteId.set(item.quote_id, bucket)
  }

  const storeNameById = new Map<string, string>(
    ((storesResult.data ?? []) as Array<{ id: string; name: string | null }>).map((s) => [
      s.id,
      s.name ?? s.id,
    ]),
  )

  return buildLineItemsCsv(orders, itemsByQuoteId, storeNameById)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run app/api/past-orders/export/__tests__/route.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 5: Typecheck (baseline = 5)**

Run: `npx tsc --noEmit 2>&1 | tail -8`
Expected: only the 5 baseline errors.

- [ ] **Step 6: Commit**

```bash
git add app/api/past-orders/export
git commit -m "feat: CSV export route for the orders view (order + line-item granularity)"
```

---

### Task 6: UI — sortable Orders table, placed-by filter, export buttons

**Files:**
- Create: `app/(portal)/my-collections/OrdersTable.tsx`
- Modify: `app/(portal)/my-collections/MyCollectionsClient.tsx` (heading, filters, replace card stack, delete `OrderCard`)
- Modify: `lib/orders/order-type.ts` (append `orderTypeLabel`)
- Test: `app/(portal)/my-collections/__tests__/OrdersTable.test.tsx`

**Interfaces:**
- Consumes: `sortPastOrders`, `PastOrderSort`, `PastOrderSortKey` (Task 3); `PortalPastOrder` from `@/lib/portal-data`; `orderStatusLabel` from `@/lib/orders/status-labels`; `access.canSeeAllOrgOrders` from `useCompany()`.
- Produces: `OrdersTable({ orders }: { orders: PortalPastOrder[] })` — owns its sort state, default `{key:'createdAt', dir:'desc'}`; `orderTypeLabel(type: string): string`.

- [ ] **Step 1: Append `orderTypeLabel` to `lib/orders/order-type.ts`**

```ts
export function orderTypeLabel(type: string): string {
  return type === 'stock_on_hand' ? 'Stock' : 'Purchase order'
}
```

(No dedicated test — covered by the component test below.)

- [ ] **Step 2: Write the failing component test**

Create `app/(portal)/my-collections/__tests__/OrdersTable.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { OrdersTable } from '../OrdersTable'
import type { PortalPastOrder } from '@/lib/portal-data'

function order(overrides: Partial<PortalPastOrder>): PortalPastOrder {
  return {
    orderId: 'o1',
    quoteId: 'q1',
    orderRef: 'REF-1',
    quoteNumber: null,
    reference: null,
    status: 'shipped',
    orderType: 'purchase_order',
    customerName: null,
    customerEmail: 'a@x.co',
    customerCompany: null,
    subtotal: 100,
    totalAmount: 115,
    currency: 'NZD',
    pickingFee: 0,
    billed: 100,
    createdAt: '2026-07-01T00:00:00.000Z',
    tracking: null,
    ...overrides,
  }
}

const cheap = order({ orderId: 'o1', quoteId: 'q1', orderRef: 'REF-1', billed: 50, createdAt: '2026-07-02T00:00:00.000Z' })
const dear = order({ orderId: 'o2', quoteId: 'q2', orderRef: 'REF-2', billed: 500, orderType: 'stock_on_hand', createdAt: '2026-07-01T00:00:00.000Z' })

function bodyRefs(): string[] {
  const rows = within(screen.getAllByRole('rowgroup')[1]).getAllByRole('row')
  return rows.map((r) => within(r).getAllByRole('cell')[1].textContent ?? '')
}

describe('OrdersTable', () => {
  it('renders newest-first by default with type labels and both money columns', () => {
    render(<OrdersTable orders={[dear, cheap]} />)
    expect(bodyRefs()).toEqual(['REF-1', 'REF-2'])
    expect(screen.getByText('Stock')).toBeDefined()
    expect(screen.getAllByText('$100.00').length).toBeGreaterThan(0)
    expect(screen.getByText('$500.00')).toBeDefined()
  })

  it('clicking the Billed header sorts ascending, clicking again flips to descending', () => {
    render(<OrdersTable orders={[dear, cheap]} />)
    const billedHeader = screen.getByRole('button', { name: /billed/i })
    fireEvent.click(billedHeader)
    expect(bodyRefs()).toEqual(['REF-1', 'REF-2'])
    fireEvent.click(billedHeader)
    expect(bodyRefs()).toEqual(['REF-2', 'REF-1'])
  })

  it('rows link to the my-collections detail page keyed on quoteId', () => {
    render(<OrdersTable orders={[cheap]} />)
    expect(screen.getByRole('link', { name: 'REF-1' }).getAttribute('href')).toBe('/my-collections/q1')
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run "app/(portal)/my-collections/__tests__/OrdersTable.test.tsx"`
Expected: FAIL — `OrdersTable` not found.

- [ ] **Step 4: Write `OrdersTable.tsx`**

Create `app/(portal)/my-collections/OrdersTable.tsx`:

```tsx
'use client'

import { useState } from 'react'
import Link from 'next/link'
import type { PortalPastOrder } from '@/lib/portal-data'
import { orderStatusLabel, type OrderStatus } from '@/lib/orders/status-labels'
import { orderTypeLabel } from '@/lib/orders/order-type'
import {
  sortPastOrders,
  type PastOrderSort,
  type PastOrderSortKey,
} from '@/lib/orders/past-orders-filter'

const COLUMNS: Array<{ key: PastOrderSortKey; label: string; numeric?: boolean }> = [
  { key: 'createdAt', label: 'Date' },
  { key: 'orderRef', label: 'Order ref' },
  { key: 'placedBy', label: 'Placed by' },
  { key: 'orderType', label: 'Type' },
  { key: 'status', label: 'Status' },
  { key: 'productValue', label: 'Product value', numeric: true },
  { key: 'billed', label: 'Billed', numeric: true },
]

function formatCurrency(value: number, currency = 'NZD'): string {
  return new Intl.NumberFormat('en-NZ', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
  }).format(value)
}

export function OrdersTable({ orders }: { orders: PortalPastOrder[] }) {
  const [sort, setSort] = useState<PastOrderSort>({ key: 'createdAt', dir: 'desc' })
  const sorted = sortPastOrders(orders, sort)

  function toggle(key: PastOrderSortKey) {
    setSort((prev) =>
      prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' },
    )
  }

  return (
    <div className="overflow-x-auto rounded-3xl bg-white">
      <table className="w-full min-w-[760px] text-sm">
        <thead>
          <tr className="border-b border-gray-100 text-left text-xs text-gray-500">
            {COLUMNS.map((col) => (
              <th
                key={col.key}
                aria-sort={
                  sort.key === col.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'
                }
                className={`px-4 py-3 font-medium ${col.numeric ? 'text-right' : ''}`}
              >
                <button
                  type="button"
                  onClick={() => toggle(col.key)}
                  className="inline-flex items-center gap-1 hover:text-gray-900"
                >
                  {col.label}
                  {sort.key === col.key && <span aria-hidden>{sort.dir === 'asc' ? '↑' : '↓'}</span>}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((order) => {
            const ref =
              order.orderRef ||
              order.reference ||
              order.quoteNumber ||
              `#${order.orderId.slice(0, 8).toUpperCase()}`
            return (
              <tr key={order.orderId} className="border-b border-gray-50 hover:bg-gray-50">
                <td className="px-4 py-3 whitespace-nowrap text-gray-600">
                  {new Date(order.createdAt).toLocaleDateString('en-NZ', {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric',
                  })}
                </td>
                <td className="px-4 py-3">
                  <Link
                    href={`/my-collections/${order.quoteId ?? order.orderId}`}
                    className="font-semibold text-black hover:underline"
                  >
                    {ref}
                  </Link>
                </td>
                <td className="px-4 py-3 text-gray-600">{order.customerEmail ?? '—'}</td>
                <td className="px-4 py-3 text-gray-600">{orderTypeLabel(order.orderType)}</td>
                <td className="px-4 py-3">
                  <span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-xs text-gray-700">
                    {orderStatusLabel(order.status as OrderStatus)}
                  </span>
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {formatCurrency(order.subtotal, order.currency)}
                </td>
                <td className="px-4 py-3 text-right font-semibold tabular-nums">
                  {formatCurrency(order.billed, order.currency)}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
```

- [ ] **Step 5: Run the component test to verify it passes**

Run: `npx vitest run "app/(portal)/my-collections/__tests__/OrdersTable.test.tsx"`
Expected: PASS (3 tests)

- [ ] **Step 6: Rewire `MyCollectionsClient.tsx`**

6a. Replace the imports of `filterPastOrders` and add the new pieces (top of file):

```tsx
import { filterPastOrders } from '@/lib/orders/past-orders-filter'
import { OrdersTable } from './OrdersTable'
```

(`Link` stays — still used elsewhere? After deleting `OrderCard` it is NOT: remove the `import Link from 'next/link'` line. `formatCurrency` in this file also becomes unused: delete it.)

6b. Add placed-by filter state next to the existing filter state (line ~31):

```tsx
const [placedByFilter, setPlacedByFilter] = useState<string>('all')
```

6c. Replace the derived-values block (lines ~79-84) with:

```tsx
const statusOptions = Array.from(new Set(orders.map((o) => o.status)))
const placedByOptions = Array.from(
  new Set(orders.map((o) => o.customerEmail).filter(Boolean)),
) as string[]
const filteredOrders = filterPastOrders(orders, {
  status: statusFilter,
  from: dateFrom || null,
  to: dateTo || null,
}).filter((o) => placedByFilter === 'all' || o.customerEmail === placedByFilter)

const exportQuery = new URLSearchParams({
  ...(statusFilter !== 'all' ? { status: statusFilter } : {}),
  ...(dateFrom ? { from: dateFrom } : {}),
  ...(dateTo ? { to: dateTo } : {}),
}).toString()
const exportHref = (granularity: 'order' | 'line') =>
  `/api/past-orders/export?granularity=${granularity}${exportQuery ? `&${exportQuery}` : ''}`
```

6d. Heading (line ~93): change the `<h1>` text `Past orders` → `Orders`.

6e. In the filter row (after the date inputs, before the store-filter TODO comment which stays), add the placed-by select (org-admin only) and the export buttons:

```tsx
{access?.canSeeAllOrgOrders && placedByOptions.length > 1 && (
  <select
    value={placedByFilter}
    onChange={(e) => setPlacedByFilter(e.target.value)}
    className="rounded-full bg-gray-100 px-4 py-1.5 text-xs font-medium text-gray-700"
    aria-label="Placed by"
  >
    <option value="all">All members</option>
    {placedByOptions.map((email) => (
      <option key={email} value={email}>
        {email}
      </option>
    ))}
  </select>
)}
<div className="ml-auto flex items-center gap-2">
  <a
    href={exportHref('order')}
    className="rounded-full bg-black px-4 py-1.5 text-xs font-medium text-white hover:bg-gray-800"
  >
    Export orders
  </a>
  <a
    href={exportHref('line')}
    className="rounded-full bg-gray-100 px-4 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-200"
  >
    Export line items
  </a>
</div>
```

(Plain anchors, not fetch — the browser handles the CSV download via Content-Disposition. Note the placed-by filter is view-only by design; exports include all members — spec §Approach/UI.)

6f. Replace the card stack (lines ~137-141) with:

```tsx
<OrdersTable orders={filteredOrders} />
```

6g. Delete the entire `OrderCard` function (lines ~161-220) and the now-unused `Link` import, `formatCurrency` helper, and `type Order = PortalPastOrder` alias if nothing else uses them.

- [ ] **Step 7: Run the full test suite**

Run: `npm test`
Expected: PASS (no regressions; the axe smoke test must stay green — the table uses semantic `<table>`/`<th>`/`aria-sort`, so it should).

- [ ] **Step 8: Typecheck (baseline = 5)**

Run: `npx tsc --noEmit 2>&1 | tail -8`
Expected: only the 5 baseline errors.

- [ ] **Step 9: Commit**

```bash
git add "app/(portal)/my-collections" lib/orders/order-type.ts
git commit -m "feat: sortable Orders table with placed-by filter and CSV export buttons"
```

---

### Task 7: Full verification + finish

**Files:** none new.

- [ ] **Step 1: Full suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 2: Typecheck at baseline**

Run: `rm -rf .next && npx tsc --noEmit 2>&1 | tail -8`
Expected: exactly the 5 baseline errors.

- [ ] **Step 3: Production build**

Run: `npm run build`
Expected: build succeeds; `/api/past-orders/export` appears in the route list as dynamic (ƒ).

- [ ] **Step 4: Manual smoke (needs Jon or a dev session — record results, do not skip silently)**

As `hello@theprint-room.co.nz` (Anytime Fitness org_admin):
1. `/my-collections` shows heading **Orders** and all 6 AF orders (live-DB count as of 2026-07-17) in the table — purchase orders included, not just stock.
2. Click **Billed** header — rows reorder; click again — reverses.
3. Placed-by select lists the gym emails; picking one narrows the table.
4. **Export orders** downloads `orders-ANFI-<today>.csv`; opens in Excel with readable columns, `billed_ex_gst` equals the goods value on pre-parity orders.
5. **Export line items** downloads one row per line with product/size/qty and ship-to store names.

As a staff member (any gym user): table shows only their own orders (email-scoped — this is the staff-sees-zero bug fix; before this branch they saw nothing).

- [ ] **Step 5: Finish**

Use superpowers:finishing-a-development-branch — present merge/PR options for `feat/org-order-data-view`.

---

## Self-review notes (already applied)

- Spec coverage: data widening + email scoping (Task 2), sort (Tasks 3/6), export both granularities (Tasks 4/5), org-from-session security (Task 5), heading rename + placed-by filter + detail links to `/my-collections/[collectionId]` (Task 6), tsc-baseline + manual smoke (Task 7). Store-filter TODO deliberately untouched (spec: out of scope).
- The export route intentionally does NOT accept a placed-by param — spec locks export params to `granularity|status|from|to`.
- `PortalPastOrder` moves to `lib/orders/past-orders-query.ts` with a type re-export from `lib/portal-data.ts`, so `MyCollectionsClient`, `past-orders-filter.ts`, and any other `@/lib/portal-data` importer compile unchanged.
