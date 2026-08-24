import { describe, expect, it } from 'vitest'

import { prepareCustomerOrderPartition } from './prepare'
import type { BillingCountryConfig } from '@/lib/account/org-countries'
import { makeContext, makeFanoutStub, type StubConfig } from './__tests__/fanout-test-stub'
import type { CheckoutInput } from './submit'
import {
  CountryPriceUnavailableError,
  UnitPriceDriftError,
} from './errors'

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

function config(): StubConfig {
  return {
    items: [
      {
        id: 'item-1',
        sourceProductId: 'product-1',
        priceMode: 'computed',
      },
    ],
    products: [
      {
        id: 'product-1',
        fulfilmentType: 'made_to_order',
        moq: 24,
      },
    ],
    links: [],
    tier: null,
    garmentUnitPrice: 12.5,
    organization: { region: 'NZ' },
    enabledCountryCodes: ['NZ'],
  }
}

function input(): CheckoutInput {
  return {
    context: makeContext('org-1'),
    idempotency_key: 'preview-1:po',
    custom_shipping_address: {
      street: '1 Test Street',
      city: 'Auckland',
      country: 'NZ',
    },
    lines: [
      {
        cart_line_id: 'line-1',
        product_id: 'product-1',
        product_name: 'Test tee',
        catalogueItemId: 'item-1',
        qty: 24,
        fulfilment_type: 'made_to_order',
        decorations: [],
      },
    ],
  }
}

describe('prepareCustomerOrderPartition', () => {
  it('prepares the same priced line and totals without writing an order', async () => {
    const stub = makeFanoutStub(config())

    const prepared = await prepareCustomerOrderPartition(stub.admin, input(), {
      countryPartitionEnabled: false,
      partitionKey: 'purchase_order',
      country: NZ,
    })

    expect(prepared).toMatchObject({
      key: 'purchase_order',
      country: NZ,
      orderType: 'purchase_order',
      totals: {
        goodsSubtotal: 300,
        decorationSubtotal: 0,
        pickingFee: 0,
        tax: 45,
        total: 345,
      },
    })
    expect(prepared.lines).toEqual([
      expect.objectContaining({
        cartLineId: 'line-1',
        unitPrice: 12.5,
        decorationUnitPrice: 0,
      }),
    ])
    expect(stub.rpcCalls.some(({ name }) => name === 'submit_b2b_order')).toBe(false)
    expect(stub.writeCalls).toEqual([])
  })
})

function countryConfig(overrides: Partial<StubConfig> = {}): StubConfig {
  return {
    ...config(),
    enabledCountryCodes: ['NZ', 'AU'],
    garmentUnitPriceForCurrency: (_itemId, qty, currency) =>
      currency === 'AUD' ? (qty >= 100 ? 25 : 30) : qty >= 75 ? 18 : 22,
    ...overrides,
  }
}

function countryLine(overrides: Partial<CheckoutInput['lines'][number]> = {}) {
  return {
    cart_line_id: 'line-au',
    product_id: 'product-1',
    product_name: 'Test tee',
    catalogueItemId: 'item-1',
    qty: 20,
    fulfilment_type: 'made_to_order' as const,
    decorations: [],
    ...overrides,
  }
}

function countryInput(
  lines: CheckoutInput['lines'],
  countryCode: 'NZ' | 'AU',
  pricingPoolLines: CheckoutInput['lines'] = lines,
): CheckoutInput {
  return {
    context: makeContext('org-1'),
    idempotency_key: `preview-${countryCode.toLowerCase()}`,
    custom_shipping_address: {
      street: '1 Test Street',
      city: countryCode === 'AU' ? 'Melbourne' : 'Auckland',
      country: countryCode,
    },
    lines,
    pricing_pool_lines: pricingPoolLines,
  }
}

