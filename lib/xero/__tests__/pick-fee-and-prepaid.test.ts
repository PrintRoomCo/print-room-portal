import { describe, it, expect } from 'vitest'
import { buildPickFeeLine, prepaidZeroLine } from '../draft-invoice'

describe('Xero prepaid + pick-fee lines', () => {
  it('builds a single-unit pick-fee line', () => {
    expect(buildPickFeeLine(30)).toEqual({ description: 'Picking fee', quantity: 1, unitAmount: 30 })
  })
  it('zeroes a prepaid goods line (100% discount)', () => {
    const line = { description: 'Tee — Black / M', quantity: 24, unitAmount: 12.5 }
    expect(prepaidZeroLine(line)).toEqual({
      description: 'Tee — Black / M (prepaid stock — drawn down, no charge)', quantity: 24, unitAmount: 0,
    })
  })
})
