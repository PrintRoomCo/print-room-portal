import { describe, it, expect } from 'vitest'
import { convertBetween, formatCurrency } from '../format'
import type { ExchangeRates } from '../types'

const rates: ExchangeRates = {
  NZD: 1,
  AUD: 0.83392,
  USD: 0.597219,
  GBP: 0.4423,
  EUR: 0.5121,
}

describe('convertBetween', () => {
  it('returns the amount untouched when from equals to', () => {
    expect(convertBetween(123.45, 'AUD', 'AUD', rates)).toBe(123.45)
  })

  it('converts from the NZD base exactly like the old convertNZD path', () => {
    expect(convertBetween(100, 'NZD', 'AUD', rates)).toBeCloseTo(83.392, 10)
  })

  it('cross-rates AUD to USD through the NZD-base table', () => {
    expect(convertBetween(100, 'AUD', 'USD', rates)).toBeCloseTo(
      (100 * 0.597219) / 0.83392,
      10,
    )
  })

  it('converts back toward the base by dividing out the from rate', () => {
    expect(convertBetween(83.392, 'AUD', 'NZD', rates)).toBeCloseTo(100, 10)
  })

  it('returns the amount unconverted when the from rate is missing', () => {
    const partial = { NZD: 1, USD: 0.597219 } as ExchangeRates
    expect(convertBetween(100, 'AUD', 'USD', partial)).toBe(100)
  })

  it('returns the amount unconverted when the from rate is zero', () => {
    expect(convertBetween(100, 'AUD', 'USD', { ...rates, AUD: 0 })).toBe(100)
  })

  it('returns the amount unconverted when the to rate is missing or zero', () => {
    const partial = { NZD: 1, AUD: 0.83392 } as ExchangeRates
    expect(convertBetween(100, 'AUD', 'USD', partial)).toBe(100)
    expect(convertBetween(100, 'AUD', 'USD', { ...rates, USD: 0 })).toBe(100)
  })
})

describe('formatCurrency', () => {
  it('formats with the currency-appropriate locale', () => {
    expect(formatCurrency(1234.5, 'NZD')).toBe('$1,234.50')
    expect(formatCurrency(1234.5, 'GBP')).toBe('£1,234.50')
  })
})