async function prepareEnabled(
  stub: ReturnType<typeof makeFanoutStub>,
  checkout: CheckoutInput,
  country: BillingCountryConfig,
) {
  return prepareCustomerOrderPartition(stub.admin, checkout, {
    countryPartitionEnabled: true,
    partitionKey: `${country.code}:purchase_order`,
    country,
  })
}

describe('prepareCustomerOrderPartition exact destination pricing', () => {
  it('selects independently authored AU and NZ bands using the same cart-wide pooled quantity', async () => {
    const pool = [
      countryLine({ cart_line_id: 'line-au', qty: 20 }),
      countryLine({ cart_line_id: 'line-nz', qty: 80 }),
    ]
    const auStub = makeFanoutStub(countryConfig())
    const nzStub = makeFanoutStub(countryConfig())

    const [au, nz] = await Promise.all([
      prepareEnabled(
        auStub,
        countryInput([pool[0]], 'AU', pool),
        AU,
      ),
      prepareEnabled(
        nzStub,
        countryInput([pool[1]], 'NZ', pool),
        NZ,
      ),
    ])

    expect(au.lines[0].unitPrice).toBe(25)
    expect(nz.lines[0].unitPrice).toBe(18)
    expect(auStub.rpcCalls).toContainEqual({
      name: 'effective_unit_price_for_item_currency',
      args: {
        p_catalogue_item_id: 'item-1',
        p_org_id: 'org-1',
        p_qty: 100,
        p_currency: 'AUD',
      },
    })
    expect(nzStub.rpcCalls).toContainEqual({
      name: 'effective_unit_price_for_item_currency',
      args: {
        p_catalogue_item_id: 'item-1',
        p_org_id: 'org-1',
        p_qty: 100,
        p_currency: 'NZD',
      },
    })
  })

  it('keeps the selected AUD band identical when the same cart is split or unsplit', async () => {
    const pool = [
      countryLine({ cart_line_id: 'line-1', qty: 20 }),
      countryLine({ cart_line_id: 'line-2', qty: 80 }),
    ]
    const split = await prepareEnabled(
      makeFanoutStub(countryConfig()),
      countryInput([pool[0]], 'AU', pool),
      AU,
    )
    const unsplit = await prepareEnabled(
      makeFanoutStub(countryConfig()),
      countryInput(pool, 'AU', pool),
      AU,
    )

    expect(split.lines[0].unitPrice).toBe(25)
    expect(unsplit.lines.map((line) => line.unitPrice)).toEqual([25, 25])
  })

  it('uses the exact target stock scalar and preserves zero as a valid value', async () => {
    const stub = makeFanoutStub(
      countryConfig({
        items: [
          {
            id: 'item-1',
            sourceProductId: 'product-1',
            priceMode: 'computed',
            stockUnitPrice: 9,
          },
        ],
        stockUnitPriceForCurrency: (_itemId, currency) =>
          currency === 'AUD' ? 0 : 9,
        products: [
          {
            id: 'product-1',
            fulfilmentType: 'stocked',
            moq: 24,
          },
        ],
      }),
    )

    const prepared = await prepareEnabled(
      stub,
      countryInput(
        [countryLine({ fulfilment_type: 'stocked', qty: 5 })],
        'AU',
      ),
      AU,
    )

    expect(prepared.lines[0].unitPrice).toBe(0)
    expect(stub.rpcCalls).toContainEqual({
      name: 'catalogue_stock_unit_price_for_currency',
      args: { p_catalogue_item_id: 'item-1', p_currency: 'AUD' },
    })
  })

  it('uses exact target-currency manual and computed decoration prices', async () => {
    const manualStub = makeFanoutStub(
      countryConfig({
        items: [
          {
            id: 'item-1',
            sourceProductId: 'product-1',
            priceMode: 'manual_final',
          },
        ],
        manualCombinedPriceForCurrency: (_itemId, _qty, currency) =>
          currency === 'AUD' ? 7 : null,
      }),
    )
    const manual = await prepareEnabled(
      manualStub,
      countryInput([countryLine()], 'AU'),
      AU,
    )
    expect(manual.lines[0].decorationUnitPrice).toBe(7)

    const computedStub = makeFanoutStub(
      countryConfig({
        links: [
          {
            id: 'link-1',
            catalogueItemId: 'item-1',
            sourceProductId: 'product-1',
            orgDecoration: {
              id: 'decoration-1',
              organizationId: 'org-1',
              name: 'Logo',
              unitPrice: 99,
            },
          },
        ],
        decorationPriceForCurrency: (_decorationId, _qty, currency) =>
          currency === 'AUD' ? 5 : null,
      }),
    )
    const computed = await prepareEnabled(
      computedStub,
      countryInput(
        [
          countryLine({
            priceCurrency: 'NZD',
            decorations: [
              {
                linkId: 'link-1',
                decorationId: 'decoration-1',
                name: 'Logo',
                method: 'screenprint',
                positionLabel: null,
                unitPrice: 99,
                artworkUrl: null,
                snapshotUrl: null,
              },
            ],
          }),
        ],
        'AU',
      ),
      AU,
    )
    expect(computed.lines[0].decorationUnitPrice).toBe(5)
  })

  it.each([
    { component: 'garment' as const },
    { component: 'stock' as const },
    { component: 'decoration' as const },
    { component: 'period' as const },
  ])('throws exact country metadata when $component pricing is missing', async ({ component }) => {
    const base = countryConfig({
      garmentUnitPriceForCurrency: () => (component === 'garment' ? null : 12),
    })
    let checkoutLine = countryLine()
    if (component === 'stock') {
      base.items = [
        {
          id: 'item-1',
          sourceProductId: 'product-1',
          priceMode: 'computed',
          stockUnitPrice: 9,
        },
      ]
      base.stockUnitPriceForCurrency = () => null
      base.products = [
        {
          id: 'product-1',
          fulfilmentType: 'stocked',
          moq: 24,
        },
      ]
      checkoutLine = countryLine({ fulfilment_type: 'stocked' })
    }
    if (component === 'decoration') {
      base.links = [
        {
          id: 'link-1',
          catalogueItemId: 'item-1',
          sourceProductId: 'product-1',
          orgDecoration: {
            id: 'decoration-1',
            organizationId: 'org-1',
            name: 'Logo',
            unitPrice: 5,
          },
        },
      ]
      base.decorationPriceForCurrency = () => null
      checkoutLine = countryLine({
        decorations: [
          {
            linkId: 'link-1',
            decorationId: 'decoration-1',
            name: 'Logo',
            method: 'screenprint',
            positionLabel: null,
            unitPrice: 5,
            artworkUrl: null,
            snapshotUrl: null,
          },
        ],
      })
    }
    if (component === 'period') {
      base.items = [
        {
          id: 'item-1',
          sourceProductId: 'product-1',
          priceMode: 'computed',
          fulfilmentTypeOverride: 'pre_order',
        },
      ]
      base.openPeriod = { id: 'period-1', closesAt: '2026-09-30T00:00:00.000Z' }
      base.periodUnitPriceForCurrency = () => null
    }

    const error = await prepareEnabled(
      makeFanoutStub(base),
      countryInput([checkoutLine], 'AU'),
      AU,
    ).then(
      () => null,
      (caught) => caught,
    )

    expect(error).toBeInstanceOf(CountryPriceUnavailableError)
    expect(error).toMatchObject({
      code: 'country_price_unavailable',
      message: 'Test tee is not orderable to AU yet',
      detail: {
        cartLineId: 'line-au',
        productId: 'product-1',
        productName: 'Test tee',
        countryCode: 'AU',
        currency: 'AUD',
        component,
      },
    })
  })

  it('does not fall back to an existing NZD garment price when AUD is missing', async () => {
    const error = await prepareEnabled(
      makeFanoutStub(
        countryConfig({
          garmentUnitPriceForCurrency: (_itemId, _qty, currency) =>
            currency === 'NZD' ? 22 : null,
        }),
      ),
      countryInput([countryLine()], 'AU'),
      AU,
    ).then(
      () => null,
      (caught) => caught,
    )

    expect(error).toMatchObject({
      code: 'country_price_unavailable',
      detail: {
        countryCode: 'AU',
        currency: 'AUD',
        component: 'garment',
      },
    })
  })

  it('reprices a drawer snapshot from NZD without treating it as target-currency drift', async () => {
    const prepared = await prepareEnabled(
      makeFanoutStub(countryConfig()),
      countryInput(
        [
          countryLine({
            claimed_unit_price: 12.5,
            has_brackets: true,
            priceCurrency: 'NZD',
          }),
        ],
        'AU',
      ),
      AU,
    )

    expect(prepared.lines[0]).toMatchObject({
      unitPrice: 30,
      repricedFromCurrency: 'NZD',
    })
  })

  it('throws the existing drift error when a reviewed target-currency price changes', async () => {
    const error = await prepareEnabled(
      makeFanoutStub(countryConfig()),
      countryInput(
        [
          countryLine({
            reviewed_unit_price: 29,
            reviewed_decoration_price: 0,
            reviewed_currency: 'AUD',
          }),
        ],
        'AU',
      ),
      AU,
    ).then(
      () => null,
      (caught) => caught,
    )

    expect(error).toBeInstanceOf(UnitPriceDriftError)
    expect(error).toMatchObject({
      drift: [
        expect.objectContaining({
          cartLineId: 'line-au',
          claimedUnitPrice: 29,
          canonicalUnitPrice: 30,
        }),
      ],
    })
  })

  it('throws the existing decoration drift error when a reviewed target-currency decoration price changes', async () => {
    const error = await prepareEnabled(
      makeFanoutStub(
        countryConfig({
          links: [
            {
              id: 'link-1',
              catalogueItemId: 'item-1',
              sourceProductId: 'product-1',
              orgDecoration: {
                id: 'decoration-1',
                organizationId: 'org-1',
                name: 'Logo',
                unitPrice: 99,
              },
            },
          ],
          decorationPriceForCurrency: () => 5,
        }),
      ),
      countryInput(
        [
          countryLine({
            reviewed_unit_price: 30,
            reviewed_decoration_price: 4,
            reviewed_currency: 'AUD',
            decorations: [
              {
                linkId: 'link-1',
                decorationId: 'decoration-1',
                name: 'Logo',
                method: 'screenprint',
                positionLabel: null,
                unitPrice: 99,
                artworkUrl: null,
                snapshotUrl: null,
              },
            ],
          }),
        ],
        'AU',
      ),
      AU,
    ).then(
      () => null,
      (caught) => caught,
    )

    expect(error).toMatchObject({
      name: 'DecorationDriftError',
      drift: [
        expect.objectContaining({
          cartLineId: 'line-au',
          was: 4,
          now: 5,
          reason: 'price_drift',
        }),
      ],
    })
  })

  it('charges the deliberate AU-org → NZ-stock fee only in enabled preparation', async () => {
    const canaryConfig = countryConfig({
      organization: { region: 'AU' },
      products: [{ id: 'product-1', fulfilmentType: 'stocked', moq: 24 }],
    })
    const off = await prepareCustomerOrderPartition(
      makeFanoutStub(canaryConfig).admin,
      countryInput([countryLine({ fulfilment_type: 'stocked', qty: 5 })], 'NZ'),
      {
        countryPartitionEnabled: false,
        partitionKey: 'stock_on_hand',
        country: NZ,
      },
    )
    const on = await prepareEnabled(
      makeFanoutStub(canaryConfig),
      countryInput([countryLine({ fulfilment_type: 'stocked', qty: 5 })], 'NZ'),
      NZ,
    )

    expect(off.totals.pickingFee).toBe(0)
    expect(on.totals.pickingFee).toBe(30)
  })
})
