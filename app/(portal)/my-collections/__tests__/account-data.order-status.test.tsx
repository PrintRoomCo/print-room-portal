import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  admin: {
    from: vi.fn(),
  },
}))

vi.mock('@/lib/supabase-server-component', () => ({
  getSupabaseServerComponent: vi.fn(async () => ({
    auth: {
      getUser: vi.fn(async () => ({
        data: {
          user: {
            id: 'user-1',
            email: 'buyer@example.com',
          },
        },
      })),
    },
  })),
}))

vi.mock('@/lib/supabase', () => ({
  getSupabaseServer: () => mocks.admin,
}))

function queryResult(result: unknown) {
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    in: vi.fn(() => builder),
    order: vi.fn(async () => result),
    maybeSingle: vi.fn(async () => result),
  }
  return builder
}

describe('getPortalAccountData my-collections order status', () => {
  it('surfaces a newly submitted order as awaiting approval', async () => {
    mocks.admin.from.mockImplementation((table: string) => {
      if (table === 'user_organizations') {
        return queryResult({
          data: { organization_id: 'org-1' },
          error: null,
        })
      }
      if (table === 'stores') {
        return queryResult({ data: [], error: null })
      }
      if (table === 'quotes') {
        return queryResult({
          data: [
            {
              id: 'quote-1',
              reference: 'Q-1',
              quote_number: 'Q-1',
              status: 'submitted',
              customer_name: 'Buyer',
              customer_email: 'buyer@example.com',
              customer_company: 'PRT',
              subtotal: 100,
              total_amount: 115,
              currency: 'NZD',
              source: 'b2b-portal',
              created_at: '2026-05-15T00:00:00.000Z',
            },
          ],
          error: null,
        })
      }
      if (table === 'orders') {
        return queryResult({
          data: [
            {
              id: 'order-1',
              quote_id: 'quote-1',
              status: 'awaiting-approval',
            },
          ],
          error: null,
        })
      }
      return queryResult({ data: null, error: null })
    })

    const { getPortalAccountData } = await import('@/lib/portal-data')

    await expect(getPortalAccountData()).resolves.toMatchObject({
      recentQuotes: [
        {
          id: 'quote-1',
          status: 'awaiting-approval',
        },
      ],
    })
  })
})
