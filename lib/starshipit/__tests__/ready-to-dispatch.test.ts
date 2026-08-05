import { describe, it, expect } from 'vitest'
import { isReadyToDispatchLabel } from '../ready-to-dispatch'

describe('isReadyToDispatchLabel', () => {
  it('matches "All Production Complete" (the ready-to-dispatch trigger)', () => {
    expect(isReadyToDispatchLabel('All Production Complete')).toBe(true)
  })
  it('is case- and punctuation-insensitive', () => {
    expect(isReadyToDispatchLabel('ALL PRODUCTION COMPLETE')).toBe(true)
    expect(isReadyToDispatchLabel('all  production   complete')).toBe(true)
  })
  it('rejects too-late labels (ticket must print BEFORE shipping)', () => {
    expect(isReadyToDispatchLabel('Shipped')).toBe(false)
    expect(isReadyToDispatchLabel('Closed Job')).toBe(false)
  })
  it('rejects too-early labels', () => {
    expect(isReadyToDispatchLabel('Assign to Production')).toBe(false)
  })
  it('rejects null/empty', () => {
    expect(isReadyToDispatchLabel(null)).toBe(false)
    expect(isReadyToDispatchLabel(undefined)).toBe(false)
    expect(isReadyToDispatchLabel('')).toBe(false)
  })
})
