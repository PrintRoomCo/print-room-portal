import { describe, it, expect } from 'vitest'
import {
  partitionByCountryAndFulfilment,
  partitionByFulfilment,
  partitionCheckoutLines,
} from '../partition'
import type { CheckoutLineInput } from '../submit'

function line(overrides: Partial<CheckoutLineInput> = {}): CheckoutLineInput {
  return { product_id: 'p1', product_name: 'Tee', qty: 10, ...overrides }
}

describe('partitionCheckoutLines', () => {
  it('returns a single purchase_order partition when every line is made_to_order', () => {
    const parts = partitionCheckoutLines([
      line({ fulfilment_type: 'made_to_order' }),
      line({ product_id: 'p2', fulfilment_type: 'made_to_order' }),
    ])
    expect(parts).toHaveLength(1)
    expect(parts[0].orderType).toBe('purchase_order')
    expect(parts[0].lines).toHaveLength(2)
  })

  it('returns a single stock_on_hand partition when every line is stocked', () => {
    const parts = partitionCheckoutLines([line({ fulfilment_type: 'stocked' })])
    expect(parts).toHaveLength(1)
    expect(parts[0].orderType).toBe('stock_on_hand')
  })

  it('splits a mixed cart into purchase_order (first) then stock_on_hand', () => {
    const mto = line({ product_id: 'mto', fulfilment_type: 'made_to_order' })
    const stk = line({ product_id: 'stk', fulfilment_type: 'stocked' })
    const parts = partitionCheckoutLines([stk, mto])
    expect(parts.map((p) => p.orderType)).toEqual(['purchase_order', 'stock_on_hand'])
    expect(parts[0].lines).toEqual([mto])
    expect(parts[1].lines).toEqual([stk])
  })

  it('treats an absent fulfilment_type as purchase_order (legacy-conservative)', () => {
    const parts = partitionCheckoutLines([line()])
    expect(parts).toHaveLength(1)
    expect(parts[0].orderType).toBe('purchase_order')
  })

  it('returns [] for empty input', () => {
    expect(partitionCheckoutLines([])).toEqual([])
  })

  it('preserves input order within a partition', () => {
    const a = line({ product_id: 'a', fulfilment_type: 'stocked' })
    const b = line({ product_id: 'b', fulfilment_type: 'stocked' })
    expect(partitionCheckoutLines([a, b])[0].lines).toEqual([a, b])
  })
})

describe('partitionByFulfilment', () => {
  it('splits an arbitrary line shape via the supplied predicate', () => {
    const lines = [
      { id: 'a', mode: 'stocked' },
      { id: 'b', mode: 'made_to_order' },
      { id: 'c', mode: 'stocked' },
    ]
    expect(partitionByFulfilment(lines, (l) => l.mode === 'stocked')).toEqual([
      { orderType: 'purchase_order', lines: [{ id: 'b', mode: 'made_to_order' }] },
      {
        orderType: 'stock_on_hand',
        lines: [
          { id: 'a', mode: 'stocked' },
          { id: 'c', mode: 'stocked' },
        ],
      },
    ])
  })

  it('returns purchase_order FIRST (the primary/tracked order)', () => {
    const lines = [{ stocked: true }, { stocked: false }]
    const out = partitionByFulfilment(lines, (l) => l.stocked)
    expect(out.map((p) => p.orderType)).toEqual(['purchase_order', 'stock_on_hand'])
  })

  it('never returns an empty-lines partition', () => {
    expect(partitionByFulfilment([{ stocked: true }], (l) => l.stocked)).toEqual([
      { orderType: 'stock_on_hand', lines: [{ stocked: true }] },
    ])
  })

  it('returns [] for empty input', () => {
    expect(partitionByFulfilment([], () => true)).toEqual([])
  })
})

describe('partitionByCountryAndFulfilment', () => {
  it('splits the WHITEFOX cart into AU production, AU stock, then NZ stock', () => {
    const auStock = { id: 'au-stock', ship_country: 'AU', fulfilment_type: 'stocked' }
    const auProduction = {
      id: 'au-production',
      ship_country: 'AU',
      fulfilment_type: 'made_to_order',
    }
    const nzStock = { id: 'nz-stock', ship_country: 'NZ', fulfilment_type: 'stocked' }

    expect(
      partitionByCountryAndFulfilment([auStock, nzStock, auProduction], ['AU', 'NZ']),
    ).toStrictEqual([
      {
        key: 'AU:purchase_order',
        countryCode: 'AU',
        orderType: 'purchase_order',
        lines: [auProduction],
      },
      {
        key: 'AU:stock_on_hand',
        countryCode: 'AU',
        orderType: 'stock_on_hand',
        lines: [auStock],
      },
      {
        key: 'NZ:stock_on_hand',
        countryCode: 'NZ',
        orderType: 'stock_on_hand',
        lines: [nzStock],
      },
    ])
  })

  it('orders the default country first, remaining countries by ISO, and preserves line order', () => {
    const lines = [
      { id: 'gb-1', ship_country: 'GB', fulfilment_type: 'stocked' },
      { id: 'au-1', ship_country: 'AU', fulfilment_type: 'stocked' },
      { id: 'nz-1', ship_country: 'NZ', fulfilment_type: 'made_to_order' },
      { id: 'au-2', ship_country: 'AU', fulfilment_type: 'stocked' },
    ]

    const partitions = partitionByCountryAndFulfilment(lines, ['NZ'])

    expect(partitions.map((partition) => partition.key)).toStrictEqual([
      'NZ:purchase_order',
      'AU:stock_on_hand',
      'GB:stock_on_hand',
    ])
    expect(partitions[1]?.lines).toStrictEqual([lines[1], lines[3]])
  })

  it.each(['', 'New Zealand', 'nz', 'NZL'])('rejects unresolved/non-exact ship country %j', (shipCountry) => {
    expect(() =>
      partitionByCountryAndFulfilment([
        { id: 'bad', ship_country: shipCountry, fulfilment_type: 'stocked' },
      ]),
    ).toThrow(/Invalid checkout ship_country/)
  })

  it('uses the exact address country already decorating every all-custom line', () => {
    const lines = [
      { id: 'custom-au', ship_country: 'AU', fulfilment_type: 'stocked', source: 'custom' },
      {
        id: 'custom-nz',
        ship_country: 'NZ',
        fulfilment_type: 'made_to_order',
        source: 'custom',
      },
    ]

    expect(partitionByCountryAndFulfilment(lines).map((partition) => partition.key)).toStrictEqual([
      'AU:stock_on_hand',
      'NZ:purchase_order',
    ])
  })

  it('keeps one-country custom-address lines in exact legacy fulfilment order', () => {
    const stock = { id: 'stock', ship_country: 'NZ', fulfilment_type: 'stocked' }
    const production = {
      id: 'production',
      ship_country: 'NZ',
      fulfilment_type: 'made_to_order',
    }

    const partitions = partitionByCountryAndFulfilment([stock, production], ['NZ'])

    expect(partitions.map(({ orderType, lines }) => ({ orderType, lines }))).toStrictEqual([
      { orderType: 'purchase_order', lines: [production] },
      { orderType: 'stock_on_hand', lines: [stock] },
    ])
  })

  it('returns no country partitions for an empty cart', () => {
    expect(partitionByCountryAndFulfilment([])).toStrictEqual([])
  })
})
