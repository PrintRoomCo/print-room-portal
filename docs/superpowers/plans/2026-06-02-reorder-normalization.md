# Reorder Normalization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the "Reorder" button on a completed portal order into a catalogue-aware cart-rebuild that re-prices fresh through normal checkout — retiring the Monday-silo reorder for orders that carry a `quote_id`.

**Architecture:** New portal orders already materialise a `job_trackers` shell carrying `quote_id` (`lib/orders/job-tracker.ts`, called from `submit.ts` step 4c). So the existing `/order-tracker` surface *is* the past-orders list. We branch the Reorder button: trackers **with** a `quote_id` rebuild a cart from `quote_items` (mapped → `addLine` → `/cart`), re-priced via `effective_unit_price`; trackers **without** one (legacy chatbot/Monday orders) keep the existing `ReorderForm` modal untouched. No schema change. The rebuild never restores the historical snapshot price — the cart + `submit_b2b_order` re-run every pricing/MOQ/stock/access guard for free.

**Tech Stack:** Next.js 16 App Router, React 19, Supabase (service-role admin client), Vitest 2.

**Rename-independence:** This plan gates on `isOrgAdmin` + `tracker.quote_id`, both *derived* (`isOrgAdmin` = `role === 'org_admin'`, not the `buyer`/`staff` value the rename touches), so it is unaffected by the role-rename sprint item. The Reorder *button* is **org-admin-only** — staff are restricted to From-inventory ordering and must not re-buy a past order that may contain `make_to_stock` lines (gate covers BOTH the rebuild and the legacy-Monday branches). The separate Reorder *pill* on the PDP is gated by the Chris-notes sprint.

---

## Spec

Source: [`docs/superpowers/specs/2026-06-02-reorder-normalization-design.md`](../specs/2026-06-02-reorder-normalization-design.md)

## Verified preconditions (Supabase MCP, 2026-06-02)

