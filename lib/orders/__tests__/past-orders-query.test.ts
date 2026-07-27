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
      branchStoreIds: [],
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
      branchStoreIds: [],
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
      branchStoreIds: [],
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
      branchStoreIds: [],
    })
    expect(rows).toEqual([])
  })
})

function mockClientOr(recordOr: (arg: string) => void) {
  const b: Record<string, unknown> = {
    select: vi.fn(() => b),
    eq: vi.fn(() => b),
    or: vi.fn((arg: string) => {
      recordOr(arg)
      return b
    }),
    order: vi.fn(async () => ({ data: [row()], error: null })),
  }
  return { from: vi.fn(() => b) }
}

describe('queryPastOrders — manager branch scope', () => {
  it('manager: own-email OR ship_to_store_id IN granted branches, on quotes', async () => {
    const ors: string[] = []
    const client = mockClientOr((a) => ors.push(a))
    await queryPastOrders(client as never, {
      organizationId: 'org-1',
      canSeeAllOrgOrders: false,
      userEmail: 'mgr@x.co',
      branchStoreIds: ['s-1', 's-2'],
    })
    expect(ors[0]).toContain('customer_email.eq.mgr@x.co')
    expect(ors[0]).toContain('ship_to_store_id.in.(s-1,s-2)')
  })

  it('manager with no email still gets branch rows (does NOT fail closed)', async () => {
    const ors: string[] = []
    const client = mockClientOr((a) => ors.push(a))
    const rows = await queryPastOrders(client as never, {
      organizationId: 'org-1',
      canSeeAllOrgOrders: false,
      userEmail: null,
      branchStoreIds: ['s-1'],
    })
    expect(ors[0]).toBe('ship_to_store_id.in.(s-1)')
    expect(rows).toHaveLength(1)
  })

  it('plain staff (branchStoreIds: []) — byte-identical to today (eq only, no or)', async () => {
    const ors: string[] = []
    const client = mockClientOr((a) => ors.push(a))
    await queryPastOrders(client as never, {
      organizationId: 'org-1',
      canSeeAllOrgOrders: false,
      userEmail: 'staff@x.co',
      branchStoreIds: [],
    })
    expect(ors).toHaveLength(0)
  })
})
