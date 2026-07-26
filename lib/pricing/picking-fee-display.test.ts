import { describe, expect, it } from 'vitest'
import { activeBandIndex, pickingFeeBandRows } from './picking-fee-display'

describe('pickingFeeBandRows', () => {
  it('derives one display row per band with inclusive ranges', () => {
    expect(pickingFeeBandRows()).toEqual([
      { range: '$0 – $99', fee: 35 },
      { range: '$100 – $199', fee: 30 },
      { range: '$200 – $299', fee: 25 },
      { range: '$300 – $399', fee: 20 },
      { range: '$400+', fee: 15 },
    ])
  })
})

describe('activeBandIndex', () => {
  it('maps a goods subtotal to its band', () => {
    expect(activeBandIndex(0)).toBe(0)
    expect(activeBandIndex(99.99)).toBe(0)
    expect(activeBandIndex(100)).toBe(1)
    expect(activeBandIndex(250)).toBe(2)
    expect(activeBandIndex(399.99)).toBe(3)
    expect(activeBandIndex(400)).toBe(4)
    expect(activeBandIndex(10_000)).toBe(4)
  })

  it('treats negative and non-finite input as $0', () => {
    expect(activeBandIndex(-5)).toBe(0)
    expect(activeBandIndex(Number.NaN)).toBe(0)
  })
})
