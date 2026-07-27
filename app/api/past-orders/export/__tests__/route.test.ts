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
      role
        ? { data: { id: 'uo-1', organization_id: 'org-1', role, default_store_id: null }, error: null }
        : { data: null, error: null },
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
function grantsBuilder() {
  const b: Record<string, unknown> = {
    select: vi.fn(() => b),
    eq: vi.fn(async () => ({ data: [], error: null })),
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
    if (table === 'b2b_member_store_grants') return grantsBuilder()
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
    // Response.text() strips a leading BOM per the fetch spec \u2014 assert on the
    // raw bytes, which is what Excel actually receives.
    const bytes = new Uint8Array(await res.arrayBuffer())
    expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf])
    const body = new TextDecoder().decode(bytes)
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
