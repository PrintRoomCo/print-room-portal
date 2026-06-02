# Org Inventory + Audit View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give org admins an Inventory tab in the customer portal showing their org's full stock position per product/variant, plus a read-only audit trail of every stock movement — what moved, **who** ordered it, **where** it shipped, **when** — built entirely from existing tables.

**Architecture:** A new `/inventory` page (org-admin + inventory-tenant gated) renders two panels: the existing `/api/inventory` stock table (the `variant_availability` view — confirmed to exist), and a new `/api/inventory/audit` feed over `variant_inventory_events`. "Who" resolves through `reference_quote_item_id → quote_items.quote_id → quotes.created_by → profiles` for order events (NOT the always-null `staff_user_id`); "where" through `quote_items.ship_to_store_id → stores`. Nav gating is extracted to a pure module so the new `requiresOrgAdmin` rule is unit-testable. No schema change, no new instrumentation.

**Tech Stack:** Next.js 16 App Router, React 19, Supabase (service-role admin client), Vitest 2.

**Rename-independence:** Gating uses `isOrgAdmin` / `context.role === 'org_admin'`, both unaffected by the `buyer→staff` rename (only `buyer` changes value). Safe to build before or after that sprint.

---

## Spec

Source: [`docs/superpowers/specs/2026-06-02-org-inventory-audit-view-design.md`](../specs/2026-06-02-org-inventory-audit-view-design.md)

## Verified preconditions (Supabase MCP, 2026-06-02)

- `variant_availability` **view EXISTS**; `variant_inventory` has 92 rows. The existing `/api/inventory` route's "may not exist yet" caveat is stale.
- There is **no `/inventory` page** today — only `app/api/inventory/route.ts`. The Sidebar comment "Catalogue absorbs the previous Shop + Inventory surfaces" reflects the page being removed. So the nav link **and** the page must be built.
- `variant_inventory_events` columns confirmed: `variant_id, organization_id, delta_stock, delta_committed, reason, note, reference_quote_item_id, staff_user_id, created_at, prepaid, unit_value`.
- `quotes.created_by` (uuid, nullable) exists; `profiles` has `id, full_name, email`; `stores` has `id, name`. The audit join chain is intact.
- Event-reason reality (from the live ledger): `staff_user_id` is null on `order_commit` / `pre_approved_inventory` (order-driven) and set only on `intake` / `count_correction` (manual). Hence "who ordered" must derive from `quotes.created_by`.
- `B2BCustomerAccess` (`types/company.ts`) already exposes `isOrgAdmin`, `isCompanyUser`, `canUseLeavers`, and `tenantType: 'franchise'|'studio_plus_inventory'|'studio'|null`.
- The Sidebar (`components/layout/Sidebar.tsx`) renders 4 hand-drawn SVG rows (`SVG_ROWS`) plus an `extraItems` fallback that renders any `allNavItems` entry NOT in `SVG_ROWS` as a classic `<Link>` (this is how "Leavers Quotes" appears). Inventory follows that same `extraItems` path.

## File Structure

- **Create** `lib/nav/portal-nav.ts` — pure nav model: `PortalNavItem[]` (+ new `requiresOrgAdmin`, + Inventory entry) and `getNavigationItems(access)`. No JSX/React. The TDD core for gating.
- **Create** `lib/nav/__tests__/portal-nav.test.ts` — gating unit tests.
- **Modify** `components/layout/Sidebar.tsx` — consume `lib/nav/portal-nav`; map `B2BCustomerAccess` → `NavAccess`; add an `InventoryIcon` to the `extraItems` icon lookup.
- **Create** `lib/inventory/audit.ts` — pure `buildAuditEntries(events, resolvers)` mapper. The TDD core for who/where.
- **Create** `lib/inventory/__tests__/audit.test.ts` — mapper unit tests.
- **Create** `app/api/inventory/audit/route.ts` — org-admin-gated, org-scoped audit feed.
- **Create** `app/api/inventory/audit/__tests__/route.test.ts` — 403 gate + happy-path resolution.
- **Create** `app/(portal)/inventory/page.tsx` — server component, gate + render client.
- **Create** `app/(portal)/inventory/InventoryClient.tsx` — stock table + audit feed.
- **Create** `app/(portal)/inventory/loading.tsx` — skeleton.
- **Create** `app/(portal)/inventory/__tests__/InventoryClient.test.tsx` — render smoke.

---

## Task 1: Extract pure nav model + add `requiresOrgAdmin` + Inventory entry

**Files:**
- Create: `lib/nav/portal-nav.ts`
- Test: `lib/nav/__tests__/portal-nav.test.ts`
- Modify: `components/layout/Sidebar.tsx`

