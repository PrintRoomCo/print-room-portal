import { describe, it, expect } from 'vitest'
import { applyVolumeDisplayFloor } from '../volume-display-floor'

const ladder = [
  { min_quantity: 24, max_quantity: 249, unit_price: 18.64 },
  { min_quantity: 250, max_quantity: 499, unit_price: 14.0 },
  { min_quantity: 500, max_quantity: null, unit_price: 11.68 },
]

describe('applyVolumeDisplayFloor', () => {
  it('returns bands untouched for a null/undefined/zero floor', () => {
    expect(applyVolumeDisplayFloor(ladder, null)).toEqual(ladder)
    expect(applyVolumeDisplayFloor(ladder, undefined)).toEqual(ladder)
    expect(applyVolumeDisplayFloor(ladder, 0)).toEqual(ladder)
  })

  it('clamps the straddling band up to the floor (24–249 → 100–249)', () => {
    expect(applyVolumeDisplayFloor(ladder, 100)).toEqual([
      { min_quantity: 100, max_quantity: 249, unit_price: 18.64 },
      { min_quantity: 250, max_quantity: 499, unit_price: 14.0 },
      { min_quantity: 500, max_quantity: null, unit_price: 11.68 },
    ])
  })

  it('hides bands that are entirely below the floor', () => {
    const fine = [
      { min_quantity: 1, max_quantity: 49, unit_price: 5 },
      { min_quantity: 50, max_quantity: 99, unit_price: 5 },
      { min_quantity: 100, max_quantity: 249, unit_price: 5 },
    ]
    expect(applyVolumeDisplayFloor(fine, 100)).toEqual([
      { min_quantity: 100, max_quantity: 249, unit_price: 5 },
    ])
  })

  it('clamps the unbounded tail band when the floor lands inside it', () => {
    expect(applyVolumeDisplayFloor(ladder, 600)).toEqual([
      { min_quantity: 600, max_quantity: null, unit_price: 11.68 },
    ])
  })

  it('leaves a band whose min already equals the floor unchanged', () => {
    expect(applyVolumeDisplayFloor(ladder, 250)).toEqual([
      { min_quantity: 250, max_quantity: 499, unit_price: 14.0 },
      { min_quantity: 500, max_quantity: null, unit_price: 11.68 },
    ])
  })
})
