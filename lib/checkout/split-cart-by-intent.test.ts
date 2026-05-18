import { describe, expect, it } from 'vitest'
import { splitCartByIntent } from './split-cart-by-intent'
import type { CheckoutLineInput } from './submit'

function line(opts: { id: string; route?: boolean }): CheckoutLineInput {
  return {
    product_id: opts.id,
    product_name: `Product ${opts.id}`,
    qty: 1,
    route_to_inventory: opts.route,
  }
}

describe('splitCartByIntent', () => {
  it('returns two empty buckets for empty input', () => {
    expect(
      splitCartByIntent({ lines: [], fastPathEntireOrderToInventory: false }),
    ).toEqual({ customer: [], inventory: [] })
    expect(
      splitCartByIntent({ lines: [], fastPathEntireOrderToInventory: true }),
    ).toEqual({ customer: [], inventory: [] })
  })

  it('fast-path on routes every line to inventory regardless of flags', () => {
    const lines = [
      line({ id: 'a' }),
      line({ id: 'b', route: true }),
      line({ id: 'c', route: false }),
    ]
    const out = splitCartByIntent({ lines, fastPathEntireOrderToInventory: true })
    expect(out.customer).toEqual([])
    expect(out.inventory).toHaveLength(3)
    expect(out.inventory.map((l) => l.product_id)).toEqual(['a', 'b', 'c'])
  })

  it('fast-path off splits by per-line flag', () => {
    const lines = [
      line({ id: 'a', route: true }),
      line({ id: 'b' }),
      line({ id: 'c', route: false }),
      line({ id: 'd', route: true }),
    ]
    const out = splitCartByIntent({ lines, fastPathEntireOrderToInventory: false })
    expect(out.customer.map((l) => l.product_id)).toEqual(['b', 'c'])
    expect(out.inventory.map((l) => l.product_id)).toEqual(['a', 'd'])
  })

  it('fast-path off with no flagged lines puts everything in customer', () => {
    const lines = [line({ id: 'a' }), line({ id: 'b', route: false }), line({ id: 'c' })]
    const out = splitCartByIntent({ lines, fastPathEntireOrderToInventory: false })
    expect(out.inventory).toEqual([])
    expect(out.customer.map((l) => l.product_id)).toEqual(['a', 'b', 'c'])
  })

  it('fast-path off with every line flagged puts everything in inventory', () => {
    const lines = [
      line({ id: 'a', route: true }),
      line({ id: 'b', route: true }),
      line({ id: 'c', route: true }),
    ]
    const out = splitCartByIntent({ lines, fastPathEntireOrderToInventory: false })
    expect(out.customer).toEqual([])
    expect(out.inventory.map((l) => l.product_id)).toEqual(['a', 'b', 'c'])
  })
})
