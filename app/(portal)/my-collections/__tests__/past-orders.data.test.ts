import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ admin: { from: vi.fn() } }))

vi.mock('@/lib/supabase-server-component', () => ({
  getSupabaseServerComponent: vi.fn(async () => ({
    auth: { getUser: vi.fn(async () => ({ data: { user: { id: 'user-1', email: 'buyer@example.com' } } })) },
  })),
}))
vi.mock('@/lib/supabase', () => ({ getSupabaseServer: () => mocks.admin }))
vi.mock('next/cache', () => ({ unstable_cache: (fn: unknown) => fn }))

function builder(result: unknown) {
  const b: Record<string, unknown> = {
    select: vi.fn(() => b),
    eq: vi.fn(() => b),
    in: vi.fn(async () => result),
    order: vi.fn(async () => result),
    maybeSingle: vi.fn(async () => result),
  }
  return b
}

describe('getPortalPastOrdersData (Item 10)', () => {
  it('returns stock_on_hand orders with tracking overlaid from job_trackers', async () => {
    mocks.admin.from.mockImplementation((table: string) => {
      if (table === 'user_organizations')
        return builder({ data: { organization_id: 'org-1', role: 'org_admin' }, error: null })
      if (table === 'stores') return builder({ data: [], error: null })
      if (table === 'orders')
        return builder({
          data: [
            {
              id: 'order-1',
              status: 'shipped',
              order_type: 'purchase_order',
              created_at: '2026-05-15T00:00:00.000Z',
              quote_id: 'quote-1',
              quotes: {
                organization_id: 'org-1',
                created_by: 'user-1',
                order_ref: 'PR-1001',
                quote_number: 'Q-1',
                reference: null,
                customer_name: 'Buyer',
                customer_email: 'buyer@example.com',
                customer_company: 'PRT',
                customer_code: 'PRT',
                subtotal: 100,
                total_amount: 115,
                currency: 'NZD',
                picking_fee: null,
                billed_total: null,
              },
            },
          ],
          error: null,
        })
      if (table === 'job_trackers')
        return builder({
          data: [{ quote_id: 'quote-1', tracking_info: { carrier: 'NZ Post', trackingNumber: '1234567890', url: 'https://track/1234567890' } }],
          error: null,
        })
      return builder({ data: null, error: null })
    })

    const { getPortalPastOrdersData } = await import('@/lib/portal-data')
    const data = await getPortalPastOrdersData()
    expect(data.orders).toEqual([
      expect.objectContaining({
        orderId: 'order-1',
        orderRef: 'PR-1001',
        status: 'shipped',
        orderType: 'purchase_order',
        subtotal: 100,
        billed: 100, // billed_total NULL => falls back to goods value
        pickingFee: 0,
        totalAmount: 115,
        currency: 'NZD',
        tracking: { carrier: 'NZ Post', trackingNumber: '1234567890', url: 'https://track/1234567890' },
      }),
    ])
  })
})
