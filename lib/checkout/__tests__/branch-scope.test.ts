import { describe, expect, it } from 'vitest'
import { checkStaffBranchScope } from '@/lib/checkout/branch-scope'

const base = { allOneTimeLines: false, hasCustomShippingAddress: false }

describe('checkStaffBranchScope', () => {
  it('plain staff (allowed=[default]) — all lines = default => ok', () => {
    expect(checkStaffBranchScope({ ...base, shipToStoreIds: ['home', 'home'], allowedBranches: ['home'] }))
      .toEqual({ ok: true })
  })
  it('plain staff — a line off the default => out_of_scope (today BuyerScopeError)', () => {
    expect(checkStaffBranchScope({ ...base, shipToStoreIds: ['home', 'other'], allowedBranches: ['home'] }))
      .toEqual({ ok: false, kind: 'out_of_scope', mismatched: ['other'] })
  })
  it('manager — all lines on one granted branch => ok', () => {
    expect(checkStaffBranchScope({ ...base, shipToStoreIds: ['b', 'b'], allowedBranches: ['home', 'b', 'c'] }))
      .toEqual({ ok: true })
  })
  it('manager — an ungranted branch => out_of_scope', () => {
    expect(checkStaffBranchScope({ ...base, shipToStoreIds: ['x'], allowedBranches: ['home', 'b'] }))
      .toEqual({ ok: false, kind: 'out_of_scope', mismatched: ['x'] })
  })
  it('manager — two granted branches in one order => mixed_branch', () => {
    expect(checkStaffBranchScope({ ...base, shipToStoreIds: ['b', 'c'], allowedBranches: ['home', 'b', 'c'] }))
      .toEqual({ ok: false, kind: 'mixed_branch' })
  })
  it('all one-time lines + custom address => ok (null lines exempt)', () => {
    expect(checkStaffBranchScope({ shipToStoreIds: [null, null], allowedBranches: ['home'], allOneTimeLines: true, hasCustomShippingAddress: true }))
      .toEqual({ ok: true })
  })
})
