import { describe, expect, it } from 'vitest'

import { submitCustomerOrder, type CheckoutInput } from '../submit'
import { makeContext, makeFanoutStub, type StubConfig } from './fanout-test-stub'

const NZ_COUNTRY = {
  code: 'NZ',
  name: 'New Zealand',
  currency: 'NZD',
  taxRate: 0.15,
  taxLabel: 'GST 15%',
  isDefault: true,
} as const

function splitWorld(overrides: Partial<StubConfig> = {}) {
  return makeFanoutStub({
    items: [{ id: 'item-tee', sourceProductId: 'product-tee', priceMode: 'computed' }],
    products: [{ id: 'product-tee' }],
    links: [],
    tier: null,
    garmentUnitPrice: 12.5,
    garmentUnitPriceForCurrency: () => 12.5,
    enabledCountries: [NZ_COUNTRY],
    stores: [
      {
        id: 'store-albany',
        name: 'Albany',
        address: '1 Albany Hwy',
        city: 'Auckland',
        country: 'NZ',
        postalCode: '0632',
        organizationId: 'org-1',
      },
    ],
    submitResult: {
      quoteId: 'quote-split',
      orderId: 'order-split',
      orderRef: 'ORD-SPLIT-1',
    },
    ...overrides,
  })
}

function splitInput(): CheckoutInput {
  const base = {
    product_id: 'product-tee',
    product_name: 'Split Tee',
    catalogueItemId: 'item-tee',
    fulfilment_type: 'made_to_order' as const,
  }
  return {
    context: {
      // These fixtures are sub-minimum purchase orders; exempt the ORG rather
      // than softening the $500 gate.
      ...makeContext('org-1'),
      minOrderExempt: true,
    } as CheckoutInput['context'],
    idempotency_key: 'checkout-split:po',
    // Already exploded, as the route hands them over.
    lines: [
      { ...base, cart_line_id: 'line-1', qty: 8, destination_ref: 'd1', ship_to_store_id: 'store-albany' },
      { ...base, cart_line_id: 'line-1b', qty: 4, destination_ref: 'd2', ship_to_store_id: null },
    ],
    destinations: [
      {
        ref: 'd1',
        ship_to_store_id: 'store-albany',
        address_snapshot: { name: 'Albany', city: 'Auckland', country: 'NZ' },
      },
      {
        ref: 'd2',
        custom_address: {
          name: 'Site office',
          address: '1 Wharf Rd',
          city: 'Nelson',
          postal_code: '7010',
          country: 'NZ',
        },
        address_snapshot: { name: 'Site office', city: 'Nelson', country: 'NZ' },
      },
    ],
  }
}

describe('submitCustomerOrder split shipment destinations', () => {
  it('hands the RPC one p_destinations entry per destination and skips the header stamps', async () => {
    const stub = splitWorld()

    await submitCustomerOrder(stub.admin, splitInput(), {
      countryPartitionEnabled: true,
      partitionKey: 'NZ:purchase_order',
      country: NZ_COUNTRY,
    })

    const rpcCall = stub.rpcCalls.find(({ name }) => name === 'submit_b2b_order_for_country')
    if (!rpcCall) throw new Error('RPC not called')
    const args = rpcCall.args as unknown as {
      p_destinations: Array<Record<string, unknown>>
      p_lines: Array<Record<string, unknown>>
      p_shipping_address: unknown
    }
    expect(args.p_destinations).toEqual([
      expect.objectContaining({ ref: 'd1', position: 1, ship_to_store_id: 'store-albany', split_fee: 15 }),
      expect.objectContaining({ ref: 'd2', position: 2, ship_to_store_id: null, split_fee: 15 }),
    ])
    expect(args.p_destinations[0]).toHaveProperty('address_snapshot')
    expect(args.p_lines.every((l) => typeof l.destination_ref === 'string')).toBe(true)
    expect(args.p_shipping_address).toBeNull()
    // 4a header stamp must NOT run on split orders
    expect(
      stub.writeCalls.some(
        (w) => w.table === 'quotes' && 'ship_to_store_id' in ((w.value ?? {}) as object),
      ),
    ).toBe(false)
  })

  it('sends no p_destinations and keeps the legacy header stamp on a normal order', async () => {
    const stub = splitWorld()
    const input = splitInput()

    await submitCustomerOrder(
      stub.admin,
      {
        ...input,
        destinations: undefined,
        lines: [
          {
            product_id: 'product-tee',
            product_name: 'Split Tee',
            catalogueItemId: 'item-tee',
            fulfilment_type: 'made_to_order',
            cart_line_id: 'line-1',
            qty: 12,
            ship_to_store_id: 'store-albany',
          },
        ],
      },
      { countryPartitionEnabled: true, partitionKey: 'NZ:purchase_order', country: NZ_COUNTRY },
    )

    const rpcCall = stub.rpcCalls.find(({ name }) => name === 'submit_b2b_order_for_country')
    if (!rpcCall) throw new Error('RPC not called')
    expect((rpcCall.args as Record<string, unknown>).p_destinations).toBeNull()
    expect(
      stub.writeCalls.some(
        (w) => w.table === 'quotes' && 'ship_to_store_id' in ((w.value ?? {}) as object),
      ),
    ).toBe(true)
  })
})
