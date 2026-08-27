import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/cache', () => ({ revalidateTag: vi.fn() }))
vi.mock('@/lib/checkout/server', () => ({ requireB2BCustomerApi: vi.fn() }))
vi.mock('@/lib/checkout/submit', () => {
  class DecorationDriftError extends Error {}
  class UnitPriceDriftError extends Error {}
  class MemberAccessDriftError extends Error {}
  class MoqViolationError extends Error {}
  class StockShortfallError extends Error {}
  class BuyerScopeError extends Error {}
  class MixedShippingAddressError extends Error {}
  class DisabledCountryError extends Error {}
  class BillingModeDriftError extends Error {}
  class MinimumOrderValueError extends Error {}
  return {
    DecorationDriftError,
    UnitPriceDriftError,
    MemberAccessDriftError,
    MoqViolationError,
    StockShortfallError,
    BuyerScopeError,
    MixedShippingAddressError,
    DisabledCountryError,
    BillingModeDriftError,
    MinimumOrderValueError,
    submitCustomerOrder: vi.fn(),
  }
})

import { POST } from '../route'
import { CountryPriceUnavailableError } from '@/lib/checkout/errors'
import { requireB2BCustomerApi } from '@/lib/checkout/server'
import { submitCustomerOrder } from '@/lib/checkout/submit'

function request(): Request {
  return new Request('http://localhost/api/checkout', {
    method: 'POST',
    body: JSON.stringify({
      idempotency_key: 'retryable-cart',
      lines: [
        {
          cart_line_id: 'au-po',
          product_id: 'product-au-po',
          product_name: 'AU PO',
          qty: 20,
          ship_to_store_id: 'store-au',
          fulfilment_type: 'made_to_order',
        },
        {
          cart_line_id: 'au-stock',
          product_id: 'product-au-stock',
          product_name: 'AU stock',
          qty: 5,
          ship_to_store_id: 'store-au',
          fulfilment_type: 'stocked',
        },
        {
          cart_line_id: 'nz-stock',
          product_id: 'product-nz-stock',
          product_name: 'NZ stock',
          qty: 10,
          ship_to_store_id: 'store-nz',
          fulfilment_type: 'stocked',
        },
      ],
      terms_accepted: true,
      terms_version: 'v1-2026-08-11',
    }),
  })
}

function adminBoundary() {
  const admin = {
    from: vi.fn((table: string) => {
      const builder = {
        select: vi.fn(() => builder),
        eq: vi.fn(() => builder),
        in: vi.fn(() => builder),
        then: (
          resolve: (value: { data: unknown[]; error: null }) => unknown,
        ) =>
          Promise.resolve({
            data:
              table === 'organization_countries'
                ? [
                    {
                      country_code: 'AU',
                      is_default: true,
                      countries: {
                        name: 'Australia',
                        currency: 'AUD',
                        tax_rate: 0.1,
                        tax_label: 'GST 10%',
                      },
                    },
                    {
                      country_code: 'NZ',
                      is_default: false,
                      countries: {
                        name: 'New Zealand',
                        currency: 'NZD',
                        tax_rate: 0.15,
                        tax_label: 'GST 15%',
                      },
                    },
                  ]
                : [
                    { id: 'store-au', country: 'AU' },
                    { id: 'store-nz', country: 'NZ' },
                  ],
            error: null,
          }).then(resolve),
      }
      return builder
    }),
  }
  return admin
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireB2BCustomerApi).mockResolvedValue({
    admin: adminBoundary() as never,
    context: {
      organizationId: 'org-1',
      storeIds: ['store-au', 'store-nz'],
      role: 'org_admin',
      tenantType: 'franchise',
    } as never,
  })
})

afterEach(() => {
  delete process.env.CHECKOUT_COUNTRY_PARTITION_ENABLED
})

