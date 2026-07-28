import { describe, expect, it } from 'vitest'
import { hasMultiple, nextIndex, prevIndex } from '../image-lightbox-helpers'

describe('lightbox index helpers', () => {
  it('nextIndex wraps from last back to first', () => {
    expect(nextIndex(0, 3)).toBe(1)
    expect(nextIndex(2, 3)).toBe(0)
  })

  it('prevIndex wraps from first to last', () => {
    expect(prevIndex(0, 3)).toBe(2)
    expect(prevIndex(2, 3)).toBe(1)
  })

  it('helpers stay at 0 for an empty list', () => {
    expect(nextIndex(0, 0)).toBe(0)
    expect(prevIndex(0, 0)).toBe(0)
  })

  it('hasMultiple is true only when length > 1', () => {
    expect(hasMultiple(1)).toBe(false)
    expect(hasMultiple(2)).toBe(true)
  })
})
