import { describe, it, expect } from 'vitest'
import {
  lineFulfilment,
  lineIsOrderable,
  type LineFulfilmentContext,
} from '../fulfilment-mode'

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

describe('lineIsOrderable', () => {
  // A stock_only member (canReorder === false) can only take a genuine stock
  // draw. This mirrors submit_b2b_order, which coerces such a member's line to
  // 'stocked' and then raises NO_INVENTORY / PERMISSION_DENIED when the cell is
  // untracked, backorderable, or over-stock. Blocking client-side turns the
  // opaque "not stocked for your account" 409 into an up-front unavailable cell.

  // THE BUG: mixed product, stock_only member, colourway with no inventory row.
  // Old behaviour tagged it made_to_order and let it reach checkout at full price.
  it('stock_only + untracked cell → NOT orderable', () => {
    expect(
      lineIsOrderable(ctx({ tracked: false, available: 0 }), /* canReorder */ false),
    ).toBe(false)
  })

  it('stock_only + tracked, in-stock cell → orderable (the drawable path)', () => {
    expect(
      lineIsOrderable(ctx({ tracked: true, available: 10, lineQty: 5 }), false),
    ).toBe(true)
  })

  // Server rejects a stock_only member on a backorderable variant
  // (member_cannot_produce), so the client must not offer it either.
  it('stock_only + backorderable cell → NOT orderable', () => {
    expect(lineIsOrderable(ctx({ backorderable: true }), false)).toBe(false)
  })

  it('stock_only + tracked but qty over stock → NOT orderable', () => {
    expect(
      lineIsOrderable(ctx({ tracked: true, available: 4, lineQty: 5 }), false),
    ).toBe(false)
  })

  // Members who CAN reorder are unaffected: an untracked cell is a legitimate
  // production run for them.
  it('canReorder + untracked cell → orderable (no regression)', () => {
    expect(
      lineIsOrderable(ctx({ tracked: false, available: 0 }), /* canReorder */ true),
    ).toBe(true)
  })

  it('canReorder + made_to_order product cell → orderable', () => {
    expect(
      lineIsOrderable(ctx({ canDrawStock: false, tracked: false, available: 0 }), true),
    ).toBe(true)
  })
})
