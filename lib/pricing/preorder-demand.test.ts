import { describe, it, expect, vi } from 'vitest'
import { getPreOrderDemandForItem } from './preorder-demand'

function adminReturning(data: unknown, error: unknown = null) {
  return {
    rpc: vi.fn(async () => ({ data, error })),
  } as never
}

describe('getPreOrderDemandForItem', () => {
  it('returns units + order count for the matching catalogue item', async () => {
    const admin = adminReturning([
      {
        catalogue_item_id: 'a',
        agg_qty: 124,
        order_count: 38,
        closes_at: '2026-08-21T12:00:00.000Z',
      },
      {
        catalogue_item_id: 'b',
        agg_qty: 5,
        order_count: 2,
        closes_at: '2026-08-21T12:00:00.000Z',
      },
    ])
    expect(await getPreOrderDemandForItem(admin, 'org-1', 'a')).toEqual({
      unitsOrdered: 124,
      orderCount: 38,
      closesAt: '2026-08-21T12:00:00.000Z',
    })
  })

  it('returns null when no row matches (no open period / not pre-order)', async () => {
    const admin = adminReturning([])
    expect(await getPreOrderDemandForItem(admin, 'org-1', 'a')).toBeNull()
  })

  it('coalesces null aggregates to zero', async () => {
    const admin = adminReturning([
      {
        catalogue_item_id: 'a',
        agg_qty: null,
        order_count: null,
        closes_at: '2026-08-21T12:00:00.000Z',
      },
    ])
    expect(await getPreOrderDemandForItem(admin, 'org-1', 'a')).toEqual({
      unitsOrdered: 0,
      orderCount: 0,
      closesAt: '2026-08-21T12:00:00.000Z',
    })
  })

  it('fails soft to null on RPC error', async () => {
    const admin = adminReturning(null, { message: 'boom' })
    expect(await getPreOrderDemandForItem(admin, 'org-1', 'a')).toBeNull()
  })
})
