import { describe, it, expect } from 'vitest'
import { pickDesignName } from '../customer-rows'

// Stock is blank+colourway grain (no design dimension). The design name is only
// safe to show when the org has exactly one active design skinning the blank —
// otherwise the stock is pooled and the UI falls back to the garment name.
describe('pickDesignName', () => {
  it('returns the name when exactly one active design maps to the blank', () => {
    expect(pickDesignName(['AF Logo Tee'])).toBe('AF Logo Tee')
  })

  it('dedupes identical names to one unambiguous name', () => {
    expect(pickDesignName(['AF Logo Tee', 'AF Logo Tee'])).toBe('AF Logo Tee')
  })

  it('returns null when two distinct designs share the blank (pooled stock)', () => {
    expect(pickDesignName(['AF Logo Tee', 'Bootcamp 2026 Tee'])).toBeNull()
  })

  it('returns null when no design maps to the blank', () => {
    expect(pickDesignName([])).toBeNull()
  })

  it('ignores empty and whitespace-only names', () => {
    expect(pickDesignName(['', '  ', 'AF Logo Tee'])).toBe('AF Logo Tee')
    expect(pickDesignName([null, undefined, ''])).toBeNull()
  })
})
