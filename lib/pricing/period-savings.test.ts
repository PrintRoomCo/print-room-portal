import { describe, expect, it } from 'vitest'
import { calculatePeriodSavingsOpportunity } from './period-savings'

describe('calculatePeriodSavingsOpportunity', () => {
  const duffelBands = [
    { minQuantity: 1, unitPrice: 32.12 },
    { minQuantity: 24, unitPrice: 32.12 },
    { minQuantity: 50, unitPrice: 32.12 },
    { minQuantity: 100, unitPrice: 30.14 },
    { minQuantity: 250, unitPrice: 19.15 },
  ]

  it('skips same-price bands and includes this franchise quantity', () => {
    expect(
      calculatePeriodSavingsOpportunity({
        networkQty: 0,
        franchiseQty: 48,
        bands: duffelBands,
      }),
    ).toEqual({
      projectedNetworkQty: 48,
      unitsToNextSaving: 52,
      currentUnitPrice: 32.12,
      nextUnitPrice: 30.14,
      perUnitSavings: 1.98,
      franchiseSavings: 95.04,
    })
  })

  it('uses the projected network tier before finding the next saving', () => {
    expect(
      calculatePeriodSavingsOpportunity({
        networkQty: 75,
        franchiseQty: 48,
        bands: duffelBands,
      }),
    ).toEqual({
      projectedNetworkQty: 123,
      unitsToNextSaving: 127,
      currentUnitPrice: 30.14,
      nextUnitPrice: 19.15,
      perUnitSavings: 10.99,
      franchiseSavings: 527.52,
    })
  })
})