> **Collision guard — same-day sprint also adds the Inventory nav link; whichever ships first owns it.** This extraction REPLACES Sidebar's local `allNavItems` array wholesale. If the sprint already added an `Inventory` entry inline to that array, it is absorbed by `PORTAL_NAV_ITEMS` — after rewiring, confirm exactly **one** `/inventory` entry exists and its gating matches (`requiresOrgAdmin: true`, `requiredTenantTypes: ['franchise','studio_plus_inventory']`). If this plan runs **first**, the sprint's "item 5 nav link" is already done — that item collapses to verify-only.

- [ ] **Step 1: Write the failing test**

Create `lib/nav/__tests__/portal-nav.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { getNavigationItems, type NavAccess } from '../portal-nav'

function access(over: Partial<NavAccess> = {}): NavAccess {
  return {
    isCompanyUser: over.isCompanyUser ?? true,
    canUseLeavers: over.canUseLeavers ?? false,
    isOrgAdmin: over.isOrgAdmin ?? false,
    tenantType: 'tenantType' in over ? over.tenantType! : 'franchise',
  }
}

const hrefs = (a: NavAccess) => getNavigationItems(a).map((i) => i.href)

describe('getNavigationItems — Inventory gating', () => {
  it('shows Inventory to an org_admin of a franchise tenant', () => {
    expect(hrefs(access({ isOrgAdmin: true, tenantType: 'franchise' }))).toContain('/inventory')
  })

  it('shows Inventory to an org_admin of a studio_plus_inventory tenant', () => {
    expect(hrefs(access({ isOrgAdmin: true, tenantType: 'studio_plus_inventory' }))).toContain('/inventory')
  })

  it('hides Inventory from a non-admin (staff/buyer) even on an inventory tenant', () => {
    expect(hrefs(access({ isOrgAdmin: false, tenantType: 'franchise' }))).not.toContain('/inventory')
  })

  it('hides Inventory from an org_admin of a plain studio tenant', () => {
    expect(hrefs(access({ isOrgAdmin: true, tenantType: 'studio' }))).not.toContain('/inventory')
  })

  it('does NOT gate Inventory on tracked-inventory presence (admins see the empty state)', () => {
    // NavAccess has no hasTrackedInventory field — proves the gate ignores it.
    expect(hrefs(access({ isOrgAdmin: true, tenantType: 'franchise' }))).toContain('/inventory')
  })

  it('keeps the existing rows working: Catalogue needs a company, Leavers needs the flag', () => {
    expect(hrefs(access({ isCompanyUser: false }))).not.toContain('/catalogue')
    expect(hrefs(access({ canUseLeavers: false }))).not.toContain('/leavers-quotes')
    expect(hrefs(access({ canUseLeavers: true }))).toContain('/leavers-quotes')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `print-room-portal/`): `npm test -- lib/nav/__tests__/portal-nav.test.ts`
Expected: FAIL — `Cannot find module '../portal-nav'`.

- [ ] **Step 3: Write minimal implementation**

Create `lib/nav/portal-nav.ts`:

```ts
export type TenantType = 'franchise' | 'studio_plus_inventory' | 'studio'

export type NavIconKey =
  | 'tracking'
  | 'catalogue'
  | 'orders'
  | 'proofs'
  | 'leavers'
  | 'inventory'

export interface PortalNavItem {
  name: string
  href: string
  iconKey: NavIconKey
  requiresCompany: boolean
  requiresLeavers: boolean
  requiresOrgAdmin: boolean
  requiredTenantTypes: ReadonlyArray<TenantType> | null
}

/** Subset of B2BCustomerAccess the nav filter needs. */
export interface NavAccess {
  isCompanyUser: boolean
  canUseLeavers: boolean
  isOrgAdmin: boolean
  tenantType: TenantType | null
}

// Display order. Items whose iconKey is NOT a hand-drawn SVG row
// (tracking/catalogue/orders/proofs) render as classic Link rows in the
// Sidebar's extraItems list — that's the path Leavers Quotes and Inventory take.
export const PORTAL_NAV_ITEMS: ReadonlyArray<PortalNavItem> = [
  {
    name: 'Tracking',
    href: '/tracking',
    iconKey: 'tracking',
    requiresCompany: false,
    requiresLeavers: false,
    requiresOrgAdmin: false,
    requiredTenantTypes: null,
  },
  {
    name: 'Catalogue',
    href: '/catalogue',
    iconKey: 'catalogue',
    requiresCompany: true,
    requiresLeavers: false,
    requiresOrgAdmin: false,
    requiredTenantTypes: null,
  },
  {
    name: 'Orders',
    href: '/my-collections',
    iconKey: 'orders',
    requiresCompany: false,
    requiresLeavers: false,
    requiresOrgAdmin: false,
    requiredTenantTypes: null,
  },
  {
    name: 'Proofs',
    href: '/proofs',
    iconKey: 'proofs',
    requiresCompany: true,
    requiresLeavers: false,
    requiresOrgAdmin: false,
    requiredTenantTypes: null,
  },
  {
    name: 'Inventory',
    href: '/inventory',
    iconKey: 'inventory',
    requiresCompany: true,
    requiresLeavers: false,
    requiresOrgAdmin: true,
    requiredTenantTypes: ['franchise', 'studio_plus_inventory'],
  },
  {
    name: 'Leavers Quotes',
    href: '/leavers-quotes',
    iconKey: 'leavers',
    requiresCompany: false,
    requiresLeavers: true,
    requiresOrgAdmin: false,
    requiredTenantTypes: null,
  },
]

