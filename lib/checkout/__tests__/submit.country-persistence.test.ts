import { describe, expect, it } from 'vitest'

import { submitCustomerOrder, type CheckoutInput } from '../submit'
import { makeContext, makeFanoutStub, type StubConfig } from './fanout-test-stub'

const AU_COUNTRY = {
  code: 'AU',
  name: 'Australia',
  currency: 'AUD',
  taxRate: 0.1,
  taxLabel: 'GST 10%',
  isDefault: false,
} as const

function persistenceWorld(overrides: Partial<StubConfig> = {}) {
  return makeFanoutStub({
    items: [
      {
        id: 'item-tee',
        sourceProductId: 'product-tee',
        priceMode: 'computed',
      },
    ],
    products: [{ id: 'product-tee' }],
    links: [],
    tier: null,
    garmentUnitPrice: 12.5,
    garmentUnitPriceForCurrency: () => 15,
    // AU is the org's default country row: the flag-off path stamps from it.
    enabledCountries: [{ ...AU_COUNTRY, isDefault: true }],
    submitResult: {
      quoteId: 'quote-au',
      orderId: 'order-au',
      orderRef: 'ORD-AU-1',
    },
    ...overrides,
  })
}

function checkoutInput(): CheckoutInput {
  return {
    context: makeContext('org-1'),
    idempotency_key: 'checkout-au:po',
    custom_shipping_address: {
      street: '1 Test Street',
      city: 'Melbourne',
      country: 'AU',
    },
    lines: [
      {
        cart_line_id: 'line-au',
        product_id: 'product-tee',
        product_name: 'AU Tee',
        catalogueItemId: 'item-tee',
        qty: 10,
        fulfilment_type: 'made_to_order',
      },
    ],
  }
}

describe('submitCustomerOrder country persistence', () => {
  it('submits through the common country-stamping RPC', async () => {
    const stub = persistenceWorld()

    await submitCustomerOrder(stub.admin, checkoutInput(), {
      countryPartitionEnabled: true,
      partitionKey: 'AU:purchase_order',
      country: AU_COUNTRY,
    })

    expect(stub.rpcCalls.map(({ name }) => name)).toContain('submit_b2b_order_for_country')
    expect(stub.rpcCalls.map(({ name }) => name)).not.toContain('submit_b2b_order')
  })

  it('passes the prepared partition country to the stamping RPC exactly', async () => {
    const stub = persistenceWorld()

    await submitCustomerOrder(stub.admin, checkoutInput(), {
      countryPartitionEnabled: true,
      partitionKey: 'AU:purchase_order',
      country: AU_COUNTRY,
    })

    expect(
      stub.rpcCalls.find(({ name }) => name === 'submit_b2b_order_for_country')?.args
        ?.p_bill_country,
    ).toBe('AU')
  })

  it('observes the wrapper-stamped quote country and currency at the database boundary', async () => {
    const stub = persistenceWorld()

    await submitCustomerOrder(stub.admin, checkoutInput(), {
      countryPartitionEnabled: true,
      partitionKey: 'AU:purchase_order',
      country: AU_COUNTRY,
    })

    expect(stub.persistedQuotes).toStrictEqual([
      { id: 'quote-au', bill_country: 'AU', currency: 'AUD' },
    ])
  })

  it('rejects a resolved store country outside the prepared partition before persistence', async () => {
    const stub = persistenceWorld({
      stores: [
        {
          id: 'store-nz',
          name: 'Auckland Branch',
          address: '1 Queen Street',
          city: 'Auckland',
          country: 'NZ',
          postalCode: '1010',
        },
      ],
    })
    const input = checkoutInput()
    input.custom_shipping_address = null
    input.lines[0].ship_to_store_id = 'store-nz'

    await expect(
      submitCustomerOrder(stub.admin, input, {
        countryPartitionEnabled: true,
        partitionKey: 'AU:purchase_order',
        country: AU_COUNTRY,
      }),
    ).rejects.toThrow('Checkout partition country mismatch')
    expect(stub.rpcCount('submit_b2b_order_for_country')).toBe(0)
  })

  it('stamps the legacy organization country while the partition flag is off', async () => {
    const stub = persistenceWorld()

    await submitCustomerOrder(stub.admin, checkoutInput())

    expect(
      stub.rpcCalls.find(({ name }) => name === 'submit_b2b_order_for_country')?.args
        ?.p_bill_country,
    ).toBe('AU')
  })

  it('returns the wrapper order identifier and reference unchanged', async () => {
    const stub = persistenceWorld()

    await expect(
      submitCustomerOrder(stub.admin, checkoutInput(), {
        countryPartitionEnabled: true,
        partitionKey: 'AU:purchase_order',
        country: AU_COUNTRY,
      }),
    ).resolves.toStrictEqual({ order_id: 'order-au', order_ref: 'ORD-AU-1' })
  })

  it('does not read the legacy organization region on the enabled country path', async () => {
    const stub = persistenceWorld()

    await submitCustomerOrder(stub.admin, checkoutInput(), {
      countryPartitionEnabled: true,
      partitionKey: 'AU:purchase_order',
      country: AU_COUNTRY,
    })

    expect(stub.fromCount('organizations')).toBe(0)
  })
})
