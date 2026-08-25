import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/checkout/server', () => ({ requireB2BCustomer: vi.fn() }))
vi.mock('@/lib/checkout/page-auth', () => ({ handleAuthFailure: vi.fn() }))
vi.mock('@/components/layout/PortalTopBarContext', () => ({
  SetTopBarContext: () => null,
}))

import { requireB2BCustomer } from '@/lib/checkout/server'
import ConfirmationPage from './page'

function adminForStampedQuote() {
  const from = vi.fn((table: string) => {
    const response = () => {
      if (table === 'orders') {
        return {
          data: {
            id: 'order-au',
            status: 'awaiting-proof-review',
            total_price: 100,
            intent: 'customer',
            order_type: 'purchase_order',
            quotes: {
              id: 'quote-au',
              order_ref: 'ORD-AU-1',
              monday_item_id: null,
              organization_id: 'org-1',
              subtotal: 100,
              decoration_cost: 0,
              tax: 0,
              picking_fee: 0,
              billed_total: 100,
              shipping_address: null,
              required_by: null,
              bill_country: 'AU',
              currency: 'AUD',
              countries: {
                name: 'Australia',
                tax_rate: 0.1,
                tax_label: 'GST 10%',
              },
            },
          },
          error: null,
        }
      }
      if (table === 'organizations') {
        return { data: { region: 'NZ' }, error: null }
      }
      return { data: [], error: null }
    }
    const builder = {
      select: () => builder,
      eq: () => builder,
      in: () => builder,
      single: async () => response(),
      maybeSingle: async () => response(),
      then: (
        resolve: (value: { data: unknown; error: unknown }) => unknown,
        reject?: (reason: unknown) => unknown,
      ) => Promise.resolve(response()).then(resolve, reject),
    }
    return builder
  })
  return { admin: { from }, from }
}

describe('checkout confirmation billing stamp', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders quote currency and country tax without reconstructing them from org region', async () => {
    const { admin, from } = adminForStampedQuote()
    vi.mocked(requireB2BCustomer).mockResolvedValue({
      admin,
      context: {
        userId: 'user-1',
        organizationId: 'org-1',
        email: 'buyer@example.test',
      },
    } as never)

    render(await ConfirmationPage({ params: Promise.resolve({ orderId: 'order-au' }) }))

    expect(screen.getAllByText('A$100.00').length).toBeGreaterThan(0)
    expect(screen.getByText('A$110.00')).toBeTruthy()
    expect(screen.getByText('GST 10%')).toBeTruthy()
    expect(screen.getByText('Australia · AUD')).toBeTruthy()
    expect(from).not.toHaveBeenCalledWith('organizations')
  })
})