export function getNavigationItems(access: NavAccess): PortalNavItem[] {
  return PORTAL_NAV_ITEMS.filter((item) => {
    if (item.requiresCompany && !access.isCompanyUser) return false
    if (item.requiresLeavers && !access.canUseLeavers) return false
    if (item.requiresOrgAdmin && !access.isOrgAdmin) return false
    if (item.requiredTenantTypes) {
      if (!access.tenantType) return false
      if (!item.requiredTenantTypes.includes(access.tenantType)) return false
    }
    return true
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- lib/nav/__tests__/portal-nav.test.ts`
Expected: PASS.

- [ ] **Step 5: Rewire Sidebar to consume the pure model**

In `components/layout/Sidebar.tsx`:

1. Add import: `import { PORTAL_NAV_ITEMS, getNavigationItems, type PortalNavItem, type NavIconKey } from '@/lib/nav/portal-nav'`.
2. Delete the local `type TenantType`, the local `allNavItems` array, and the local `getNavigationItems` function (current lines 15, 28-85). Keep `SVG_ROWS` as-is.
3. Replace the `const navigation = getNavigationItems(customer)` call with a `NavAccess` projection:

```tsx
const navigation = getNavigationItems({
  isCompanyUser: customer.isCompanyUser,
  canUseLeavers: customer.canUseLeavers,
  isOrgAdmin: customer.isOrgAdmin,
  tenantType: customer.tenantType,
})
```

4. The `extraItems` list now renders by `iconKey`. Add an icon lookup near the other icons and use it in the `extraItems` map (replace `item.icon` usage at current lines 349-368):

```tsx
const EXTRA_ICONS: Record<NavIconKey, (p: { className?: string }) => React.ReactElement> = {
  tracking: TrackerIcon,
  catalogue: CatalogueIcon,
  orders: OrdersIcon,
  proofs: ProofsIcon,
  leavers: LeaversIcon,
  inventory: InventoryIcon,
}
```

In the `extraItems.map(...)` body, replace `<item.icon className="h-5 w-5 flex-shrink-0" />` with:

```tsx
{(() => {
  const Icon = EXTRA_ICONS[item.iconKey]
  return <Icon className="h-5 w-5 flex-shrink-0" />
})()}
```

5. Add the `InventoryIcon` component alongside the other icon components at the bottom of the file:

```tsx
function InventoryIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.75}
        d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10m0-10L4 7m0 0v10l8 4"
      />
    </svg>
  )
}
```

- [ ] **Step 6: Run the suite + build**

Run: `npm test -- lib/nav/__tests__/portal-nav.test.ts` then `npm run build`
Expected: PASS; build succeeds (Sidebar has no unused `item.icon` refs or dangling `TenantType`).

- [ ] **Step 7: Commit**

```bash
git checkout -b feat/org-inventory-audit
git add lib/nav/portal-nav.ts lib/nav/__tests__/portal-nav.test.ts components/layout/Sidebar.tsx
git commit -m "feat(inventory): extract pure nav model + org-admin-gated Inventory tab link"
```

---

## Task 2: Pure audit mapper

**Files:**
- Create: `lib/inventory/audit.ts`
- Test: `lib/inventory/__tests__/audit.test.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/inventory/__tests__/audit.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  buildAuditEntries,
  type InventoryEvent,
  type AuditResolvers,
} from '../audit'

function resolvers(over: Partial<AuditResolvers> = {}): AuditResolvers {
  return {
    quoteItemById: over.quoteItemById ?? new Map(),
    createdByByQuoteId: over.createdByByQuoteId ?? new Map(),
    nameByUserId: over.nameByUserId ?? new Map(),
    storeNameById: over.storeNameById ?? new Map(),
  }
}

function event(over: Partial<InventoryEvent> = {}): InventoryEvent {
  return {
    id: over.id ?? 'e1',
    variant_id: over.variant_id ?? 'v1',
    reason: over.reason ?? 'order_commit',
    delta_stock: over.delta_stock ?? -5,
    delta_committed: over.delta_committed ?? 0,
    note: over.note ?? null,
    reference_quote_item_id: 'reference_quote_item_id' in over ? over.reference_quote_item_id! : 'qi-1',
    staff_user_id: 'staff_user_id' in over ? over.staff_user_id! : null,
    created_at: over.created_at ?? '2026-06-01T00:00:00Z',
  }
}

