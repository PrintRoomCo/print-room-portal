import { describe, it, expect } from 'vitest'
import { effectivePermission, orderingOptions } from '../fulfilment-mode'

describe('effectivePermission', () => {
  it('org_admin is always both, ignoring the stored value', () => {
    expect(effectivePermission('org_admin', 'stock_only')).toBe('both')
    expect(effectivePermission('org_admin', null)).toBe('both')
  })
  it('staff uses the stored permission, defaulting to stock_only', () => {
    expect(effectivePermission('staff', 'reorder_only')).toBe('reorder_only')
    expect(effectivePermission('staff', null)).toBe('stock_only')
  })
})

describe('orderingOptions (product nature ∩ member permission)', () => {
  const cases: Array<[Parameters<typeof orderingOptions>[0], Parameters<typeof orderingOptions>[1], { draw: boolean; reorder: boolean; dead: boolean }]> = [
    ['stocked', 'stock_only',   { draw: true,  reorder: false, dead: false }],
    ['stocked', 'reorder_only', { draw: false, reorder: false, dead: true  }],
    ['stocked', 'both',         { draw: true,  reorder: false, dead: false }],
    ['made_to_order', 'stock_only',   { draw: false, reorder: false, dead: true  }],
    ['made_to_order', 'reorder_only', { draw: false, reorder: true,  dead: false }],
    ['made_to_order', 'both',         { draw: false, reorder: true,  dead: false }],
    ['mixed', 'stock_only',   { draw: true,  reorder: false, dead: false }],
    ['mixed', 'reorder_only', { draw: false, reorder: true,  dead: false }],
    ['mixed', 'both',         { draw: true,  reorder: true,  dead: false }],
  ]
  it.each(cases)('%s × %s', (nature, perm, expected) => {
    expect(orderingOptions(nature, perm)).toEqual({
      canDrawStock: expected.draw,
      canReorder: expected.reorder,
      deadZone: expected.dead,
    })
  })
})