- `quote_items` has **57 rows / 16 quotes** (the spec's "empty in prod" note is stale).
- `variant_id` is non-null on **56/57** rows → the linchpin holds; the 1 null is handled as a degraded line, not a blocker.
- All 57 existing rows are **pre-catalogue**: `catalogue_item_id`, `catalogue_variant_label`, `route_to_inventory` are unset; `qty_to_make>0` on 43, `qty_from_stock>0` on 14. So the rebuild resolves the colour/size label via the `product_variants` join (as `submit.ts`/`job-tracker.ts` already do) and treats `catalogue_item_id`/`catalogue_variant_label` as best-effort.
- Only **1** `job_trackers` row has a non-null `quote_id` so far (the new shell path is live but barely exercised) — expected; this plan grows that population.
- `quote_items.decorations` is `jsonb NOT NULL`, persisted by `submit.ts` step 4 as validated `CartLineDecoration` snapshots → safe to pass straight back to `addLine`.
- `effective_unit_price(p_product_id, p_org_id, p_qty)` is the canonical re-price RPC (`submit.ts:440`).

## File Structure

- **Create** `lib/reorder/rebuild.ts` — pure mapper: `quote_items` join rows → cart-add payloads (`RebuildLine`). No I/O, no pricing. The TDD core.
- **Create** `lib/reorder/__tests__/rebuild.test.ts` — unit tests for the mapper.
- **Create** `app/api/reorder/rebuild/route.ts` — POST `{ quoteId }`: auth, org-scope guard, fetch `quote_items` (+ variant labels, + product images via separate `.in`), fresh per-product price, return `{ lines, degradedCount }`.
- **Create** `app/api/reorder/rebuild/__tests__/route.test.ts` — org-scope reject + happy-path mapping/pricing.
- **Create** `components/orders/ReorderButton.tsx` — client component encapsulating BOTH branches (rebuild vs legacy modal). Replaces the inline Reorder `<button>` + modal block in the card.
- **Modify** `components/orders/JobTrackerOrderCard.tsx` — replace the inline Reorder button + `Dialog` modal block with `<ReorderButton tracker={tracker} />`.

> **Why a separate `ReorderButton`:** `JobTrackerOrderCard` is a presentational card. Folding cart + router + fetch into it bloats it and couples the legacy modal state to the new flow. A focused client component keeps each branch readable and lets the legacy path stay byte-for-byte unchanged.

---

## Task 1: Pure rebuild mapper

**Files:**
- Create: `lib/reorder/rebuild.ts`
- Test: `lib/reorder/__tests__/rebuild.test.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/reorder/__tests__/rebuild.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  buildRebuildLines,
  deriveFulfilmentType,
  type QuoteItemRebuildRow,
} from '../rebuild'

function row(over: Partial<QuoteItemRebuildRow> = {}): QuoteItemRebuildRow {
  return {
    product_id: over.product_id ?? 'p1',
    variant_id: 'variant_id' in over ? over.variant_id! : 'v1',
    product_name: over.product_name ?? 'Basic Tee',
    quantity: over.quantity ?? 10,
    decorations: 'decorations' in over ? over.decorations : [],
    ship_to_store_id: over.ship_to_store_id ?? null,
    catalogue_item_id: over.catalogue_item_id ?? null,
    catalogue_variant_label: over.catalogue_variant_label ?? null,
    qty_from_stock: over.qty_from_stock ?? 0,
    qty_to_make: over.qty_to_make ?? 0,
    colour_label: over.colour_label ?? null,
    size_label: over.size_label ?? null,
    image_url: over.image_url ?? null,
  }
}

describe('deriveFulfilmentType', () => {
  it('is make_to_stock when any qty is destined for production', () => {
    expect(deriveFulfilmentType({ qty_to_make: 5 })).toBe('make_to_stock')
  })
  it('is stocked when nothing is made (pure stock draw)', () => {
    expect(deriveFulfilmentType({ qty_to_make: 0 })).toBe('stocked')
  })
})

describe('buildRebuildLines', () => {
  it('maps colour + size join into "Colour / Size"', () => {
    const { lines } = buildRebuildLines([row({ colour_label: 'Bone', size_label: 'M' })])
    expect(lines[0].variantLabel).toBe('Bone / M')
  })

  it('falls back to catalogue_variant_label when the variant join is empty', () => {
    const { lines } = buildRebuildLines([
      row({ colour_label: null, size_label: null, catalogue_variant_label: 'Design A' }),
    ])
    expect(lines[0].variantLabel).toBe('Design A')
  })

  it('falls back to "—" when nothing resolves a label', () => {
    const { lines } = buildRebuildLines([row({ colour_label: null, size_label: null })])
    expect(lines[0].variantLabel).toBe('—')
  })

  it('carries product, qty, store, catalogue identity and image straight through', () => {
    const { lines } = buildRebuildLines([
      row({
        product_id: 'p9',
        quantity: 24,
        ship_to_store_id: 'store-1',
        catalogue_item_id: 'ci-1',
        catalogue_variant_label: 'Design A',
        image_url: 'https://img/x.png',
      }),
    ])
    expect(lines[0]).toMatchObject({
      productId: 'p9',
      qty: 24,
      shipToStoreId: 'store-1',
      catalogueItemId: 'ci-1',
      catalogueVariantLabel: 'Design A',
      imageUrl: 'https://img/x.png',
      unitPrice: 0,
    })
  })

  it('counts a null variant_id as a degraded line but still emits it (variantless)', () => {
    const { lines, degradedCount } = buildRebuildLines([row({ variant_id: null })])
    expect(degradedCount).toBe(1)
    expect(lines[0].variantId).toBe('')
  })

  it('drops rows with no product_id (cannot re-add or re-price)', () => {
    const { lines } = buildRebuildLines([row({ product_id: null })])
    expect(lines).toHaveLength(0)
  })

  it('passes through well-formed decoration snapshots and ignores malformed ones', () => {
    const good = { linkId: 'l1', decorationId: 'od1', name: 'Emb', method: 'embroidery', positionLabel: 'LC', unitPrice: 3, artworkUrl: 'a', snapshotUrl: null }
    const { lines } = buildRebuildLines([row({ decorations: [good, { nope: true }, null] })])
    expect(lines[0].decorations).toHaveLength(1)
    expect(lines[0].decorations[0].linkId).toBe('l1')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `print-room-portal/`): `npm test -- lib/reorder/__tests__/rebuild.test.ts`
Expected: FAIL — `Cannot find module '../rebuild'`.

- [ ] **Step 3: Write minimal implementation**

Create `lib/reorder/rebuild.ts`:

```ts
import type { CartLineDecoration, CartLineFulfilmentType } from '@/lib/cart/types'

/**
 * A `quote_items` row joined to its variant labels + product image, as fetched
 * by the rebuild route. Flat + serializable so the mapping is trivially testable
 * without a Supabase client.
 */
export interface QuoteItemRebuildRow {
  product_id: string | null
  variant_id: string | null
  product_name: string
  quantity: number
  decorations: unknown
  ship_to_store_id: string | null
  catalogue_item_id: string | null
  catalogue_variant_label: string | null
  qty_from_stock: number
  qty_to_make: number
  /** joined: product_variants.product_color_swatches.label */
  colour_label: string | null
  /** joined: product_variants.sizes.label */
  size_label: string | null
  /** resolved separately: products.image_url (product_id is text → no PostgREST embed) */
  image_url: string | null
}

/**
 * The cart-add payload. Matches the object shape passed to `cart.addLine` in
 * ProductDetailClient.tsx EXACTLY — minus `brackets`, which we deliberately
 * omit so the rebuilt line behaves like a legacy line (unitPrice stays until
 * checkout re-prices). `unitPrice` is filled with a fresh effective price by the
 * route; the mapper sets it to 0.
 */
export interface RebuildLine {
  productId: string
  productName: string
  variantId: string
  variantLabel: string
  qty: number
  unitPrice: number
  imageUrl: string | null
  shipToStoreId: string | null
  decorations: CartLineDecoration[]
  fulfilmentType: CartLineFulfilmentType
  catalogueItemId: string | null
  catalogueVariantLabel: string | null
}

export interface BuildRebuildResult {
  lines: RebuildLine[]
  /** Lines whose `variant_id` was null — surfaced so the UI can warn. */
  degradedCount: number
}

/**
 * A line is 'make_to_stock' if any quantity is destined for a new production
 * run; otherwise it draws purely from existing stock ('stocked'). Mixed lines
 * (both > 0) collapse to 'make_to_stock' — the conservative choice that keeps
 * MOQ applicable, matching submit.ts's MOQ treatment.
 */
export function deriveFulfilmentType(row: { qty_to_make: number }): CartLineFulfilmentType {
  return row.qty_to_make > 0 ? 'make_to_stock' : 'stocked'
}

function variantLabelFrom(row: QuoteItemRebuildRow): string {
  const parts = [row.colour_label, row.size_label].filter(Boolean)
  if (parts.length > 0) return parts.join(' / ')
  return row.catalogue_variant_label ?? '—'
}

function decorationsFrom(raw: unknown): CartLineDecoration[] {
  if (!Array.isArray(raw)) return []
  return raw.filter(
    (d): d is CartLineDecoration =>
      !!d && typeof d === 'object' && typeof (d as { linkId?: unknown }).linkId === 'string',
  )
}

export function buildRebuildLines(rows: QuoteItemRebuildRow[]): BuildRebuildResult {
  let degradedCount = 0
  const lines: RebuildLine[] = rows
    .filter((r) => typeof r.product_id === 'string' && r.product_id.length > 0)
    .map((r) => {
      if (!r.variant_id) degradedCount++
      return {
        productId: r.product_id as string,
        productName: r.product_name,
        variantId: r.variant_id ?? '',
        variantLabel: variantLabelFrom(r),
        qty: r.quantity,
        unitPrice: 0,
        imageUrl: r.image_url,
        shipToStoreId: r.ship_to_store_id,
        decorations: decorationsFrom(r.decorations),
        fulfilmentType: deriveFulfilmentType(r),
        catalogueItemId: r.catalogue_item_id,
        catalogueVariantLabel: r.catalogue_variant_label,
      }
    })
  return { lines, degradedCount }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- lib/reorder/__tests__/rebuild.test.ts`
Expected: PASS (all cases green).

- [ ] **Step 5: Commit**

```bash
git checkout -b feat/reorder-normalization
git add lib/reorder/rebuild.ts lib/reorder/__tests__/rebuild.test.ts
git commit -m "feat(reorder): pure quote_items → cart-line rebuild mapper"
```

---

## Task 2: Rebuild API route

**Files:**
- Create: `app/api/reorder/rebuild/route.ts`
- Test: `app/api/reorder/rebuild/__tests__/route.test.ts`

**Contract:** `POST /api/reorder/rebuild` with `{ quoteId: string }`. Verifies the quote belongs to the caller's org; returns `{ lines: RebuildLine[], degradedCount: number }` with `unitPrice` freshly resolved per `(product, decoration set)` at that key's total qty — the same aggregation key `submit.ts` and the cart's `recomputeProductTierPrices` use.

- [ ] **Step 1: Write the failing test**

Create `app/api/reorder/rebuild/__tests__/route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/checkout/server', () => ({
  requireB2BCustomerApi: vi.fn(),
}))

