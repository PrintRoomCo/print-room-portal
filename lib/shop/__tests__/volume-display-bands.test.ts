import { describe, it, expect } from 'vitest'
import {
  hideVolumeDisplayBands,
  orderVolumeDisplayBands,
  type DisplayBracket,
} from '../volume-display-bands'

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

describe('orderVolumeDisplayBands', () => {
  it('returns bands untouched for an empty / absent order', () => {
    expect(orderVolumeDisplayBands(bands, [])).toEqual(bands)
    expect(orderVolumeDisplayBands(bands, null)).toEqual(bands)
    expect(orderVolumeDisplayBands(bands, undefined)).toEqual(bands)
  })

  it('orders bands by the staff-dragged From qty sequence', () => {
    expect(orderVolumeDisplayBands(bands, [100, 24, 50]).map((b) => b.min_quantity))
      .toEqual([100, 24, 50])
  })

  it('appends bands missing from the order, ascending', () => {
    expect(orderVolumeDisplayBands(bands, [100]).map((b) => b.min_quantity))
      .toEqual([100, 24, 50])
  })

  it('treats an order entry matching no band as inert', () => {
    expect(orderVolumeDisplayBands(bands, [999, 50]).map((b) => b.min_quantity))
      .toEqual([50, 24, 100])
  })

  it('never drops or duplicates a band', () => {
    expect(orderVolumeDisplayBands(bands, [50, 50])).toHaveLength(bands.length)
  })

  it('does not mutate the input array', () => {
    const before = bands.map((b) => b.min_quantity)
    orderVolumeDisplayBands(bands, [100, 24, 50])
    expect(bands.map((b) => b.min_quantity)).toEqual(before)
  })

  it('composes with the hide filter — hide first, then order', () => {
    const shown = orderVolumeDisplayBands(hideVolumeDisplayBands(bands, [24]), [100, 50])
    expect(shown.map((b) => b.min_quantity)).toEqual([100, 50])
  })
})
