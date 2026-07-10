import { describe, it, expect } from 'vitest'
import { hideVolumeDisplayBands, type DisplayBracket } from '../volume-display-bands'

const bands: DisplayBracket[] = [
  { min_quantity: 24, max_quantity: 49, unit_price: 40 },
  { min_quantity: 50, max_quantity: 99, unit_price: 35 },
  { min_quantity: 100, max_quantity: null, unit_price: 30 },
]

describe('hideVolumeDisplayBands', () => {
  it('returns all bands when the hidden set is empty', () => {
    expect(hideVolumeDisplayBands(bands, [])).toEqual(bands)
  })

  it('returns all bands when the hidden set is null/undefined', () => {
    expect(hideVolumeDisplayBands(bands, null)).toEqual(bands)
    expect(hideVolumeDisplayBands(bands, undefined)).toEqual(bands)
  })

  it('drops bands whose min_quantity is in the hidden set', () => {
    expect(hideVolumeDisplayBands(bands, [24, 50])).toEqual([
      { min_quantity: 100, max_quantity: null, unit_price: 30 },
    ])
  })

  it('ignores hidden mins that match no band', () => {
    expect(hideVolumeDisplayBands(bands, [999])).toEqual(bands)
  })

  it('does not mutate the input', () => {
    const copy = [...bands]
    hideVolumeDisplayBands(bands, [24])
    expect(bands).toEqual(copy)
  })
})
