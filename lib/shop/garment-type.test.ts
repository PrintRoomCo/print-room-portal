import { describe, it, expect } from 'vitest'
import {
  GARMENT_TYPES,
  isGarmentType,
  garmentTypeLabel,
} from './garment-type'

describe('GARMENT_TYPES', () => {
  it('is the canonical 15-value vocabulary that mirrors the staff portal + DB CHECK', () => {
    expect([...GARMENT_TYPES]).toEqual([
      'accessories',
      'bags',
      'belt',
      'crew',
      'headwear',
      'healthcare',
      'hoodie',
      'jacket',
      'pants',
      'polo',
      'scrubs',
      'shirt',
      'shorts',
      'tee',
      'vest',
    ])
  })

  it('drops the retired use-case values (corporate, trades) and includes bags', () => {
    expect(GARMENT_TYPES).not.toContain('corporate')
    expect(GARMENT_TYPES).not.toContain('trades')
    expect(GARMENT_TYPES).toContain('bags')
  })
})

describe('isGarmentType', () => {
  it('is true for a value in the vocabulary', () => {
    expect(isGarmentType('tee')).toBe(true)
    expect(isGarmentType('headwear')).toBe(true)
  })

  it('is false for a retired or unknown value', () => {
    expect(isGarmentType('corporate')).toBe(false)
    expect(isGarmentType('Tee')).toBe(false) // case-sensitive: raw DB values are lowercase
    expect(isGarmentType('something-else')).toBe(false)
  })

  it('is false for non-string input', () => {
    expect(isGarmentType(null)).toBe(false)
    expect(isGarmentType(undefined)).toBe(false)
    expect(isGarmentType(42)).toBe(false)
  })
})

describe('garmentTypeLabel', () => {
  it('nice-cases a raw garment type for display (first letter upper)', () => {
    expect(garmentTypeLabel('tee')).toBe('Tee')
    expect(garmentTypeLabel('headwear')).toBe('Headwear')
    expect(garmentTypeLabel('hoodie')).toBe('Hoodie')
  })

  it('leaves an already-capitalized value unchanged and tolerates empty string', () => {
    expect(garmentTypeLabel('Polo')).toBe('Polo')
    expect(garmentTypeLabel('')).toBe('')
  })
})
