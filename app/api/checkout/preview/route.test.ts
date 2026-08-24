import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const authMocks = vi.hoisted(() => ({
  requireB2BCustomerApi: vi.fn(),
}))

vi.mock('@/lib/checkout/server', () => ({
  requireB2BCustomerApi: authMocks.requireB2BCustomerApi,
}))

import { POST } from './route'
import {
  makeContext,
  makeFanoutStub,
  type StubConfig,
} from '@/lib/checkout/__tests__/fanout-test-stub'
import type { BillingCountryConfig } from '@/lib/account/org-countries'

const AU: BillingCountryConfig = {
  code: 'AU',
  name: 'Australia',
  currency: 'AUD',
  taxRate: 0.1,
  taxLabel: 'GST 10%',
  isDefault: true,
}

const NZ: BillingCountryConfig = {
  code: 'NZ',
  name: 'New Zealand',
  currency: 'NZD',
  taxRate: 0.15,
  taxLabel: 'GST 15%',
  isDefault: false,
}

function previewConfig(overrides: Partial<StubConfig> = {}): StubConfig {
  return {
    items: [
      {
        id: 'item-1',
        sourceProductId: 'product-1',
        priceMode: 'computed',
        stockUnitPrice: 9,
      },
    ],
    products: [{ id: 'product-1', fulfilmentType: 'mixed', moq: 24 }],
    links: [],
    tier: null,
    enabledCountries: [AU, NZ],
    stores: [
      {
        id: 'store-au',
        name: 'Melbourne',
        address: '1 Swanston Street',
        city: 'Melbourne',
        state: 'VIC',
        country: 'AU',
        postalCode: '3000',
      },
      {
        id: 'store-nz',
        name: 'Auckland',
        address: '1 Queen Street',
        city: 'Auckland',
        country: 'NZ',
        postalCode: '1010',
      },
    ],
    garmentUnitPriceForCurrency: (_itemId, _qty, currency) =>
      currency === 'AUD' ? 25 : 20,
    stockUnitPriceForCurrency: (_itemId, currency) =>
      currency === 'AUD' ? 8 : 7,
    organization: { region: 'NZ' },
    ...overrides,
  }
}

function requestBody() {
  return {
    idempotency_key: 'preview-whitefox',
    lines: [
      {
        cart_line_id: 'au-po',
        product_id: 'product-1',
        product_name: 'Test tee',
        catalogueItemId: 'item-1',
        qty: 20,
        fulfilment_type: 'made_to_order',
        ship_to_store_id: 'store-au',
        decorations: [],
        priceCurrency: 'AUD',
      },
      {
        cart_line_id: 'au-stock',
        product_id: 'product-1',
        product_name: 'Test tee',
        catalogueItemId: 'item-1',
        qty: 5,
        fulfilment_type: 'stocked',
        ship_to_store_id: 'store-au',
        decorations: [],
        priceCurrency: 'AUD',
      },
      {
        cart_line_id: 'nz-stock',
        product_id: 'product-1',
        product_name: 'Test tee',
        catalogueItemId: 'item-1',
        qty: 10,
        fulfilment_type: 'stocked',
        ship_to_store_id: 'store-nz',
        decorations: [],
        priceCurrency: 'AUD',
      },
    ],
  }
}

