import { describe, expect, it } from 'vitest'
import { resolveDecorationPrice } from './decoration-price'

describe('resolveDecorationPrice', () => {
  it('returns the catalogue override when set', () => {
    expect(resolveDecorationPrice({ override: 7.5, master: 3 })).toBe(7.5)
  })

  it('keeps an explicit zero override', () => {
    expect(resolveDecorationPrice({ override: 0, master: 3 })).toBe(0)
  })

  it('falls back to master when the override is nullish', () => {
    expect(resolveDecorationPrice({ override: null, master: 3 })).toBe(3)
    expect(resolveDecorationPrice({ override: undefined, master: 3 })).toBe(3)
  })

  it('returns zero when both values are nullish', () => {
    expect(resolveDecorationPrice({ override: null, master: null })).toBe(0)
    expect(resolveDecorationPrice({ override: undefined, master: undefined })).toBe(0)
  })

  it('coerces Supabase numeric strings', () => {
    expect(resolveDecorationPrice({ override: '7.5', master: '3.0' })).toBe(7.5)
    expect(resolveDecorationPrice({ override: null, master: '3.0' })).toBe(3)
  })
})
