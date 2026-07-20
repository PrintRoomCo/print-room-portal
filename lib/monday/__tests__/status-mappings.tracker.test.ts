import { describe, it, expect } from 'vitest'
import { mapMondayToTrackerStatus } from '../status-mappings'

// The old 14-row stub recognised ~2 of ~40 real labels. It is now a thin
// wrapper over the engine, so the full live board resolves. These assertions
// are the ones the stub got WRONG (issue #77, Gate 2).
describe('mapMondayToTrackerStatus (engine wrapper)', () => {
  it('resolves real board labels the stub dropped', () => {
    expect(mapMondayToTrackerStatus('Assign to Production')).toBe('in-production')
    expect(mapMondayToTrackerStatus('Stock Ordered')).toBe('proof-approved')
    expect(mapMondayToTrackerStatus('Closed Job')).toBe('dispatched')
    expect(mapMondayToTrackerStatus('Ready to Pickup')).toBe('dispatched')
    expect(mapMondayToTrackerStatus('Need: Mockup (Quote Approved)')).toBe('quote-accepted-mockup')
  })

  it('still resolves the labels the stub already knew', () => {
    expect(mapMondayToTrackerStatus('Proof Approved')).toBe('proof-approved')
    expect(mapMondayToTrackerStatus('Shipped')).toBe('dispatched')
  })

  it('returns null for internal, hold, and unknown labels', () => {
    expect(mapMondayToTrackerStatus('Lost Job')).toBeNull()
    expect(mapMondayToTrackerStatus('Job on Hold')).toBeNull()
    expect(mapMondayToTrackerStatus('Totally Unknown')).toBeNull()
    expect(mapMondayToTrackerStatus(undefined)).toBeNull()
  })
})