describe('POST /api/checkout/preview', () => {
  beforeEach(() => {
    delete process.env.CHECKOUT_COUNTRY_PARTITION_ENABLED
    authMocks.requireB2BCustomerApi.mockReset()
  })

  afterEach(() => {
    delete process.env.CHECKOUT_COUNTRY_PARTITION_ENABLED
  })

  it('returns a stable not-found response before auth or data work while the flag is off', async () => {
    const response = await POST(
      new Request('http://localhost/api/checkout/preview', {
        method: 'POST',
        body: '{not even valid json',
      }),
    )

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'Not found' })
    expect(authMocks.requireB2BCustomerApi).not.toHaveBeenCalled()
  })

  it('prepares every country/fulfilment group in order without writes or fan-out', async () => {
    process.env.CHECKOUT_COUNTRY_PARTITION_ENABLED = 'true'
    const stub = makeFanoutStub(previewConfig())
    authMocks.requireB2BCustomerApi.mockResolvedValue({
      admin: stub.admin,
      context: {
        ...makeContext('org-1'),
        storeIds: ['store-au', 'store-nz'],
      },
    })

    const response = await POST(
      new Request('http://localhost/api/checkout/preview', {
        method: 'POST',
        body: JSON.stringify(requestBody()),
      }),
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(
      body.outcomes.map((outcome: { ok: boolean; partition?: { key: string } }) =>
        outcome.ok ? outcome.partition?.key : null,
      ),
    ).toEqual(['AU:purchase_order', 'AU:stock_on_hand', 'NZ:stock_on_hand'])
    expect(body.outcomes[2].partition.lines[0]).toMatchObject({
      cartLineId: 'nz-stock',
      unitPrice: 7,
      repricedFromCurrency: 'AUD',
    })
    expect(body.totalsByCurrency).toEqual({
      AUD:
        body.outcomes[0].partition.totals.total +
        body.outcomes[1].partition.totals.total,
      NZD: body.outcomes[2].partition.totals.total,
    })
    expect(stub.rpcCalls.map(({ name }) => name)).not.toContain(
      'submit_b2b_order_for_country',
    )
    expect(stub.rpcCalls.map(({ name }) => name)).not.toContain('submit_b2b_order')
    expect(stub.writeCalls).toEqual([])
    expect(stub.fromCount('quotes')).toBe(0)
    expect(stub.fromCount('quote_items')).toBe(0)
  })

  it('reports a named price miss beside its group and continues previewing later groups', async () => {
    process.env.CHECKOUT_COUNTRY_PARTITION_ENABLED = 'true'
    const stub = makeFanoutStub(
      previewConfig({
        garmentUnitPriceForCurrency: (_itemId, _qty, currency) =>
          currency === 'NZD' ? 20 : null,
      }),
    )
    authMocks.requireB2BCustomerApi.mockResolvedValue({
      admin: stub.admin,
      context: {
        ...makeContext('org-1'),
        storeIds: ['store-au', 'store-nz'],
      },
    })
    const requested = requestBody()
    requested.lines = [requested.lines[0], requested.lines[2]]

    const response = await POST(
      new Request('http://localhost/api/checkout/preview', {
        method: 'POST',
        body: JSON.stringify(requested),
      }),
    )
    const body = await response.json()

    expect(body.outcomes).toEqual([
      {
        ok: false,
        partitionKey: 'AU:purchase_order',
        countryCode: 'AU',
        code: 'country_price_unavailable',
        error: 'Test tee is not orderable to AU yet',
      },
      expect.objectContaining({
        ok: true,
        partition: expect.objectContaining({ key: 'NZ:stock_on_hand' }),
      }),
    ])
    expect(body.totalsByCurrency).toEqual({
      NZD: body.outcomes[1].partition.totals.total,
    })
    expect(stub.writeCalls).toEqual([])
  })

  it('rejects a non-ISO store country before preparing any group', async () => {
    process.env.CHECKOUT_COUNTRY_PARTITION_ENABLED = 'true'
    const stub = makeFanoutStub(
      previewConfig({
        stores: [
          {
            id: 'store-au',
            name: 'Legacy store',
            address: '1 Queen Street',
            city: 'Auckland',
            country: 'New Zealand',
            postalCode: '1010',
          },
        ],
      }),
    )
    authMocks.requireB2BCustomerApi.mockResolvedValue({
      admin: stub.admin,
      context: {
        ...makeContext('org-1'),
        storeIds: ['store-au'],
      },
    })
    const requested = requestBody()
    requested.lines = [requested.lines[0]]

    const response = await POST(
      new Request('http://localhost/api/checkout/preview', {
        method: 'POST',
        body: JSON.stringify(requested),
      }),
    )

    expect(response.status).toBe(400)
    expect(stub.rpcCalls).toEqual([])
    expect(stub.writeCalls).toEqual([])
  })
})
