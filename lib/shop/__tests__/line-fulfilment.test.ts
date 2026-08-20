import { describe, it, expect } from 'vitest'
import {
  lineFulfilment,
  lineIsOrderable,
  routeForFulfilmentType,
  type LineFulfilmentContext,
} from '../fulfilment-mode'

function ctx(overrides: Partial<LineFulfilmentContext> = {}): LineFulfilmentContext {
  return {
    canDrawStock: true,
    canChooseOrderIntent: false,
    orderIntent: 'inventory',
    tracked: true,
    available: 10,
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
  // untracked or over-stock. Blocking client-side turns the
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

describe('routeForFulfilmentType', () => {
  it('maps the two claims to the two DB routes', () => {
    expect(routeForFulfilmentType('stocked')).toBe('stock_draw')
    expect(routeForFulfilmentType('made_to_order')).toBe('purchase_order')
  })

  it('sends nothing for a legacy line that made no claim', () => {
    // NULL means "nobody said", which the RPC answers with the item's own mode
    // — the same MOQ-conservative treatment partitionCheckoutLines applies.
    expect(routeForFulfilmentType(undefined)).toBeNull()
    expect(routeForFulfilmentType(null)).toBeNull()
  })
})

describe('lineFulfilment without the retired backorder flag', () => {
  it('an out-of-stock tracked cell is a production run, not a bypass', () => {
    // The flag used to short-circuit to made_to_order here. It is retired; the
    // over-stock comparison already reaches the same answer.
    expect(
      lineFulfilment({
        canDrawStock: true, canChooseOrderIntent: false, orderIntent: 'inventory',
        tracked: true, available: 0, lineQty: 5,
      }),
    ).toBe('made_to_order')
  })

  it('still draws stock when there is enough of it', () => {
    expect(
      lineFulfilment({
        canDrawStock: true, canChooseOrderIntent: false, orderIntent: 'inventory',
        tracked: true, available: 10, lineQty: 5,
      }),
    ).toBe('stocked')
  })
})
