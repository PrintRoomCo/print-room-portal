import { describe, it, expect } from 'vitest'
import {
  orderingPermissionOptions,
  defaultOrderingPermission,
} from './ordering-permission'

describe('orderingPermissionOptions (tenant-scoped)', () => {
  it('studios can only reorder (no stock to draw)', () => {
    expect(orderingPermissionOptions('studio')).toEqual(['reorder_only'])
  })
  it('inventory tenants get the full set', () => {
    expect(orderingPermissionOptions('franchise')).toEqual(['stock_only', 'reorder_only', 'both'])
    expect(orderingPermissionOptions('studio_plus_inventory')).toEqual(['stock_only', 'reorder_only', 'both'])
  })
  it('unknown/null tenant → full set (least restrictive default)', () => {
    expect(orderingPermissionOptions(null)).toEqual(['stock_only', 'reorder_only', 'both'])
  })
})

describe('defaultOrderingPermission', () => {
  it('studio → reorder_only', () => expect(defaultOrderingPermission('studio')).toBe('reorder_only'))
  it('inventory/null → stock_only', () => {
    expect(defaultOrderingPermission('franchise')).toBe('stock_only')
    expect(defaultOrderingPermission(null)).toBe('stock_only')
  })
})
