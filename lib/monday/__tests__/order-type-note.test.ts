import { describe, it, expect } from 'vitest'
import { stockOnHandMondayNote, STOCK_ON_HAND_MONDAY_NOTE } from '../order-type-note'

describe('stockOnHandMondayNote', () => {
  it('returns the fixed production-hold copy for stock_on_hand', () => {
    expect(stockOnHandMondayNote('stock_on_hand')).toBe(
      'Stock-on-hand order — pull from existing stock. Do not produce. Xero draft quote raised — invoice before dispatch.',
    )
    expect(stockOnHandMondayNote('stock_on_hand')).toBe(STOCK_ON_HAND_MONDAY_NOTE)
  })

  it('returns null for purchase_order (no note)', () => {
    expect(stockOnHandMondayNote('purchase_order')).toBeNull()
  })
})
