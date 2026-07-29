import { describe, it, expect } from 'vitest'
import { garmentUnitPriceForLine } from '../submit'

// Explicit ex-GST stock sell price wins for a STOCK DRAW; the ladder price is
// the fallback. This figure feeds BOTH the billed unit price and the drift
// canonical, so a stock draw's cart claim (the explicit price) matches.
describe('garmentUnitPriceForLine', () => {
  const ladder = 12.5
  const map = new Map<string, number>([['item-1', 15]])

  it('a stock draw on an item with an explicit price uses the explicit price', () => {
    const price = garmentUnitPriceForLine(
      { fulfilment_type: 'stocked', catalogueItemId: 'item-1' },
      ladder,
      map,
    )
    expect(price).toBe(15)
  })

  it('a stock draw on an item with an explicit price of 0 uses 0 (free stock), not the ladder', () => {
    const price = garmentUnitPriceForLine(
      { fulfilment_type: 'stocked', catalogueItemId: 'item-free' },
      ladder,
      new Map([['item-free', 0]]),
    )
    expect(price).toBe(0)
  })

  it('a stock draw on an item with NO explicit price falls back to the ladder', () => {
    const price = garmentUnitPriceForLine(
      { fulfilment_type: 'stocked', catalogueItemId: 'item-2' },
      ladder,
      map,
    )
    expect(price).toBe(ladder)
  })

  it('a made_to_order line uses the ladder even if the item has an explicit stock price (mixed-item safety)', () => {
    const price = garmentUnitPriceForLine(
      { fulfilment_type: 'made_to_order', catalogueItemId: 'item-1' },
      ladder,
      map,
    )
    expect(price).toBe(ladder)
  })

  it('a line with no catalogueItemId uses the ladder', () => {
    const price = garmentUnitPriceForLine(
      { fulfilment_type: 'stocked', catalogueItemId: null },
      ladder,
      map,
    )
    expect(price).toBe(ladder)
  })

  it('a line with no fulfilment_type (legacy cart) uses the ladder', () => {
    const price = garmentUnitPriceForLine({ catalogueItemId: 'item-1' }, ladder, map)
    expect(price).toBe(ladder)
  })
})
