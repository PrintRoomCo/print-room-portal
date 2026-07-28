import { describe, expect, it } from 'vitest'
import {
  effectiveImageLayout,
  parseImageLayout,
} from './image-layout'

describe('image layout', () => {
  it('defaults malformed or missing product data to Standard views', () => {
    expect(parseImageLayout(undefined)).toBe('standard_views')
    expect(parseImageLayout('tiles')).toBe('standard_views')
  })

  it('lets an item override win and null inherit the master', () => {
    expect(
      effectiveImageLayout('merchandised_gallery', 'standard_views'),
    ).toBe('standard_views')
    expect(
      effectiveImageLayout('merchandised_gallery', null),
    ).toBe('merchandised_gallery')
  })
})
