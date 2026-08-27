/**
 * The prepared annotation is the AUTHORITATIVE verdict — submit reads it rather
 * than recomputing, so the displayed and enforced answers cannot diverge.
 *
 * These tests drive the REAL prepareCustomerOrderPartition through the fan-out
 * stub, because the three things only prepare can get wrong are the notional
 * value it feeds in (prepaid lines at full value), the currency it picks, and the
 * two exemptions the cart cannot see.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/monday/deal-item', () => ({
  pushOrderDeal: vi.fn().mockResolvedValue({ itemId: 'mky-1', subitemIds: {} }),
}))

import { prepareCustomerOrderPartition } from '../prepare'
import { makeFanoutStub, makeContext, type StubConfig } from './fanout-test-stub'
import type { CheckoutInput } from '../submit'
import type { BillingCountryConfig } from '@/lib/account/org-countries'

const ORG = 'org-1'
const CAT = 'cat-1'
const ITEM = 'item-tee'
const PRODUCT = 'prod-tee'
const ITEM_STOCK = 'item-tee-stock'
const PRODUCT_STOCK = 'prod-tee-stock'

const NZ: BillingCountryConfig = {
  code: 'NZ',
  name: 'New Zealand',
  currency: 'NZD',
  taxRate: 0.15,
  taxLabel: 'GST 15%',
  isDefault: true,
}
const AU: BillingCountryConfig = {
  code: 'AU',
  name: 'Australia',
  currency: 'AUD',
  taxRate: 0.1,
  taxLabel: 'GST 10%',
  isDefault: false,
}

function world(
  garmentUnitPrice: number,
  variantBillingModes?: StubConfig['variantBillingModes'],
): StubConfig {
  return {
    items: [
      { id: ITEM, sourceProductId: PRODUCT, priceMode: 'computed' as const, catalogueId: CAT },
      {
        id: ITEM_STOCK,
        sourceProductId: PRODUCT_STOCK,
        priceMode: 'computed' as const,
        catalogueId: CAT,
      },
    ],
    // prepare resolves fulfilment nature SERVER-SIDE (prepare.ts:479-489): a
    // 'stocked' claim on a made_to_order product is coerced away. The stock half
    // of the mixed fixture therefore needs a genuinely stocked product.
    products: [{ id: PRODUCT }, { id: PRODUCT_STOCK, fulfilmentType: 'stocked' }],
    links: [],
    garmentUnitPrice,
    garmentUnitPriceForCurrency: () => garmentUnitPrice,
    enabledCountries: [NZ, AU],
    ...(variantBillingModes ? { variantBillingModes } : {}),
  }
}

function input(
  qty: number,
  overrides: {
    minOrderExempt?: boolean
    intent?: 'customer' | 'inventory'
  } = {},
): CheckoutInput {
  return {
    context: { ...makeContext(ORG), minOrderExempt: overrides.minOrderExempt ?? false },
    idempotency_key: `idem-${qty}`,
    ...(overrides.intent ? { intent: overrides.intent } : {}),
    lines: [
      {
        product_id: PRODUCT,
        product_name: 'Tee',
        variant_id: 'var-1',
        qty,
        unit_price: 10,
        catalogueItemId: ITEM,
        fulfilment_type: 'made_to_order',
        decorations: [],
      },
    ],
  } as unknown as CheckoutInput
}

/**
 * A deliberately MIXED partition: one prepaid stock DRAW plus one made-to-order
 * line. partitionCheckoutLines never produces this today (every partition
 * reaching prepare is homogeneous), which is exactly why it is worth pinning —
 * it is the only shape where the billed subtotal and the notional goods value
 * diverge, so it is the only shape that can prove which one the gate reads.
 */
function mixedPrepaidInput(): CheckoutInput {
  const line = (
    productId: string,
    catalogueItemId: string,
    variantId: string,
    fulfilment: 'stocked' | 'made_to_order',
    claimed?: 'prepaid',
  ) => ({
    product_id: productId,
    product_name: 'Tee',
    variant_id: variantId,
    qty: 30,
    unit_price: 10,
    catalogueItemId,
    fulfilment_type: fulfilment,
    decorations: [],
    ...(claimed ? { claimed_billing_mode: claimed } : {}),
  })
  return {
    context: { ...makeContext(ORG), minOrderExempt: false },
    idempotency_key: 'idem-mixed-prepaid',
    lines: [
      line(PRODUCT_STOCK, ITEM_STOCK, 'var-prepaid-stock', 'stocked', 'prepaid'),
      line(PRODUCT, ITEM, 'var-1', 'made_to_order'),
    ],
  } as unknown as CheckoutInput
}

