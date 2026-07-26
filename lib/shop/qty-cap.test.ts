import { describe, expect, it } from 'vitest'
import { qtyCapWarningFor } from './qty-cap'

describe('qtyCapWarningFor', () => {
  it('warns when the add pushes the product total over the cap', () => {
    expect(qtyCapWarningFor(15, 10, 20)).toEqual({ total: 25, max: 20 })
  })
  it('stays silent at or under the cap', () => {
    expect(qtyCapWarningFor(10, 10, 20)).toBeNull()
    expect(qtyCapWarningFor(0, 20, 20)).toBeNull()
  })
  it('no cap → never warns', () => {
    expect(qtyCapWarningFor(500, 500, null)).toBeNull()
  })
})
