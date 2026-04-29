import { describe, expect, it } from 'vitest'
import { TIER_LABELS, getTierLabel } from './tier-labels'

describe('tier-labels', () => {
  it('exposes the locked tier-name map', () => {
    expect(TIER_LABELS).toEqual({
      1: 'Wholesale',
      2: 'Trade',
      3: 'Standard',
    })
  })

  it('returns the label for a known numeric tier', () => {
    expect(getTierLabel(1)).toBe('Wholesale')
    expect(getTierLabel(2)).toBe('Trade')
    expect(getTierLabel(3)).toBe('Standard')
  })

  it('accepts numeric strings (e.g. from B2BCustomerAccess.tier="2")', () => {
    expect(getTierLabel('2')).toBe('Trade')
  })

  it('returns null for unknown / null / non-numeric tiers', () => {
    expect(getTierLabel(null)).toBeNull()
    expect(getTierLabel(undefined)).toBeNull()
    expect(getTierLabel(99)).toBeNull()
    expect(getTierLabel('Custom')).toBeNull()
    expect(getTierLabel('bronze')).toBeNull()
  })
})
