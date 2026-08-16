import { describe, it, expect } from 'vitest'
import { billedOrderShape, type BilledLineInput } from './order-billing-shape'

function line(over: Partial<BilledLineInput> = {}): BilledLineInput {
  return {
    lineId: 'l1',
    qty: 120,
    unitPrice: 12.21,
    decorationPerUnit: 0,
    fulfilmentType: 'stocked',
    billingMode: 'prepaid',
    ...over,
  }
}

const NZ = { gstRate: 0.15, shipCountry: 'NZ' as string | null }

// AU Stage 1 (spec §10 oracle): an AU org bills AUD at 10% GST and NEVER carries
// the NZD picking fee — even on an NZ ship-to. GST computes on billed goods + a
// zero fee at the AU rate.
const AU = { gstRate: 0.1, shipCountry: 'NZ' as string | null, orgRegion: 'AU' as string | null }

describe('billedOrderShape — AU org (AU Stage 1)', () => {
  it('drops the picking fee and computes GST at 0.10 on an NZ-ship-to stocked order', () => {
    const shape = billedOrderShape({
      lines: [line({ billingMode: 'invoice_on_dispatch' })],
      ...AU,
    })
    const p = shape.partitions[0]
    expect(p.orderType).toBe('stock_on_hand')
    expect(p.billedSubtotal).toBe(1465.2)
    expect(p.pickingFee).toBe(0)
    expect(p.gst).toBe(146.52) // round2(1465.2 * 0.10), no fee in the base
    expect(p.total).toBe(1611.72)
  })

  it('the same order as an NZ org keeps the fee and 15% (parity control)', () => {
    const shape = billedOrderShape({
      lines: [line({ billingMode: 'invoice_on_dispatch' })],
      ...NZ,
    })
    const p = shape.partitions[0]
    expect(p.pickingFee).toBe(15)
    expect(p.gst).toBe(222.03) // round2((1465.2 + 15) * 0.15)
  })
})

describe('billedOrderShape — zeroing', () => {
  // Chris's exact case: 120 x Staple Tee @ $12.21 drawn from prepaid stock.
  it('zeroes a prepaid stock draw and bills only the picking fee', () => {
    const shape = billedOrderShape({ lines: [line()], ...NZ })
    expect(shape.partitions).toHaveLength(1)
    const p = shape.partitions[0]
    expect(p.orderType).toBe('stock_on_hand')
    expect(p.lines[0].billed).toBe(false)
    expect(p.lines[0].billedUnitPrice).toBe(0)
    expect(p.lines[0].goodsValue).toBe(1465.2)
    expect(p.billedSubtotal).toBe(0)
    expect(p.prepaidGoodsValue).toBe(1465.2)
    expect(p.goodsValueForBand).toBe(1465.2)
    expect(p.pickingFee).toBe(15)
    expect(p.gst).toBe(2.25)
    expect(p.total).toBe(17.25)
    expect(shape.grandTotal).toBe(17.25)
    expect(shape.invoiceCount).toBe(1)
  })

  // The `nature` defect, now in money terms.
  it('CHARGES a made-to-order line of a prepaid variant', () => {
    const shape = billedOrderShape({
      lines: [line({ fulfilmentType: 'made_to_order', qty: 10, unitPrice: 20 })],
      ...NZ,
    })
    const p = shape.partitions[0]
    expect(p.orderType).toBe('purchase_order')
    expect(p.lines[0].billed).toBe(true)
    expect(p.lines[0].billedUnitPrice).toBe(20)
    expect(p.billedSubtotal).toBe(200)
    expect(p.prepaidGoodsValue).toBe(0)
  })

  it('charges a stocked line that is not prepaid', () => {
    const shape = billedOrderShape({
      lines: [line({ billingMode: 'invoice_on_dispatch', qty: 10, unitPrice: 50 })],
      ...NZ,
    })
    const p = shape.partitions[0]
    expect(p.lines[0].billed).toBe(true)
    expect(p.billedSubtotal).toBe(500)
    expect(p.pickingFee).toBe(15) // stock_on_hand order — fee applies as it does today
    expect(p.total).toBe(592.25) // 500 + 15 + 77.25
  })

  it('fails closed on a null billing mode (legacy line)', () => {
    const shape = billedOrderShape({
      lines: [line({ billingMode: null, qty: 10, unitPrice: 50 })],
      ...NZ,
    })
    expect(shape.partitions[0].lines[0].billed).toBe(true)
    expect(shape.partitions[0].billedSubtotal).toBe(500)
  })

  it('folds decoration into the all-in unit price', () => {
    const shape = billedOrderShape({
      lines: [line({ billingMode: 'invoice_on_dispatch', qty: 10, unitPrice: 20, decorationPerUnit: 5 })],
      ...NZ,
    })
    expect(shape.partitions[0].lines[0].goodsValue).toBe(250)
    expect(shape.partitions[0].billedSubtotal).toBe(250)
  })
})

describe('billedOrderShape — GST', () => {
  it('excludes prepaid goods from GST (GST rides on fee only)', () => {
    const shape = billedOrderShape({ lines: [line()], ...NZ })
    expect(shape.partitions[0].gst).toBe(2.25) // 15 * 0.15 — NOT (1465.20 + 15) * 0.15
  })

  it('applies GST to billed goods plus fee', () => {
    const shape = billedOrderShape({
      lines: [line({ billingMode: 'invoice_on_dispatch', qty: 10, unitPrice: 50 })],
      ...NZ,
    })
    expect(shape.partitions[0].gst).toBe(77.25) // (500 + 15) * 0.15
  })
})

