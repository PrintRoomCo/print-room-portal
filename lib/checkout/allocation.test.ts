import { describe, it, expect } from 'vitest'
import { allocatedForLine, lineFollowsDefault, remainingForLine } from './allocation'

const allocations = { 'l-s': { d1: 8, d2: 4 }, 'l-m': { d1: 10 } }

describe('allocatedForLine', () => {
  it('sums every destination on the line', () => {
    expect(allocatedForLine(allocations, 'l-s')).toBe(12)
  })

  it('reads an untouched line as zero rather than throwing', () => {
    expect(allocatedForLine(allocations, 'l-unknown')).toBe(0)
  })
})

describe('remainingForLine', () => {
  it('is zero when the line is exactly allocated', () => {
    expect(remainingForLine(allocations, 'l-s', 12)).toBe(0)
  })

  it('is positive while units are still unassigned', () => {
    expect(remainingForLine(allocations, 'l-m', 20)).toBe(10)
  })

  it('goes negative on over-allocation instead of clamping', () => {
    expect(remainingForLine(allocations, 'l-s', 10)).toBe(-2)
  })
})

describe('lineFollowsDefault', () => {
  it('is true for a line the customer never touched', () => {
    expect(lineFollowsDefault(allocations, 'l-other')).toBe(true)
  })

  it('is true for a line whose entries were all cleared', () => {
    expect(lineFollowsDefault({ 'l-s': {} }, 'l-s')).toBe(true)
  })

  it('is false as soon as one destination holds units', () => {
    expect(lineFollowsDefault(allocations, 'l-s')).toBe(false)
  })
})
