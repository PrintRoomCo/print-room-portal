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
    submitCustomerOrder: vi.fn(),
  }
})

import { POST } from '../route'
import { requireB2BCustomerApi } from '@/lib/checkout/server'
import { submitCustomerOrder } from '@/lib/checkout/submit'

function request(body: unknown): Request {
  return new Request('http://localhost/api/checkout', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

function makeAdmin(storeOverrides?: Array<{ id: string; country: string }>) {
  const queries: Array<{
    table: string
    filters: Array<{ operation: 'eq' | 'in'; column: string; value: unknown }>
  }> = []
  const countries = [
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
  const stores = storeOverrides ?? [
    { id: 'store-au', country: 'AU' },
    { id: 'store-nz', country: 'NZ' },
  ]
  const admin = {
    from: vi.fn((table: string) => {
      const query = { table, filters: [] as (typeof queries)[number]['filters'] }
      queries.push(query)
      const builder = {
        select: vi.fn(() => builder),
        eq: vi.fn((column: string, value: unknown) => {
          query.filters.push({ operation: 'eq', column, value })
          return builder
        }),
        in: vi.fn((column: string, value: unknown) => {
          query.filters.push({ operation: 'in', column, value })
          return builder
        }),
        then: (
          resolve: (value: { data: unknown[]; error: null }) => unknown,
        ) =>
          Promise.resolve({
            data: table === 'organization_countries' ? countries : stores,
            error: null,
          }).then(resolve),
      }
      return builder
    }),
  }
  return { admin, queries }
}

const lines = [
  {
    cart_line_id: 'au-po',
    product_id: 'au-po-product',
    product_name: 'AU made to order',
    qty: 20,
    ship_to_store_id: 'store-au',
    fulfilment_type: 'made_to_order' as const,
  },
  {
    cart_line_id: 'au-stock',
    product_id: 'au-stock-product',
    product_name: 'AU stock',
    qty: 5,
    ship_to_store_id: 'store-au',
    fulfilment_type: 'stocked' as const,
  },
  {
    cart_line_id: 'nz-stock',
    product_id: 'nz-stock-product',
    product_name: 'NZ stock',
    qty: 10,
    ship_to_store_id: 'store-nz',
    fulfilment_type: 'stocked' as const,
  },
]

describe('POST /api/checkout country partition cutover', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.CHECKOUT_COUNTRY_PARTITION_ENABLED = 'true'
  })

  afterEach(() => {
    delete process.env.CHECKOUT_COUNTRY_PARTITION_ENABLED
  })

  it('submits AU purchase, AU stock, then NZ stock with stable partition inputs', async () => {
    const { admin, queries } = makeAdmin()
    vi.mocked(requireB2BCustomerApi).mockResolvedValue({
      admin: admin as never,
      context: {
        organizationId: 'org-1',
        storeIds: ['store-au', 'store-nz'],
        role: 'org_admin',
        tenantType: 'franchise',
      } as never,
    })
    vi.mocked(submitCustomerOrder)
      .mockResolvedValueOnce({ order_id: 'order-au-po', order_ref: 'AU-PO' })
      .mockResolvedValueOnce({ order_id: 'order-au-stock', order_ref: 'AU-STOCK' })
      .mockResolvedValueOnce({ order_id: 'order-nz-stock', order_ref: 'NZ-STOCK' })

    const response = await POST(
      request({
        idempotency_key: 'whitefox-1',
        lines,
        terms_accepted: true,
        terms_version: 'v1-2026-08-11',
      }),
    )

    expect(response.status).toBe(200)
    expect(submitCustomerOrder).toHaveBeenCalledTimes(3)
    const calls = vi.mocked(submitCustomerOrder).mock.calls
    expect(
      calls.map(([, input, options]) => ({
        idempotencyKey: input.idempotency_key,
        lineIds: input.lines.map((line) => line.cart_line_id),
        poolIds: input.pricing_pool_lines?.map((line) => line.cart_line_id),
        country: options?.country,
        partitionKey: options?.partitionKey,
      })),
    ).toEqual([
      {
        idempotencyKey: 'whitefox-1:au:po',
        lineIds: ['au-po'],
        poolIds: ['au-po', 'au-stock', 'nz-stock'],
        country: expect.objectContaining({ code: 'AU', currency: 'AUD' }),
        partitionKey: 'AU:purchase_order',
      },
      {
        idempotencyKey: 'whitefox-1:au:stock',
        lineIds: ['au-stock'],
        poolIds: ['au-po', 'au-stock', 'nz-stock'],
        country: expect.objectContaining({ code: 'AU', currency: 'AUD' }),
        partitionKey: 'AU:stock_on_hand',
      },
      {
        idempotencyKey: 'whitefox-1:nz:stock',
        lineIds: ['nz-stock'],
        poolIds: ['au-po', 'au-stock', 'nz-stock'],
        country: expect.objectContaining({ code: 'NZ', currency: 'NZD' }),
        partitionKey: 'NZ:stock_on_hand',
      },
    ])
    expect(
      calls.map(([, input]) =>
        input.pricing_pool_lines?.map((line) =>
          (line as typeof line & { ship_country?: string }).ship_country,
        ),
      ),
    ).toEqual([
      ['AU', 'AU', 'NZ'],
      ['AU', 'AU', 'NZ'],
      ['AU', 'AU', 'NZ'],
    ])
    expect(queries.filter(({ table }) => table === 'stores')).toEqual([
      {
        table: 'stores',
        filters: [
          { operation: 'eq', column: 'organization_id', value: 'org-1' },
          { operation: 'in', column: 'id', value: ['store-au', 'store-nz'] },
        ],
      },
    ])

    expect(await response.json()).toEqual({
      outcomes: [
        {
          ok: true,
          partitionKey: 'AU:purchase_order',
          countryCode: 'AU',
          currency: 'AUD',
          orderType: 'purchase_order',
          orderId: 'order-au-po',
          orderRef: 'AU-PO',
        },
        {
          ok: true,
          partitionKey: 'AU:stock_on_hand',
          countryCode: 'AU',
          currency: 'AUD',
          orderType: 'stock_on_hand',
          orderId: 'order-au-stock',
          orderRef: 'AU-STOCK',
        },
        {
          ok: true,
          partitionKey: 'NZ:stock_on_hand',
          countryCode: 'NZ',
          currency: 'NZD',
          orderType: 'stock_on_hand',
          orderId: 'order-nz-stock',
          orderRef: 'NZ-STOCK',
        },
      ],
    })
  })

  it('preserves the staff manager single-branch lock before any partition executes', async () => {
    const { admin } = makeAdmin([
      { id: 'store-au', country: 'AU' },
      { id: 'store-au-2', country: 'AU' },
    ])
    vi.mocked(requireB2BCustomerApi).mockResolvedValue({
      admin: admin as never,
      context: {
        organizationId: 'org-1',
        storeIds: ['store-au', 'store-au-2'],
        role: 'staff',
        tenantType: 'franchise',
        defaultStoreId: 'store-au',
        branchStoreIds: ['store-au-2'],
      } as never,
    })
    vi.mocked(submitCustomerOrder).mockResolvedValue({
      order_id: 'must-not-exist',
      order_ref: 'MUST-NOT-EXIST',
    })

    const response = await POST(
      request({
        idempotency_key: 'staff-two-branches',
        lines: [
          { ...lines[0], ship_to_store_id: 'store-au' },
          { ...lines[0], cart_line_id: 'au-po-2', ship_to_store_id: 'store-au-2' },
        ],
        terms_accepted: true,
        terms_version: 'v1-2026-08-11',
      }),
    )

    expect(response.status).toBe(400)
    expect(submitCustomerOrder).not.toHaveBeenCalled()
    expect(await response.json()).toEqual({
      error:
        'Mixed per-line custom ship-to addresses not supported in v1. Save each address as a store first.',
    })
  })

  it('normalizes an all-custom address country before planning and submission', async () => {
    const { admin, queries } = makeAdmin()
    vi.mocked(requireB2BCustomerApi).mockResolvedValue({
      admin: admin as never,
      context: {
        organizationId: 'org-1',
        storeIds: [],
        role: 'org_admin',
        tenantType: 'franchise',
      } as never,
    })
    vi.mocked(submitCustomerOrder).mockResolvedValue({
      order_id: 'order-nz-custom',
      order_ref: 'NZ-CUSTOM',
    })

    const response = await POST(
      request({
        idempotency_key: 'custom-nz',
        lines: [
          {
            ...lines[0],
            ship_to_store_id: null,
          },
        ],
        custom_shipping_address: {
          street: '1 Queen Street',
          city: 'Auckland',
          country: 'New Zealand',
        },
        terms_accepted: true,
        terms_version: 'v1-2026-08-11',
      }),
    )

    expect(response.status).toBe(200)
    const [, input, options] = vi.mocked(submitCustomerOrder).mock.calls[0]
    expect(input.custom_shipping_address).toMatchObject({ country: 'NZ' })
    expect(input.lines[0]).toMatchObject({ ship_country: 'NZ' })
    expect(options?.country).toMatchObject({ code: 'NZ', currency: 'NZD' })
    expect(queries.filter(({ table }) => table === 'stores')).toEqual([])
  })

  it('rejects a store whose exact ISO country is not enabled before any order call', async () => {
    const { admin } = makeAdmin([{ id: 'store-us', country: 'US' }])
    vi.mocked(requireB2BCustomerApi).mockResolvedValue({
      admin: admin as never,
      context: {
        organizationId: 'org-1',
        storeIds: ['store-us'],
        role: 'org_admin',
        tenantType: 'franchise',
      } as never,
    })

    const response = await POST(
      request({
        idempotency_key: 'disabled-country',
        lines: [{ ...lines[0], ship_to_store_id: 'store-us' }],
        terms_accepted: true,
        terms_version: 'v1-2026-08-11',
      }),
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      error: 'The shipping address country is not enabled for your organisation.',
    })
    expect(submitCustomerOrder).not.toHaveBeenCalled()
  })

  it('rejects a non-ISO store country instead of applying the custom-address normalizer', async () => {
    const { admin } = makeAdmin([{ id: 'store-legacy', country: 'New Zealand' }])
    vi.mocked(requireB2BCustomerApi).mockResolvedValue({
      admin: admin as never,
      context: {
        organizationId: 'org-1',
        storeIds: ['store-legacy'],
        role: 'org_admin',
        tenantType: 'franchise',
      } as never,
    })

    const response = await POST(
      request({
        idempotency_key: 'non-iso-store',
        lines: [{ ...lines[0], ship_to_store_id: 'store-legacy' }],
        terms_accepted: true,
        terms_version: 'v1-2026-08-11',
      }),
    )

    expect(response.status).toBe(400)
    expect(submitCustomerOrder).not.toHaveBeenCalled()
  })
})