import { POST } from '../route'
import { requireB2BCustomerApi } from '@/lib/checkout/server'

const ORG = 'org-1'
const OTHER_ORG = 'org-2'
const QUOTE = 'quote-1'

type AnyRow = Record<string, unknown>

/** Minimal chainable Supabase stub: per-table select responses + rpc fn. */
function makeAdmin(opts: {
  selects: Record<string, { data: unknown; error: { message: string } | null }>
  rpc?: (name: string, args: AnyRow) => { data: unknown; error: null }
}) {
  function builder(table: string) {
    const resp = opts.selects[table] ?? { data: [], error: null }
    const b: AnyRow = {
      select: () => b,
      eq: () => b,
      in: () => b,
      maybeSingle: async () => resp,
      then: (res: (v: unknown) => unknown) => Promise.resolve(resp).then(res),
    }
    return b
  }
  return {
    from: vi.fn((t: string) => builder(t)),
    rpc: vi.fn(async (name: string, args: AnyRow) =>
      opts.rpc ? opts.rpc(name, args) : { data: 0, error: null },
    ),
  } as unknown as Parameters<typeof POST> // structural only
}

function req(body: unknown): Request {
  return new Request('http://t/api/reorder/rebuild', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

beforeEach(() => vi.clearAllMocks())

describe('POST /api/reorder/rebuild', () => {
  it('404s when the quote belongs to another org', async () => {
    const admin = makeAdmin({
      selects: { quotes: { data: { id: QUOTE, organization_id: OTHER_ORG }, error: null } },
    })
    vi.mocked(requireB2BCustomerApi).mockResolvedValue({
      admin,
      context: { organizationId: ORG },
    } as never)

    const res = await POST(req({ quoteId: QUOTE }))
    expect(res.status).toBe(404)
  })

  it('rebuilds + freshly prices the lines for an in-org quote', async () => {
    const admin = makeAdmin({
      selects: {
        quotes: { data: { id: QUOTE, organization_id: ORG }, error: null },
        quote_items: {
          data: [
            {
              product_id: 'p1',
              variant_id: 'v1',
              product_name: 'Basic Tee',
              quantity: 30,
              decorations: [],
              ship_to_store_id: null,
              catalogue_item_id: null,
              catalogue_variant_label: null,
              qty_from_stock: 0,
              qty_to_make: 30,
              product_variants: { product_color_swatches: { label: 'Bone' }, sizes: { label: 'M' } },
            },
          ],
          error: null,
        },
        products: { data: [{ id: 'p1', image_url: 'https://img/p1.png' }], error: null },
      },
      rpc: (name, args) => {
        expect(name).toBe('effective_unit_price')
        expect(args.p_qty).toBe(30)
        return { data: 12.54, error: null }
      },
    })
    vi.mocked(requireB2BCustomerApi).mockResolvedValue({
      admin,
      context: { organizationId: ORG },
    } as never)

    const res = await POST(req({ quoteId: QUOTE }))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.lines).toHaveLength(1)
    expect(json.lines[0]).toMatchObject({
      productId: 'p1',
      variantLabel: 'Bone / M',
      qty: 30,
      unitPrice: 12.54,
      imageUrl: 'https://img/p1.png',
      fulfilmentType: 'make_to_stock',
    })
    expect(json.degradedCount).toBe(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- app/api/reorder/rebuild/__tests__/route.test.ts`
Expected: FAIL — `Cannot find module '../route'`.

- [ ] **Step 3: Write minimal implementation**

Create `app/api/reorder/rebuild/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { requireB2BCustomerApi } from '@/lib/checkout/server'
import { decorationSignature } from '@/lib/cart/types'
import {
  buildRebuildLines,
  type QuoteItemRebuildRow,
  type RebuildLine,
} from '@/lib/reorder/rebuild'

function pickOne<T>(v: T | T[] | null | undefined): T | null {
  if (v == null) return null
  return Array.isArray(v) ? v[0] ?? null : v
}

export async function POST(request: Request) {
  const auth = await requireB2BCustomerApi()
  if ('error' in auth) return auth.error

  let body: { quoteId?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const quoteId = body.quoteId
  if (!quoteId || typeof quoteId !== 'string') {
    return NextResponse.json({ error: 'quoteId required' }, { status: 400 })
  }

  // Org-scope guard — the quote MUST belong to the caller's org (prevents IDOR).
  const { data: quote, error: quoteErr } = await auth.admin
    .from('quotes')
    .select('id, organization_id')
    .eq('id', quoteId)
    .maybeSingle()
  if (quoteErr) return NextResponse.json({ error: quoteErr.message }, { status: 500 })
  if (!quote || quote.organization_id !== auth.context.organizationId) {
    return NextResponse.json({ error: 'Order not found' }, { status: 404 })
  }

  // variant labels embed cleanly (variant_id is a real FK to product_variants);
  // product images do NOT (product_id is a text column → no PostgREST embed),
  // so they are fetched separately by id, mirroring lib/orders/job-tracker.ts.
  const { data: itemRows, error: itemsErr } = await auth.admin
    .from('quote_items')
    .select(
      `product_id, variant_id, product_name, quantity, decorations,
       ship_to_store_id, catalogue_item_id, catalogue_variant_label,
       qty_from_stock, qty_to_make,
       product_variants ( product_color_swatches(label), sizes(label) )`,
    )
    .eq('quote_id', quoteId)
  if (itemsErr) return NextResponse.json({ error: itemsErr.message }, { status: 500 })

  const raw = (itemRows ?? []) as Array<Record<string, unknown>>

  const productIds = Array.from(
    new Set(
      raw
        .map((r) => r.product_id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0),
    ),
  )
  const imageByProductId = new Map<string, string | null>()
  if (productIds.length > 0) {
    const { data: products } = await auth.admin
      .from('products')
      .select('id, image_url')
      .in('id', productIds)
    for (const p of (products ?? []) as Array<{ id: string; image_url: string | null }>) {
      imageByProductId.set(p.id, p.image_url)
    }
  }

  const rows: QuoteItemRebuildRow[] = raw.map((r) => {
    const pv = pickOne(r.product_variants as unknown)
    const swatch = pv ? pickOne((pv as Record<string, unknown>).product_color_swatches) : null
    const size = pv ? pickOne((pv as Record<string, unknown>).sizes) : null
    const productId = typeof r.product_id === 'string' ? r.product_id : null
    return {
      product_id: productId,
      variant_id: (r.variant_id as string | null) ?? null,
      product_name: (r.product_name as string) ?? 'Item',
      quantity: Number(r.quantity ?? 0),
      decorations: r.decorations,
      ship_to_store_id: (r.ship_to_store_id as string | null) ?? null,
      catalogue_item_id: (r.catalogue_item_id as string | null) ?? null,
      catalogue_variant_label: (r.catalogue_variant_label as string | null) ?? null,
      qty_from_stock: Number(r.qty_from_stock ?? 0),
      qty_to_make: Number(r.qty_to_make ?? 0),
      colour_label: (swatch as { label?: string } | null)?.label ?? null,
      size_label: (size as { label?: string } | null)?.label ?? null,
      image_url: productId ? imageByProductId.get(productId) ?? null : null,
    }
  })

  const { lines, degradedCount } = buildRebuildLines(rows)

  // Fresh price — never restore the historical snapshot. Aggregate qty by the
  // SAME key submit.ts (lib/checkout/submit.ts:423) and the cart's
  // recomputeProductTierPrices use: `${product_id}::${decorationSignature}`. A
  // product split across two decoration sets then tiers each set on its own qty,
  // so our display price matches what the cart recomputes on /cart (no flicker).
  // effective_unit_price is keyed by product_id (decoration price is layered by
  // the cart), so we price per product but at the per-signature total qty — the
  // productId is the key prefix up to the first "::" (signatures never contain it).
  const aggKey = (l: RebuildLine) => `${l.productId}::${decorationSignature(l.decorations)}`
  const totalQtyByKey = new Map<string, number>()
  for (const l of lines) {
    const k = aggKey(l)
    totalQtyByKey.set(k, (totalQtyByKey.get(k) ?? 0) + l.qty)
  }
  const priceByKey = new Map<string, number>()
  await Promise.all(
    Array.from(totalQtyByKey.entries()).map(async ([key, totalQty]) => {
      const productId = key.slice(0, key.indexOf('::'))
      const { data: unit } = await auth.admin.rpc('effective_unit_price', {
        p_product_id: productId,
        p_org_id: auth.context.organizationId,
        p_qty: totalQty,
      })
      priceByKey.set(key, Number(unit ?? 0))
    }),
  )

  const priced: RebuildLine[] = lines.map((l) => ({
    ...l,
    unitPrice: priceByKey.get(aggKey(l)) ?? 0,
  }))

  return NextResponse.json({ lines: priced, degradedCount })
}
```

> **Test note:** the happy-path test stubs a single line whose `effective_unit_price` is called with `p_qty: 30`. Its decorations are empty, so its agg key is `p1::` and the summed qty is just its own. If you add a multi-line fixture sharing a product **and** decoration set, assert the RPC is called once per `(product, decorationSignature)` key at the summed qty (mirroring submit.ts); two lines with the SAME product but DIFFERENT decorations price independently.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- app/api/reorder/rebuild/__tests__/route.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/api/reorder/rebuild/route.ts app/api/reorder/rebuild/__tests__/route.test.ts
git commit -m "feat(reorder): rebuild API route — org-scoped quote_items fetch + fresh re-price"
```

---

## Task 3: ReorderButton client component (branch on quote_id)

**Files:**
- Create: `components/orders/ReorderButton.tsx`
- Modify: `components/orders/JobTrackerOrderCard.tsx` (replace inline button + modal with `<ReorderButton>`)

- [ ] **Step 1: Write the failing test (component branch logic)**

Create `components/orders/__tests__/ReorderButton.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const addLine = vi.fn()
const push = vi.fn()
// Hoisted so the (hoisted) vi.mock factory can read it and each test can flip
// the role. Default org_admin so the existing branch tests see the button.
const company = vi.hoisted(() => ({ isOrgAdmin: true }))
vi.mock('@/components/cart/useCart', () => ({ useCart: () => ({ addLine }) }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))
// Legacy modal path renders ReorderForm — stub it so this test stays focused.
vi.mock('@/components/orders/ReorderForm', () => ({
  ReorderForm: () => <div data-testid="legacy-reorder-form" />,
}))
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { email: 'a@b.test' } }) }))
vi.mock('@/contexts/CompanyContext', () => ({
  useCompany: () => ({ access: { isOrgAdmin: company.isOrgAdmin } }),
}))

import { ReorderButton } from '../ReorderButton'
import type { JobTracker } from '@/lib/job-tracker'

function tracker(over: Partial<JobTracker> = {}): JobTracker {
  return { id: 1, status: 'completed', quote_id: null, ...over } as unknown as JobTracker
}

beforeEach(() => {
  vi.clearAllMocks()
  company.isOrgAdmin = true
  vi.stubGlobal('fetch', vi.fn())
})

describe('ReorderButton', () => {
  it('rebuilds the cart and routes to /cart for a quote_id-linked order', async () => {
    ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({
        lines: [{ productId: 'p1', qty: 10, variantId: 'v1', variantLabel: 'Bone / M' }],
        degradedCount: 0,
      }),
    })

    render(<ReorderButton tracker={tracker({ quote_id: 'q-1' })} />)
    await userEvent.click(screen.getByRole('button', { name: /reorder/i }))

    await waitFor(() => expect(addLine).toHaveBeenCalledTimes(1))
    expect(addLine).toHaveBeenCalledWith(
      expect.objectContaining({ productId: 'p1', variantLabel: 'Bone / M' }),
    )
    expect(push).toHaveBeenCalledWith('/cart')
    expect(screen.queryByTestId('legacy-reorder-form')).toBeNull()
  })

  it('opens the legacy Monday modal for an order with no quote_id', async () => {
    render(<ReorderButton tracker={tracker({ quote_id: null })} />)
    await userEvent.click(screen.getByRole('button', { name: /reorder/i }))
    expect(screen.getByTestId('legacy-reorder-form')).toBeInTheDocument()
    expect(globalThis.fetch).not.toHaveBeenCalled()
    expect(addLine).not.toHaveBeenCalled()
  })

  it('renders nothing for a non-admin (staff) member — gate covers both branches', () => {
    company.isOrgAdmin = false
    const { container } = render(<ReorderButton tracker={tracker({ quote_id: 'q-1' })} />)
    expect(screen.queryByRole('button', { name: /reorder/i })).toBeNull()
    expect(container).toBeEmptyDOMElement()
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- components/orders/__tests__/ReorderButton.test.tsx`
Expected: FAIL — `Cannot find module '../ReorderButton'`.

- [ ] **Step 3: Write minimal implementation**

Create `components/orders/ReorderButton.tsx`. This lifts the existing modal markup out of `JobTrackerOrderCard` verbatim for the legacy branch and adds the rebuild branch:

```tsx
'use client'

import * as Dialog from '@radix-ui/react-dialog'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ReorderForm } from '@/components/orders/ReorderForm'
import { useCart } from '@/components/cart/useCart'
import { useAuth } from '@/contexts/AuthContext'
import { useCompany } from '@/contexts/CompanyContext'
import type { JobTracker } from '@/lib/job-tracker'

interface ReorderButtonProps {
  tracker: JobTracker
}

const PILL =
  'rounded-full bg-gray-100 px-3 py-1.5 text-xs text-gray-900 transition-all duration-150 hover:bg-gray-200 active:scale-[0.98] disabled:opacity-60'

export function ReorderButton({ tracker }: ReorderButtonProps) {
  const { user } = useAuth()
  const { access } = useCompany()
  const cart = useCart()
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showLegacyModal, setShowLegacyModal] = useState(false)
  const [reorderSuccess, setReorderSuccess] = useState(false)

  const isCatalogueOrder = Boolean(tracker.quote_id)

  // Org-admin only. Staff (renamed `buyer`) are restricted to From-inventory
  // ordering, so they must not re-buy a past order that may contain
  // `make_to_stock` (production) lines via EITHER branch (rebuild or legacy
  // modal). Gated on derived `isOrgAdmin`, so the buyer→staff rename does not
  // touch it. Placed AFTER all hooks so the early return never reorders hooks.
  if (!(access?.isOrgAdmin ?? false)) return null

  async function rebuildCart() {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/reorder/rebuild', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quoteId: tracker.quote_id }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || 'Could not rebuild this order')
      }
      const data: { lines: Array<Parameters<typeof cart.addLine>[0]>; degradedCount: number } =
        await res.json()
      for (const line of data.lines) cart.addLine(line)
      router.push('/cart')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not rebuild this order')
      setBusy(false)
    }
  }

  function closeLegacyModal() {
    setShowLegacyModal(false)
    setReorderSuccess(false)
  }

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          if (isCatalogueOrder) {
            void rebuildCart()
          } else {
            setReorderSuccess(false)
            setShowLegacyModal(true)
          }
        }}
        disabled={busy}
        className={PILL}
      >
        {busy ? 'Rebuilding…' : 'Reorder'}
      </button>
      {error && (
        <span role="alert" className="ml-2 text-xs text-red-600">
          {error}
        </span>
      )}

      {/* Legacy Monday-silo modal — unchanged behaviour, only for orders with no quote_id. */}
      <Dialog.Root
        open={showLegacyModal}
        onOpenChange={(open) => {
          if (!open) closeLegacyModal()
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="glass-modal-backdrop" />
          <Dialog.Content className="glass-modal-content fixed left-1/2 top-1/2 z-[60] max-h-[90vh] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto">
            <div className="p-6">
              <div className="mb-4 flex items-center justify-between">
                <Dialog.Title className="text-xl font-bold text-gray-900">
                  Reorder project
                </Dialog.Title>
                <Dialog.Close asChild>
                  <button
                    type="button"
                    className="text-gray-400 transition-colors hover:text-gray-600"
                    aria-label="Close"
                  >
                    <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </Dialog.Close>
              </div>

              {reorderSuccess ? (
                <div className="py-6 text-center">
                  <p className="text-sm text-gray-700">
                    Once you&apos;ve submitted this information, your account manager will reach out
                    to confirm pricing and send an updated proof for your approval.
                  </p>
                </div>
              ) : user?.email ? (
                <ReorderForm
                  tracker={tracker}
                  userEmail={user.email}
                  onSubmitted={() => {
                    setReorderSuccess(true)
                    setTimeout(closeLegacyModal, 4000)
                  }}
                  onCancel={closeLegacyModal}
                />
              ) : (
                <p className="text-sm text-gray-600">
                  Your session has expired. Please sign in again to submit a reorder.
                </p>
              )}
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- components/orders/__tests__/ReorderButton.test.tsx`
Expected: PASS (both branches).

- [ ] **Step 5: Wire it into the card**

In `components/orders/JobTrackerOrderCard.tsx`:

1. Remove now-unused imports `import * as Dialog from '@radix-ui/react-dialog'` and `import { ReorderForm } from '@/components/orders/ReorderForm'`; add `import { ReorderButton } from '@/components/orders/ReorderButton'`.
2. Delete the `showReorderModal` / `reorderSuccess` state and `closeReorderModal` helper (lines 28-29, 40-43).
3. Replace the Reorder `<button>` block (current lines 82-94) with:

```tsx
{completed && <ReorderButton tracker={tracker} />}
```

`ReorderButton` self-gates on `isOrgAdmin` (returns `null` for staff), so the card needs no role check of its own — and the card no longer imports `useCompany`/`useAuth` for this.

4. Delete the entire `{/* Reorder Modal */}` `Dialog.Root` block (current lines 155-216).

- [ ] **Step 6: Run the full suite + typecheck**

Run: `npm test` then `npm run build`
Expected: all tests PASS; build succeeds (no unused-import or type errors in the card).

- [ ] **Step 7: Commit**

```bash
git add components/orders/ReorderButton.tsx components/orders/__tests__/ReorderButton.test.tsx components/orders/JobTrackerOrderCard.tsx
git commit -m "feat(reorder): branch Reorder button — cart-rebuild for catalogue orders, Monday modal for legacy"
```

---

## Task 4: Manual E2E verification (gate before merge)

> No code. This confirms the linchpin end-to-end now that a catalogue order can actually be placed, and that re-pricing/guards behave.

- [ ] **Step 1: Place a fresh catalogue order**

As an org_admin of a catalogue-scoped org (e.g. PRT "Test Catalogue"), add a catalogue product (with a real colour/size variant) to cart and complete `/checkout`. Land on the confirmation page.

- [ ] **Step 2: Confirm the order persisted re-orderably**

Run via Supabase MCP (`execute_sql`), substituting the new order's quote:

```sql
select qi.product_id, qi.variant_id, qi.catalogue_item_id,
       qi.qty_from_stock, qi.qty_to_make, qi.ship_to_store_id
from quote_items qi
join quotes q on q.id = qi.quote_id
where q.order_ref = 'YOUR_ORDER_REF';
```

Expected: `variant_id` non-null on variant lines; `catalogue_item_id` now populated (new catalogue path). If `variant_id` is null on a variant line, STOP — fix persistence in `submit.ts`/`submit_b2b_order` before shipping (the rebuild degrades those lines to variantless).

- [ ] **Step 3: Reorder through the UI**

Go to `/order-tracker`. The order's tracker (it has a `quote_id`) shows **Reorder**. Click it → confirm the cart fills with the same products/qtys/labels and routes to `/cart`. Confirm prices are **current** (not the historical snapshot), then submit and confirm the order posts through the normal approval gate.

- [ ] **Step 4: Confirm legacy is untouched + the role gate holds**

As an **org_admin**, find a legacy tracker (no `quote_id`) → **Reorder** still opens the Monday `ReorderForm` modal. Then sign in as a **staff** (non-admin) member of the same org and open `/order-tracker` → **no Reorder button appears on any order** (catalogue or legacy) — the gate covers both branches.

- [ ] **Step 5: Commit the verification note**

```bash
git commit --allow-empty -m "chore(reorder): manual E2E verified — variant_id persists, rebuild re-prices, legacy fallback intact"
```

---

## Out of scope (deferred to v2)

- **PDP deep-link** for single-product reorders (`/shop/[productId]?...`) — needs new searchParams→state plumbing in `ProductDetailClient` + `VariantPicker`. v1 always lands in the cart.
- **One-click "reorder placed"** — v1 deliberately lands in the cart for review/edit before submit.
- **Backfilling legacy job_trackers** with catalogue identity — the population only shrinks; no name→catalogue fuzzy matching.

## Self-review checklist (run before handing off)

- [ ] Every spec requirement maps to a task: cart-rebuild (T1+T2+T3), re-price fresh (T2 RPC, keyed by `product::decorationSignature` like submit.ts), org-admin-only gate covering both branches (T3), legacy Monday fallback (T3 branch), linchpin verification (T4). ✅
- [ ] No placeholders — all code blocks complete, all RPC params (`p_product_id/p_org_id/p_qty`) match `submit.ts`.
- [ ] Type consistency — `RebuildLine` fields match the `addLine` payload in `ProductDetailClient.tsx` (productId, productName, variantId, variantLabel, qty, unitPrice, imageUrl, decorations, fulfilmentType, catalogueItemId, catalogueVariantLabel); `brackets` intentionally omitted.
