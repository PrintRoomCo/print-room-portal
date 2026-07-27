import { describe, expect, it, vi } from 'vitest'
import { resolveBranchStoreIds, buildStoreGrantDiff, getMemberBranchStoreIds } from '@/lib/orders/branch-grants'

describe('resolveBranchStoreIds', () => {
  it('unions grants with default and dedups', () => {
    expect(resolveBranchStoreIds(['a', 'b'], 'b').sort()).toEqual(['a', 'b'])
  })
  it('empty grants + default => [default]', () => {
    expect(resolveBranchStoreIds([], 'home')).toEqual(['home'])
  })
  it('empty grants + null default => []', () => {
    expect(resolveBranchStoreIds([], null)).toEqual([])
  })
})

describe('buildStoreGrantDiff', () => {
  it('computes inserts and deletes', () => {
    expect(buildStoreGrantDiff(['a', 'b'], ['b', 'c'])).toEqual({ toInsert: ['c'], toDelete: ['a'] })
  })
})

function admin(grants: string[]) {
  const b = { select: vi.fn(() => b), eq: vi.fn(async () => ({ data: grants.map((store_id) => ({ store_id })), error: null })) }
  return { from: vi.fn(() => b) } as never
}

describe('getMemberBranchStoreIds — view-side gate', () => {
  it('no grants => [] (plain staff keep own-orders-only)', async () => {
    expect(await getMemberBranchStoreIds(admin([]), 'm-1', 'home')).toEqual([])
  })
  it('has grants => grants ∪ default', async () => {
    expect((await getMemberBranchStoreIds(admin(['a']), 'm-1', 'home')).sort()).toEqual(['a', 'home'])
  })
})
