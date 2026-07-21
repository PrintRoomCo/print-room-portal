import { describe, it, expect } from 'vitest'
import { milestoneForLabel, milestoneEmailType } from '../milestone-email'

describe('milestoneForLabel', () => {
  it('maps the two in-production trigger labels', () => {
    expect(milestoneForLabel('Assign to Production')).toBe('in-production')
    expect(milestoneForLabel('All Production Complete')).toBe('in-production')
  })

  it('maps Shipped to dispatched', () => {
    expect(milestoneForLabel('Shipped')).toBe('dispatched')
  })

  it('is case- and punctuation-insensitive', () => {
    expect(milestoneForLabel('assign to production')).toBe('in-production')
    expect(milestoneForLabel('ASSIGN TO PRODUCTION')).toBe('in-production')
  })

  it('returns null for canonical-sibling labels that must NOT email', () => {
    // These all map to canonical in-production/dispatched in the status engine,
    // but are deliberately excluded from the email gate.
    expect(milestoneForLabel('Partially Shipped')).toBeNull()
    expect(milestoneForLabel('Trends - Ordered')).toBeNull()
    expect(milestoneForLabel('Closed Job')).toBeNull()
    expect(milestoneForLabel('Ready to Pickup')).toBeNull()
    expect(milestoneForLabel('Ship Direct to Client')).toBeNull()
  })

  it('returns null for proof / internal stages', () => {
    expect(milestoneForLabel('Sent: Proof+Invoice/Quote')).toBeNull()
    expect(milestoneForLabel('Need: Internal Proof Approval')).toBeNull()
    expect(milestoneForLabel('Job on Hold')).toBeNull()
  })

  it('returns null for empty / nullish input', () => {
    expect(milestoneForLabel('')).toBeNull()
    expect(milestoneForLabel(null)).toBeNull()
    expect(milestoneForLabel(undefined)).toBeNull()
  })
})

describe('milestoneEmailType', () => {
  it('returns stable keys that do NOT encode trigger time', () => {
    expect(milestoneEmailType('in-production')).toBe('milestone-in-production')
    expect(milestoneEmailType('dispatched')).toBe('milestone-dispatched')
  })
})
