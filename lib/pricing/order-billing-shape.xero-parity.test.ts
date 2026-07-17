import { describe, it, expect } from 'vitest'
import { billedOrderShape, type BilledLineInput } from './order-billing-shape'
import { buildDraftLines, buildPickFeeLine } from '@/lib/xero/draft-invoice'

/**
 * Parity: what checkout shows must equal what Xero drafts.
 *
 * This is the regression that would have caught the original defect — checkout
 * quoting $1,684.98 on an order Xero drafts at $17.25. It compares the ex-GST
 * figures because Xero applies tax itself: shape.billedSubtotal + pickingFee
 * against the sum of the draft's line amounts.
 *
 * The two sides reach the answer by genuinely different routes. The shape zeroes
 * on (fulfilmentType === 'stocked' && billingMode === 'prepaid') from cart data;
 * buildDraftLines zeroes on (qty_from_stock > 0 && key ∈ prepaidDrawnLineKeys)
 * from persisted quote_items. If those two ever stop agreeing, this fails.
 */

interface Fixture {
  cart: BilledLineInput
  /** The persisted quote_item the same line becomes. unit_price is all-in
   *  (submit.ts folds decoration in before the RPC). */
  xero: {
    product_id: string
    variant_id: string | null
    size_id: number | null
    qty_from_stock: number
    product_name: string
    quantity: number
    unit_price: number
    size_label: string | null
    decorations: null
    product_variants: null
  }
  /** True iff the variant is prepaid — feeds prepaidDrawnLineKeys. */
  prepaidVariant: boolean
}

function fixture(over: {
  lineId: string
  productId: string
  variantId: string
  qty: number
  allInUnitPrice: number
  fulfilmentType: 'stocked' | 'made_to_order'
  prepaidVariant: boolean
}): Fixture {
  return {
    cart: {
      lineId: over.lineId,
      qty: over.qty,
      unitPrice: over.allInUnitPrice,
      decorationPerUnit: 0,
      fulfilmentType: over.fulfilmentType,
      billingMode: over.prepaidVariant ? 'prepaid' : 'invoice_on_dispatch',
    },
    xero: {
      product_id: over.productId,
      variant_id: over.variantId,
      size_id: null,
      // The server's draw signal: a stocked line draws its full qty (no partial
      // draws); a made-to-order line draws none.
      qty_from_stock: over.fulfilmentType === 'stocked' ? over.qty : 0,
      product_name: over.lineId,
      quantity: over.qty,
      unit_price: over.allInUnitPrice,
      size_label: null,
      decorations: null,
      product_variants: null,
    },
    prepaidVariant: over.prepaidVariant,
  }
}

function xeroExGstTotal(fixtures: Fixture[], pickingFee: number): number {
  const prepaidDrawnLineKeys = new Set(
    fixtures
      .filter((f) => f.prepaidVariant)
      .map((f) => `${f.xero.product_id}::${f.xero.variant_id ?? ''}::${f.xero.size_id ?? ''}`),
  )
  const lines = buildDraftLines(
    fixtures.map((f) => f.xero),
    prepaidDrawnLineKeys,
  )
  if (pickingFee > 0) lines.push(buildPickFeeLine(pickingFee))
  return Math.round(lines.reduce((t, l) => t + l.quantity * l.unitAmount, 0) * 100) / 100
}

function assertParity(fixtures: Fixture[], shipCountry: string | null) {
  const shape = billedOrderShape({
    lines: fixtures.map((f) => f.cart),
    gstRate: 0.15,
    shipCountry,
  })
  // One Xero quote per partition, so compare per partition.
  for (const partition of shape.partitions) {
    const ids = new Set(partition.lines.map((l) => l.lineId))
    const mine = fixtures.filter((f) => ids.has(f.cart.lineId))
    expect(xeroExGstTotal(mine, partition.pickingFee)).toBe(
      Math.round((partition.billedSubtotal + partition.pickingFee) * 100) / 100,
    )
  }
  return shape
}

describe('checkout <-> Xero draft parity', () => {
  it('agrees on a prepaid stock draw (the original defect)', () => {
    const shape = assertParity(
      [
        fixture({
          lineId: 'tee',
          productId: 'p1',
          variantId: 'v1',
          qty: 120,
          allInUnitPrice: 12.21,
          fulfilmentType: 'stocked',
          prepaidVariant: true,
        }),
      ],
      'NZ',
    )
    // Pin the actual numbers so a future change to BOTH sides in lockstep still
    // has to be deliberate.
    expect(shape.partitions[0].billedSubtotal).toBe(0)
    expect(shape.partitions[0].pickingFee).toBe(15)
  })

  it('agrees on a non-prepaid stock order', () => {
    assertParity(
      [
        fixture({
          lineId: 'tee',
          productId: 'p1',
          variantId: 'v1',
          qty: 10,
          allInUnitPrice: 50,
          fulfilmentType: 'stocked',
          prepaidVariant: false,
        }),
      ],
      'NZ',
    )
  })

  it('agrees on a prepaid variant ordered made-to-order (charged both sides)', () => {
    const shape = assertParity(
      [
        fixture({
          lineId: 'hoodie',
          productId: 'p2',
          variantId: 'v2',
          qty: 10,
          allInUnitPrice: 40,
          fulfilmentType: 'made_to_order',
          prepaidVariant: true,
        }),
      ],
      'NZ',
    )
    expect(shape.partitions[0].billedSubtotal).toBe(400)
  })

  it('agrees on a mixed cart, per partition', () => {
    const shape = assertParity(
      [
        fixture({
          lineId: 'tee',
          productId: 'p1',
          variantId: 'v1',
          qty: 120,
          allInUnitPrice: 12.21,
          fulfilmentType: 'stocked',
          prepaidVariant: true,
        }),
        fixture({
          lineId: 'hoodie',
          productId: 'p2',
          variantId: 'v2',
          qty: 50,
          allInUnitPrice: 40,
          fulfilmentType: 'made_to_order',
          prepaidVariant: false,
        }),
      ],
      'NZ',
    )
    expect(shape.invoiceCount).toBe(2)
  })

  it('agrees on a non-NZ order (no fee either side)', () => {
    assertParity(
      [
        fixture({
          lineId: 'tee',
          productId: 'p1',
          variantId: 'v1',
          qty: 120,
          allInUnitPrice: 12.21,
          fulfilmentType: 'stocked',
          prepaidVariant: true,
        }),
      ],
      'Australia',
    )
  })
})
