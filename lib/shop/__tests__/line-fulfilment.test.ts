import { describe, it, expect } from 'vitest'
import { lineFulfilment, type LineFulfilmentContext } from '../fulfilment-mode'

function ctx(overrides: Partial<LineFulfilmentContext> = {}): LineFulfilmentContext {
  return {
    canDrawStock: true,
    canChooseOrderIntent: false,
    orderIntent: 'inventory',
    tracked: true,
    available: 10,
    backorderable: false,
    lineQty: 5,
    ...overrides,
  }
}

describe('lineFulfilment', () => {
  // Toggle path — unchanged behaviour, toggle choice wins.
  it('toggle + bulk → made_to_order', () => {
    expect(
      lineFulfilment(ctx({ canChooseOrderIntent: true, orderIntent: 'bulk' })),
    ).toBe('made_to_order')
  })
  it('toggle + inventory → stocked', () => {
    expect(
      lineFulfilment(ctx({ canChooseOrderIntent: true, orderIntent: 'inventory' })),
    ).toBe('stocked')
  })

  // THE BUG: no draw path (made_to_order product / reorder_only member) must
  // never claim a stock draw — regardless of tracking state.
  it('no draw path + untracked cell → made_to_order (regression: TEST-000080)', () => {
    expect(
      lineFulfilment(ctx({ canDrawStock: false, tracked: false, available: 0 })),
    ).toBe('made_to_order')
  })
  it('no draw path + tracked cell with plenty of stock → made_to_order', () => {
    expect(
      lineFulfilment(ctx({ canDrawStock: false, tracked: true, available: 100, lineQty: 5 })),
    ).toBe('made_to_order')
  })

  // Drawable product, per-cell routing — unchanged behaviour.
  it('drawable + backorderable → made_to_order', () => {
    expect(lineFulfilment(ctx({ backorderable: true }))).toBe('made_to_order')
  })
  it('drawable + tracked + qty within stock → stocked', () => {
    expect(lineFulfilment(ctx({ tracked: true, available: 10, lineQty: 5 }))).toBe('stocked')
  })
  it('drawable + tracked + qty exactly at stock → stocked (boundary)', () => {
    expect(lineFulfilment(ctx({ tracked: true, available: 5, lineQty: 5 }))).toBe('stocked')
  })
  it('drawable + tracked + qty over stock → made_to_order', () => {
    expect(lineFulfilment(ctx({ tracked: true, available: 4, lineQty: 5 }))).toBe('made_to_order')
  })

  // Flipped default: drawable product but THIS cell has no inventory row —
  // there is nothing to draw, so it is a production run.
  it('drawable + untracked cell → made_to_order', () => {
    expect(lineFulfilment(ctx({ tracked: false, available: 0 }))).toBe('made_to_order')
  })
})