describe('POST /api/checkout independent partition outcomes', () => {
  it('continues after partition two fails and retries with identical idempotency keys', async () => {
    process.env.CHECKOUT_COUNTRY_PARTITION_ENABLED = 'true'
    vi.mocked(submitCustomerOrder)
      .mockResolvedValueOnce({ order_id: 'order-au-po', order_ref: 'AU-PO' })
      .mockRejectedValueOnce(
        new CountryPriceUnavailableError({
          cartLineId: 'au-stock',
          productId: 'product-au-stock',
          productName: 'AU stock',
          countryCode: 'AU',
          currency: 'AUD',
          component: 'stock',
        }),
      )
      .mockResolvedValueOnce({ order_id: 'order-nz-stock', order_ref: 'NZ-STOCK' })

    const first = await POST(request())
    const firstBody = await first.json()

    expect(first.status).toBe(207)
    expect(submitCustomerOrder).toHaveBeenCalledTimes(3)
    expect(firstBody.outcomes).toEqual([
      expect.objectContaining({ ok: true, partitionKey: 'AU:purchase_order' }),
      {
        ok: false,
        partitionKey: 'AU:stock_on_hand',
        countryCode: 'AU',
        currency: 'AUD',
        orderType: 'stock_on_hand',
        code: 'country_price_unavailable',
        error: 'AU stock is not orderable to AU yet',
        detail: {
          cartLineId: 'au-stock',
          productId: 'product-au-stock',
          productName: 'AU stock',
          countryCode: 'AU',
          currency: 'AUD',
          component: 'stock',
        },
      },
      expect.objectContaining({ ok: true, partitionKey: 'NZ:stock_on_hand' }),
    ])
    const firstKeys = vi
      .mocked(submitCustomerOrder)
      .mock.calls.map(([, input]) => input.idempotency_key)

    vi.mocked(submitCustomerOrder).mockClear()
    vi.mocked(submitCustomerOrder)
      .mockResolvedValueOnce({ order_id: 'order-au-po', order_ref: 'AU-PO' })
      .mockResolvedValueOnce({ order_id: 'order-au-stock', order_ref: 'AU-STOCK' })
      .mockResolvedValueOnce({ order_id: 'order-nz-stock', order_ref: 'NZ-STOCK' })

    const retry = await POST(request())
    expect(retry.status).toBe(200)
    expect(
      vi.mocked(submitCustomerOrder).mock.calls.map(([, input]) => input.idempotency_key),
    ).toEqual(firstKeys)
    expect((await retry.json()).outcomes).toHaveLength(3)
  })

  it('keeps the legacy outer catch and exact error shape while the flag is off', async () => {
    vi.mocked(submitCustomerOrder)
      .mockResolvedValueOnce({ order_id: 'legacy-po', order_ref: 'LEGACY-PO' })
      .mockRejectedValueOnce(new Error('OUT_OF_STOCK'))

    const response = await POST(request())

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: 'OUT_OF_STOCK' })
    expect(submitCustomerOrder).toHaveBeenCalledTimes(2)
    expect(
      vi.mocked(submitCustomerOrder).mock.calls.map(([, input]) =>
        input.idempotency_key,
      ),
    ).toEqual(['retryable-cart:po', 'retryable-cart:stock'])
  })

  it('continues after an unknown group failure without leaking its message', async () => {
    process.env.CHECKOUT_COUNTRY_PARTITION_ENABLED = 'true'
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.mocked(submitCustomerOrder)
      .mockRejectedValueOnce(new Error('database password and internal stack'))
      .mockResolvedValueOnce({ order_id: 'order-au-stock', order_ref: 'AU-STOCK' })
      .mockResolvedValueOnce({ order_id: 'order-nz-stock', order_ref: 'NZ-STOCK' })

    const response = await POST(request())
    const body = await response.json()

    expect(response.status).toBe(207)
    expect(submitCustomerOrder).toHaveBeenCalledTimes(3)
    expect(body.outcomes[0]).toEqual({
      ok: false,
      partitionKey: 'AU:purchase_order',
      countryCode: 'AU',
      currency: 'AUD',
      orderType: 'purchase_order',
      code: 'order_submit_failed',
      error: 'This order group could not be submitted. Please try again.',
    })
    expect(JSON.stringify(body)).not.toContain('database password')
    expect(consoleError).toHaveBeenCalledWith('[Checkout] country partition failed', {
      partitionKey: 'AU:purchase_order',
      countryCode: 'AU',
      orderType: 'purchase_order',
    })
    consoleError.mockRestore()
  })
})