function options(country: BillingCountryConfig) {
  return { countryPartitionEnabled: true, partitionKey: `${country.code}:po`, country }
}

describe('prepareCustomerOrderPartition minimumOrder annotation', () => {
  it('gates a purchase-order partition under the minimum', async () => {
    const stub = makeFanoutStub(world(10))
    const prepared = await prepareCustomerOrderPartition(stub.admin, input(30), options(NZ))
    expect(prepared.minimumOrder.applies).toBe(true)
    expect(prepared.minimumOrder.met).toBe(false)
    expect(prepared.minimumOrder.value).toBe(300)
    expect(prepared.minimumOrder.shortfall).toBe(200)
    expect(prepared.minimumOrder.currency).toBe('NZD')
  })

  it('clears a partition at exactly the minimum', async () => {
    const stub = makeFanoutStub(world(10))
    const prepared = await prepareCustomerOrderPartition(stub.admin, input(50), options(NZ))
    expect(prepared.minimumOrder.met).toBe(true)
    expect(prepared.minimumOrder.shortfall).toBe(0)
  })

  it('measures an AU partition in AUD with no conversion', async () => {
    const stub = makeFanoutStub(world(10))
    const prepared = await prepareCustomerOrderPartition(stub.admin, input(46), options(AU))
    expect(prepared.minimumOrder.currency).toBe('AUD')
    expect(prepared.minimumOrder.threshold).toBe(500)
    expect(prepared.minimumOrder.value).toBe(460)
    expect(prepared.minimumOrder.met).toBe(false)
  })

  it('evaluates NZ and AU partitions of one cart independently', async () => {
    const stub = makeFanoutStub(world(10))
    const nz = await prepareCustomerOrderPartition(stub.admin, input(60), options(NZ))
    const au = await prepareCustomerOrderPartition(stub.admin, input(30), options(AU))
    expect(nz.minimumOrder.met).toBe(true)
    expect(au.minimumOrder.met).toBe(false)
  })

  it('counts a prepaid draw at full notional value, not its $0 billed value', async () => {
    const stub = makeFanoutStub(world(10, { 'var-prepaid-stock': 'prepaid' }))
    const prepared = await prepareCustomerOrderPartition(
      stub.admin,
      mixedPrepaidInput(),
      options(NZ),
    )
    expect(prepared.orderType).toBe('purchase_order')
    // The prepaid draw bills nothing, so only the made-to-order half is billed...
    expect(prepared.totals.goodsSubtotal).toBe(300)
    // ...but the gate measures the whole production run and clears the minimum.
    expect(prepared.minimumOrder.value).toBe(600)
    expect(prepared.minimumOrder.met).toBe(true)
  })

  it('clears an exempt org under the minimum', async () => {
    const stub = makeFanoutStub(world(10))
    const prepared = await prepareCustomerOrderPartition(
      stub.admin,
      input(30, { minOrderExempt: true }),
      options(NZ),
    )
    expect(prepared.minimumOrder.applies).toBe(false)
    expect(prepared.minimumOrder.met).toBe(true)
  })

  it('clears an inventory-intent order under the minimum', async () => {
    const stub = makeFanoutStub(world(10))
    const prepared = await prepareCustomerOrderPartition(
      stub.admin,
      input(30, { intent: 'inventory' }),
      options(NZ),
    )
    expect(prepared.minimumOrder.applies).toBe(false)
  })

  it('never throws — a gated partition still returns its totals', async () => {
    const stub = makeFanoutStub(world(10))
    const prepared = await prepareCustomerOrderPartition(stub.admin, input(30), options(NZ))
    expect(prepared.minimumOrder.met).toBe(false)
    // The customer must keep their order summary at the moment they need to act on it.
    expect(prepared.totals.total).toBeGreaterThan(0)
    expect(prepared.lines).toHaveLength(1)
  })
})