describe('buildAuditEntries', () => {
  it('resolves who (order placer) + where (ship-to store) for an order event', () => {
    const [entry] = buildAuditEntries(
      [event({ reason: 'order_commit', reference_quote_item_id: 'qi-1' })],
      resolvers({
        quoteItemById: new Map([['qi-1', { quote_id: 'q-1', ship_to_store_id: 's-1' }]]),
        createdByByQuoteId: new Map([['q-1', 'u-1']]),
        nameByUserId: new Map([['u-1', 'Jane Buyer']]),
        storeNameById: new Map([['s-1', 'Queen St Store']]),
      }),
    )
    expect(entry.source).toBe('order')
    expect(entry.who).toBe('Jane Buyer')
    expect(entry.where).toBe('Queen St Store')
  })

  it('labels manual staff events as Print Room with no ship-to', () => {
    const [entry] = buildAuditEntries(
      [event({ reason: 'intake', reference_quote_item_id: null, staff_user_id: null })],
      resolvers(),
    )
    expect(entry.source).toBe('staff')
    expect(entry.who).toBe('Print Room')
    expect(entry.where).toBeNull()
  })

  it('uses the staff member name when a manual event carries staff_user_id', () => {
    const [entry] = buildAuditEntries(
      [event({ reason: 'count_correction', reference_quote_item_id: null, staff_user_id: 'staff-9' })],
      resolvers({ nameByUserId: new Map([['staff-9', 'Sam Staff']]) }),
    )
    expect(entry.who).toBe('Sam Staff')
  })

  it('degrades gracefully when the order chain cannot resolve a person', () => {
    const [entry] = buildAuditEntries(
      [event({ reason: 'pre_approved_inventory', reference_quote_item_id: 'qi-x' })],
      resolvers(), // no maps populated
    )
    expect(entry.source).toBe('order')
    expect(entry.who).toBe('Unknown')
    expect(entry.where).toBeNull()
  })

  it('passes movement fields straight through', () => {
    const [entry] = buildAuditEntries(
      [event({ delta_stock: -3, delta_committed: 3, note: 'partial ship', reason: 'order_commit', reference_quote_item_id: null })],
      resolvers(),
    )
    expect(entry).toMatchObject({ deltaStock: -3, deltaCommitted: 3, note: 'partial ship', variantId: 'v1' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- lib/inventory/__tests__/audit.test.ts`
Expected: FAIL — `Cannot find module '../audit'`.

- [ ] **Step 3: Write minimal implementation**

Create `lib/inventory/audit.ts`:

```ts
export interface InventoryEvent {
  id: string
  variant_id: string
  reason: string
  delta_stock: number
  delta_committed: number
  note: string | null
  reference_quote_item_id: string | null
  staff_user_id: string | null
  created_at: string
}

export interface AuditResolvers {
  /** reference_quote_item_id → its quote + ship-to store */
  quoteItemById: Map<string, { quote_id: string; ship_to_store_id: string | null }>
  /** quote_id → the user who placed the order (quotes.created_by) */
  createdByByQuoteId: Map<string, string | null>
  /** user id → display name (full_name ?? email) */
  nameByUserId: Map<string, string>
  /** store id → store name */
  storeNameById: Map<string, string>
}

export interface AuditEntry {
  id: string
  variantId: string
  reason: string
  deltaStock: number
  deltaCommitted: number
  note: string | null
  /** Resolved order placer, staff member, "Print Room", or "Unknown". */
  who: string
  /** Ship-to store name for order events; null otherwise. */
  where: string | null
  source: 'order' | 'staff'
  createdAt: string
}

// Order-driven reasons carry no staff_user_id; the human is the order placer,
// resolved through the quote. Everything else is a manual staff adjustment.
const ORDER_REASONS = new Set(['order_commit', 'pre_approved_inventory'])

export function buildAuditEntries(
  events: InventoryEvent[],
  r: AuditResolvers,
): AuditEntry[] {
  return events.map((e) => {
    const isOrder = ORDER_REASONS.has(e.reason)

    let who = 'Unknown'
    let where: string | null = null

    if (isOrder) {
      const qi = e.reference_quote_item_id
        ? r.quoteItemById.get(e.reference_quote_item_id)
        : undefined
      const createdBy = qi ? r.createdByByQuoteId.get(qi.quote_id) ?? null : null
      who = createdBy ? r.nameByUserId.get(createdBy) ?? 'Unknown' : 'Unknown'
      where = qi?.ship_to_store_id ? r.storeNameById.get(qi.ship_to_store_id) ?? null : null
    } else {
      who = e.staff_user_id ? r.nameByUserId.get(e.staff_user_id) ?? 'Print Room' : 'Print Room'
      where = null
    }

    return {
      id: e.id,
      variantId: e.variant_id,
      reason: e.reason,
      deltaStock: e.delta_stock,
      deltaCommitted: e.delta_committed,
      note: e.note,
      who,
      where,
      source: isOrder ? 'order' : 'staff',
      createdAt: e.created_at,
    }
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- lib/inventory/__tests__/audit.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/inventory/audit.ts lib/inventory/__tests__/audit.test.ts
git commit -m "feat(inventory): pure audit mapper — who via quotes.created_by, where via ship_to_store_id"
```

---

## Task 3: Audit API route (org-admin gated, org-scoped)

**Files:**
- Create: `app/api/inventory/audit/route.ts`
- Test: `app/api/inventory/audit/__tests__/route.test.ts`

**Contract:** `GET /api/inventory/audit` → `{ entries: AuditEntry[] }` (newest first, capped at 200) for the caller's org. 403 for non-admins.

- [ ] **Step 1: Write the failing test**

Create `app/api/inventory/audit/__tests__/route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/checkout/server', () => ({ requireB2BCustomerApi: vi.fn() }))

import { GET } from '../route'
import { requireB2BCustomerApi } from '@/lib/checkout/server'

const ORG = 'org-1'
type AnyRow = Record<string, unknown>

function makeAdmin(selects: Record<string, { data: unknown; error: null }>) {
  function builder(table: string) {
    const resp = selects[table] ?? { data: [], error: null }
    const b: AnyRow = {
      select: () => b,
      eq: () => b,
      in: () => b,
      order: () => b,
      limit: () => b,
      then: (res: (v: unknown) => unknown) => Promise.resolve(resp).then(res),
    }
    return b
  }
  return { from: vi.fn((t: string) => builder(t)) } as unknown
}

beforeEach(() => vi.clearAllMocks())

describe('GET /api/inventory/audit', () => {
  it('403s for a non-admin member', async () => {
    vi.mocked(requireB2BCustomerApi).mockResolvedValue({
      admin: makeAdmin({}),
      context: { organizationId: ORG, role: 'buyer' },
    } as never)
    const res = await GET()
    expect(res.status).toBe(403)
  })

  it('returns resolved audit entries for an org_admin', async () => {
    vi.mocked(requireB2BCustomerApi).mockResolvedValue({
      admin: makeAdmin({
        variant_inventory_events: {
          data: [
            {
              id: 'e1',
              variant_id: 'v1',
              reason: 'order_commit',
              delta_stock: -5,
              delta_committed: 0,
              note: null,
              reference_quote_item_id: 'qi-1',
              staff_user_id: null,
              created_at: '2026-06-01T00:00:00Z',
            },
          ],
          error: null,
        },
        quote_items: { data: [{ id: 'qi-1', quote_id: 'q-1', ship_to_store_id: 's-1' }], error: null },
        quotes: { data: [{ id: 'q-1', created_by: 'u-1' }], error: null },
        profiles: { data: [{ id: 'u-1', full_name: 'Jane Buyer', email: 'jane@b.test' }], error: null },
        stores: { data: [{ id: 's-1', name: 'Queen St Store' }], error: null },
      }),
      context: { organizationId: ORG, role: 'org_admin' },
    } as never)

    const res = await GET()
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.entries).toHaveLength(1)
    expect(json.entries[0]).toMatchObject({
      who: 'Jane Buyer',
      where: 'Queen St Store',
      source: 'order',
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- app/api/inventory/audit/__tests__/route.test.ts`
Expected: FAIL — `Cannot find module '../route'`.

- [ ] **Step 3: Write minimal implementation**

Create `app/api/inventory/audit/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { requireB2BCustomerApi } from '@/lib/checkout/server'
import {
  buildAuditEntries,
  type InventoryEvent,
  type AuditResolvers,
} from '@/lib/inventory/audit'

const EVENT_LIMIT = 200

export async function GET() {
  const auth = await requireB2BCustomerApi()
  if ('error' in auth) return auth.error

  // Org-admin only (rename-independent — org_admin keeps its value).
  if (auth.context.role !== 'org_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const orgId = auth.context.organizationId

  const { data: eventRows, error: eventErr } = await auth.admin
    .from('variant_inventory_events')
    .select(
      'id, variant_id, reason, delta_stock, delta_committed, note, reference_quote_item_id, staff_user_id, created_at',
    )
    .eq('organization_id', orgId)
    .order('created_at', { ascending: false })
    .limit(EVENT_LIMIT)
  if (eventErr) return NextResponse.json({ error: eventErr.message }, { status: 500 })

  const events = (eventRows ?? []) as InventoryEvent[]

  const refIds = Array.from(
    new Set(events.map((e) => e.reference_quote_item_id).filter((x): x is string => !!x)),
  )
  const quoteItemById: AuditResolvers['quoteItemById'] = new Map()
  const createdByByQuoteId: AuditResolvers['createdByByQuoteId'] = new Map()
  const nameByUserId: AuditResolvers['nameByUserId'] = new Map()
  const storeNameById: AuditResolvers['storeNameById'] = new Map()

  if (refIds.length > 0) {
    const { data: qiRows } = await auth.admin
      .from('quote_items')
      .select('id, quote_id, ship_to_store_id')
      .in('id', refIds)
    for (const qi of (qiRows ?? []) as Array<{
      id: string
      quote_id: string
      ship_to_store_id: string | null
    }>) {
      quoteItemById.set(qi.id, { quote_id: qi.quote_id, ship_to_store_id: qi.ship_to_store_id })
    }
  }

  const quoteIds = Array.from(new Set(Array.from(quoteItemById.values()).map((v) => v.quote_id)))
  if (quoteIds.length > 0) {
    const { data: quoteRows } = await auth.admin
      .from('quotes')
      .select('id, created_by')
      .in('id', quoteIds)
    for (const q of (quoteRows ?? []) as Array<{ id: string; created_by: string | null }>) {
      createdByByQuoteId.set(q.id, q.created_by)
    }
  }

  const userIds = Array.from(
    new Set(
      [
        ...Array.from(createdByByQuoteId.values()),
        ...events.map((e) => e.staff_user_id),
      ].filter((x): x is string => !!x),
    ),
  )
  if (userIds.length > 0) {
    const { data: profileRows } = await auth.admin
      .from('profiles')
      .select('id, full_name, email')
      .in('id', userIds)
    for (const p of (profileRows ?? []) as Array<{
      id: string
      full_name: string | null
      email: string | null
    }>) {
      nameByUserId.set(p.id, p.full_name || p.email || 'Unknown')
    }
  }

  const storeIds = Array.from(
    new Set(
      Array.from(quoteItemById.values())
        .map((v) => v.ship_to_store_id)
        .filter((x): x is string => !!x),
    ),
  )
  if (storeIds.length > 0) {
    const { data: storeRows } = await auth.admin
      .from('stores')
      .select('id, name')
      .in('id', storeIds)
    for (const s of (storeRows ?? []) as Array<{ id: string; name: string }>) {
      storeNameById.set(s.id, s.name)
    }
  }

  const entries = buildAuditEntries(events, {
    quoteItemById,
    createdByByQuoteId,
    nameByUserId,
    storeNameById,
  })

  return NextResponse.json({ entries })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- app/api/inventory/audit/__tests__/route.test.ts`
Expected: PASS (403 gate + resolved entry).

- [ ] **Step 5: Commit**

```bash
git add app/api/inventory/audit/route.ts app/api/inventory/audit/__tests__/route.test.ts
git commit -m "feat(inventory): org-admin audit feed route over variant_inventory_events"
```

---

## Task 4: Inventory page + client + loading

**Files:**
- Create: `app/(portal)/inventory/page.tsx`
- Create: `app/(portal)/inventory/InventoryClient.tsx`
- Create: `app/(portal)/inventory/loading.tsx`
- Test: `app/(portal)/inventory/__tests__/InventoryClient.test.tsx`

> **Collision guard — the sprint may ship a basic `/inventory` page (stock table only) first.** If `app/(portal)/inventory/page.tsx` / `InventoryClient.tsx` already exist from the sprint's item-5 build, **modify instead of create**: keep the existing stock table + server gate, and ADD the audit-feed panel + per-variant filter below it. The audit route (Task 3) and mapper (Task 2) are net-new either way. If this plan runs **first**, this *is* the page the sprint's item 5 refers to — item 5 collapses to "already built."

- [ ] **Step 1: Write the failing test (client render smoke)**

Create `app/(portal)/inventory/__tests__/InventoryClient.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { InventoryClient } from '../InventoryClient'

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      if (url === '/api/inventory') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            rows: [
              {
                variant_id: 'v1',
                product_id: 'p1',
                product_name: 'Basic Tee',
                colour_name: 'Bone',
                colour_hex: '#eee',
                size_label: 'M',
                available_qty: 12,
                stock_qty: 20,
                committed_qty: 8,
                updated_at: '2026-06-01T00:00:00Z',
              },
            ],
          }),
        })
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({
          entries: [
            {
              id: 'e1',
              variantId: 'v1',
              reason: 'order_commit',
              deltaStock: -5,
              deltaCommitted: 0,
              note: null,
              who: 'Jane Buyer',
              where: 'Queen St Store',
              source: 'order',
              createdAt: '2026-06-01T00:00:00Z',
            },
          ],
        }),
      })
    }),
  )
})

describe('InventoryClient', () => {
  it('renders the stock table and the audit feed from the two endpoints', async () => {
    render(<InventoryClient />)
    await waitFor(() => expect(screen.getByText('Basic Tee')).toBeInTheDocument())
    expect(screen.getByText('Jane Buyer')).toBeInTheDocument()
    expect(screen.getByText('Queen St Store')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- app/(portal)/inventory/__tests__/InventoryClient.test.tsx`
Expected: FAIL — `Cannot find module '../InventoryClient'`.

- [ ] **Step 3: Write the client component**

Create `app/(portal)/inventory/InventoryClient.tsx`:

```tsx
'use client'

import { useEffect, useMemo, useState } from 'react'
import type { CustomerInventoryRow } from '@/app/api/inventory/route'
import type { AuditEntry } from '@/lib/inventory/audit'

export function InventoryClient() {
  const [rows, setRows] = useState<CustomerInventoryRow[]>([])
  const [entries, setEntries] = useState<AuditEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [variantFilter, setVariantFilter] = useState<string | null>(null)

  useEffect(() => {
    let stale = false
    Promise.all([
      fetch('/api/inventory').then((r) => (r.ok ? r.json() : { rows: [] })),
      fetch('/api/inventory/audit').then((r) => (r.ok ? r.json() : { entries: [] })),
    ])
      .then(([stock, audit]) => {
        if (stale) return
        setRows(stock.rows ?? [])
        setEntries(audit.entries ?? [])
        setLoading(false)
      })
      .catch(() => {
        if (stale) return
        setRows([])
        setEntries([])
        setLoading(false)
      })
    return () => {
      stale = true
    }
  }, [])

  const visibleEntries = useMemo(
    () => (variantFilter ? entries.filter((e) => e.variantId === variantFilter) : entries),
    [entries, variantFilter],
  )

  return (
    <div className="min-h-screen bg-[#FAFAFA]">
      <div className="mx-auto max-w-[1320px] px-4 pb-16 pt-[100px] md:px-6 md:pt-[120px]">
        <header className="mb-10 md:mb-12">
          <h1 className="font-dm-sans text-[clamp(40px,5vw,72px)] font-medium leading-[1.05] tracking-[-0.02em] text-gray-900">
            Inventory
          </h1>
        </header>

        {/* Stock table */}
        <section className="mb-12">
          <h2 className="mb-4 text-sm font-medium text-gray-700">Stock on hand</h2>
          <div className="overflow-x-auto rounded-2xl bg-white">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-gray-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Product</th>
                  <th className="px-4 py-3 font-medium">Colour</th>
                  <th className="px-4 py-3 font-medium">Size</th>
                  <th className="px-4 py-3 text-right font-medium">Available</th>
                  <th className="px-4 py-3 text-right font-medium">In stock</th>
                  <th className="px-4 py-3 text-right font-medium">Committed</th>
                  <th className="px-4 py-3 font-medium">Audit</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-gray-400">
                      Loading…
                    </td>
                  </tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-gray-500">
                      No tracked stock yet.
                    </td>
                  </tr>
                ) : (
                  rows.map((r) => (
                    <tr key={r.variant_id} className="border-t border-gray-100">
                      <td className="px-4 py-3 text-gray-900">{r.product_name}</td>
                      <td className="px-4 py-3 text-gray-700">{r.colour_name ?? '—'}</td>
                      <td className="px-4 py-3 text-gray-700">{r.size_label ?? '—'}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{r.available_qty}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{r.stock_qty}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{r.committed_qty}</td>
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          onClick={() => setVariantFilter(r.variant_id)}
                          className="rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-900 hover:bg-gray-200"
                        >
                          View
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* Audit feed */}
        <section>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-medium text-gray-700">
              Stock movements{variantFilter ? ' · filtered to one variant' : ''}
            </h2>
            {variantFilter && (
              <button
                type="button"
                onClick={() => setVariantFilter(null)}
                className="rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-900 hover:bg-gray-200"
              >
                Clear filter
              </button>
            )}
          </div>
          <div className="overflow-x-auto rounded-2xl bg-white">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-gray-500">
                <tr>
                  <th className="px-4 py-3 font-medium">When</th>
                  <th className="px-4 py-3 font-medium">Movement</th>
                  <th className="px-4 py-3 text-right font-medium">Δ Stock</th>
                  <th className="px-4 py-3 font-medium">Who</th>
                  <th className="px-4 py-3 font-medium">Where</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-gray-400">
                      Loading…
                    </td>
                  </tr>
                ) : visibleEntries.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-gray-500">
                      No movements recorded.
                    </td>
                  </tr>
                ) : (
                  visibleEntries.map((e) => (
                    <tr key={e.id} className="border-t border-gray-100">
                      <td className="px-4 py-3 text-gray-700 tabular-nums">
                        {new Date(e.createdAt).toLocaleDateString('en-NZ', {
                          day: 'numeric',
                          month: 'short',
                          year: 'numeric',
                        })}
                      </td>
                      <td className="px-4 py-3 text-gray-700">
                        {e.reason}
                        {e.note ? <span className="text-gray-400"> · {e.note}</span> : null}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">{e.deltaStock}</td>
                      <td className="px-4 py-3 text-gray-900">{e.who}</td>
                      <td className="px-4 py-3 text-gray-700">{e.where ?? '—'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- app/(portal)/inventory/__tests__/InventoryClient.test.tsx`
Expected: PASS.

- [ ] **Step 5: Write the server page (gate) + loading**

Create `app/(portal)/inventory/page.tsx`:

```tsx
import { redirect } from 'next/navigation'
import { getCompanyAccess } from '@/lib/company'
import { InventoryClient } from './InventoryClient'

const INVENTORY_TENANTS = ['franchise', 'studio_plus_inventory'] as const

export default async function InventoryPage() {
  const access = await getCompanyAccess()
  const tenant = access?.tenantType
  const allowed =
    !!access &&
    access.isOrgAdmin &&
    !!tenant &&
    (INVENTORY_TENANTS as ReadonlyArray<string>).includes(tenant)
  if (!allowed) redirect('/catalogue')

  return <InventoryClient />
}
```

> **Verified:** `getCompanyAccess` is exported from `lib/company.ts:18` (async) and returns `isOrgAdmin` + `tenantType` — the gate above is correct as written, no build-time confirmation needed. (Same access shape `requireB2BCustomerApi` exposes as `context.role`/`context.tenantType`, used by the Task 3 audit-route gate.)

Create `app/(portal)/inventory/loading.tsx`:

```tsx
export default function Loading() {
  return (
    <div className="min-h-screen bg-[#FAFAFA]">
      <div className="mx-auto max-w-[1320px] px-4 pb-16 pt-[100px] md:px-6 md:pt-[120px]">
        <div className="mb-10 h-16 w-64 animate-pulse rounded-2xl bg-gray-200" />
        <div className="mb-6 h-64 w-full animate-pulse rounded-2xl bg-gray-100" />
        <div className="h-64 w-full animate-pulse rounded-2xl bg-gray-100" />
      </div>
    </div>
  )
}
```

- [ ] **Step 6: Run the full suite + build**

Run: `npm test` then `npm run build`
Expected: all tests PASS; build succeeds (the `/inventory` route compiles, no type errors).

- [ ] **Step 7: Commit**

```bash
git add "app/(portal)/inventory/page.tsx" "app/(portal)/inventory/InventoryClient.tsx" "app/(portal)/inventory/loading.tsx" "app/(portal)/inventory/__tests__/InventoryClient.test.tsx"
git commit -m "feat(inventory): org-admin Inventory page — stock table + audit feed with per-variant filter"
```

---

## Task 5: Manual verification (gate before merge)

> No code. Confirms gating + real data resolution.

- [ ] **Step 1: Visibility gate**

Sign in as an org_admin of an inventory tenant (franchise / studio_plus_inventory) → **Inventory** appears in the sidebar drawer, links to `/inventory`. Sign in as a non-admin member of the same org → no Inventory link; navigating directly to `/inventory` redirects to `/catalogue`. Sign in as an org_admin of a plain `studio` tenant → no Inventory link.

- [ ] **Step 2: Stock table**

The stock table shows the org's variants with available / in-stock / committed (mirrors the staff inventory page). Empty orgs show the empty state, not an error.

- [ ] **Step 3: Audit resolution (the headline)**

For an org with `order_commit` events, confirm each movement shows a real **Who** (the order placer's name, via `quotes.created_by`) and a **Where** (ship-to store) — NOT blank. For a manual `intake`/`count_correction` event, **Who** shows the staff name or "Print Room" and **Where** is "—". Cross-check one row against the DB:

```sql
select e.reason, e.delta_stock, p.full_name as who, s.name as where_to, e.created_at
from variant_inventory_events e
left join quote_items qi on qi.id = e.reference_quote_item_id
left join quotes q on q.id = qi.quote_id
left join profiles p on p.id = q.created_by
left join stores s on s.id = qi.ship_to_store_id
where e.organization_id = 'YOUR_ORG_ID'
order by e.created_at desc limit 10;
```

- [ ] **Step 4: Per-variant filter**

Click **View** on a stock row → the audit feed filters to that variant; **Clear filter** restores the full feed.

- [ ] **Step 5: Commit the verification note**

```bash
git commit --allow-empty -m "chore(inventory): manual verification — gating, stock table, audit who/where resolved"
```

---

## Open questions for Chris (non-blocking; defaults shipped)

- Audit granularity: org-wide feed + per-variant filter (shipped). Per-variant-only drill-in if preferred.
- Manual staff adjustments shown alongside order movements, labelled by source (shipped — full transparency).
- CSV export — deferred to v2.

## Out of scope

- Customer-side stock adjustments / counts (staff-portal only).
- CSV export (v2).
- Re-pricing or any write path — this view is read-only.

## Self-review checklist (run before handing off)

- [ ] Spec coverage: nav link + gate (T1), stock table (T4, reuses `/api/inventory`), audit feed (T2+T3+T4), who=`quotes.created_by` (T2/T3), where=`ship_to_store_id` (T2/T3), read-only (no write paths), no schema change. ✅
- [ ] No placeholders — full code in every step; the `getCompanyAccess` export is verified (`lib/company.ts:18`, returns `isOrgAdmin` + `tenantType`), no open assumptions. Task 1 + Task 4 carry collision guards for the same-day sprint nav/page.
- [ ] Type consistency: `AuditEntry` produced by `lib/inventory/audit.ts` is consumed unchanged by the route and the client; `CustomerInventoryRow` imported from the existing `/api/inventory` route; `NavAccess` projection matches `B2BCustomerAccess` field names (`isCompanyUser`, `canUseLeavers`, `isOrgAdmin`, `tenantType`).