describe('billedOrderShape — picking-fee band basis (D2)', () => {
  // D2 is only observable at a band boundary. Without pre-zeroing banding, a
  // prepaid order's goods read $0 and EVERY prepaid order would land in the
  // $0-99 band at $35 instead of its real band.
  it('bands on FULL goods, pre-zeroing — not on the billed $0', () => {
    const shape = billedOrderShape({ lines: [line()], ...NZ })
    expect(shape.partitions[0].goodsValueForBand).toBe(1465.2)
    expect(shape.partitions[0].pickingFee).toBe(15) // $400+ band, NOT the $35 of a $0 order
  })

  it.each([
    [99.99, 35],
    [100, 30],
    [199.99, 30],
    [200, 25],
    [299.99, 25],
    [300, 20],
    [399.99, 20],
    [400, 15],
  ])('goods %s -> fee %s at the band edge', (goods, fee) => {
    const shape = billedOrderShape({
      lines: [line({ qty: 1, unitPrice: goods, billingMode: 'prepaid' })],
      ...NZ,
    })
    expect(shape.partitions[0].goodsValueForBand).toBe(goods)
    expect(shape.partitions[0].pickingFee).toBe(fee)
  })

  // The case that makes D2 a real decision rather than a formality: current
  // catalogue price and the original prepaid purchase price straddle a boundary.
  // 25 x $12.21 = $305.25 -> $20 band. Had we banded on the original $10.50
  // (25 x $10.50 = $262.50) it would be the $25 band. Current price wins.
  it('bands on current catalogue price where original and current differ', () => {
    const shape = billedOrderShape({
      lines: [line({ qty: 25, unitPrice: 12.21 })],
      ...NZ,
    })
    expect(shape.partitions[0].goodsValueForBand).toBe(305.25)
    expect(shape.partitions[0].pickingFee).toBe(20)
  })

  it('bands on EVERY line in the partition, prepaid or not', () => {
    const shape = billedOrderShape({
      lines: [
        line({ lineId: 'a', qty: 10, unitPrice: 20, billingMode: 'prepaid' }), // 200, zeroed
        line({ lineId: 'b', qty: 10, unitPrice: 25, billingMode: 'invoice_on_dispatch' }), // 250, billed
      ],
      ...NZ,
    })
    const p = shape.partitions[0]
    expect(p.goodsValueForBand).toBe(450) // both lines
    expect(p.billedSubtotal).toBe(250) // only the billed one
    expect(p.pickingFee).toBe(15) // $400+ band off 450
  })
})

describe('billedOrderShape — region gate', () => {
  it.each([['Australia'], ['United States'], [''], [null]])(
    'no fee for a non-NZ ship-to (%s)',
    (shipCountry) => {
      const shape = billedOrderShape({
        lines: [line({ billingMode: 'invoice_on_dispatch' })],
        gstRate: 0.15,
        shipCountry: shipCountry as string | null,
      })
      expect(shape.partitions[0].pickingFee).toBe(0)
    },
  )
})

describe('billedOrderShape — mixed cart (D3)', () => {
  const mixed = () =>
    billedOrderShape({
      lines: [
        line({ lineId: 'tee', qty: 120, unitPrice: 12.21, fulfilmentType: 'stocked', billingMode: 'prepaid' }),
        line({
          lineId: 'hoodie',
          qty: 50,
          unitPrice: 40,
          fulfilmentType: 'made_to_order',
          billingMode: 'invoice_on_dispatch',
        }),
      ],
      ...NZ,
    })

  it('splits into two partitions, purchase_order first', () => {
    expect(mixed().partitions.map((p) => p.orderType)).toEqual(['purchase_order', 'stock_on_hand'])
    expect(mixed().invoiceCount).toBe(2)
  })

  it('gives the purchase order no picking fee', () => {
    const po = mixed().partitions[0]
    expect(po.pickingFee).toBe(0)
    expect(po.billedSubtotal).toBe(2000)
    expect(po.gst).toBe(300)
    expect(po.total).toBe(2300)
  })

  it('gives the stock order its own fee and total', () => {
    const stock = mixed().partitions[1]
    expect(stock.pickingFee).toBe(15)
    expect(stock.billedSubtotal).toBe(0)
    expect(stock.total).toBe(17.25)
  })

  it('sums to the grand total across both orders', () => {
    expect(mixed().grandTotal).toBe(2317.25)
    expect(mixed().billedSubtotal).toBe(2000)
  })
})

describe('billedOrderShape — edges', () => {
  it('returns an empty shape for an empty cart', () => {
    expect(billedOrderShape({ lines: [], ...NZ })).toEqual({
      partitions: [],
      grandTotal: 0,
      billedSubtotal: 0,
      invoiceCount: 0,
      gstRate: 0.15,
    })
  })

  it('treats an absent fulfilmentType as a purchase order (never zeroed)', () => {
    const shape = billedOrderShape({
      lines: [line({ fulfilmentType: undefined, qty: 10, unitPrice: 20 })],
      ...NZ,
    })
    expect(shape.partitions[0].orderType).toBe('purchase_order')
    expect(shape.partitions[0].lines[0].billed).toBe(true)
  })

  it('treats a negative decoration figure as 0', () => {
    const shape = billedOrderShape({
      lines: [line({ billingMode: 'invoice_on_dispatch', qty: 1, unitPrice: 100, decorationPerUnit: -5 })],
      ...NZ,
    })
    expect(shape.partitions[0].lines[0].goodsValue).toBe(100)
  })
})
