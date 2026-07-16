import { describe, it, expect } from 'vitest'
import { pickingFeeForGoods } from './picking-fee'

describe('pickingFeeForGoods (NZ band table)', () => {
  it.each([
    [0, 35], [50, 35], [99, 35], [99.99, 35],
    [100, 30], [199.99, 30],
    [200, 25], [299.99, 25],
    [300, 20], [399.99, 20],
    [400, 15], [10000, 15],
  ])('goods %d -> fee %d', (goods, fee) => {
    expect(pickingFeeForGoods(goods)).toBe(fee)
  })
  it('treats negative/NaN as the lowest band', () => {
    expect(pickingFeeForGoods(-5)).toBe(35)
    expect(pickingFeeForGoods(Number.NaN)).toBe(35)
  })
})
