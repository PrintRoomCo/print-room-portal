import { describe, it, expect } from 'vitest'
import { displayCurrencyTotals } from './display-totals'
import type { ExchangeRates } from '@/lib/currency/types'

const rates: ExchangeRates = { NZD: 1, AUD: 0.8, USD: 0.6, GBP: 0.44, EUR: 0.51 }

describe('displayCurrencyTotals', () => {
  it('collapses per-billing-currency totals into one summed display figure', () => {
    const result = displayCurrencyTotals(
      [
        { currency: 'NZD', total: 100 },
        { currency: 'AUD', total: 80 },
      ],
      'USD',
      rates,
    )
    // 100 NZD -> 60 USD, 80 AUD -> 60 USD.
    expect(result).toEqual([{ currency: 'USD', total: 120 }])
  })

  it('passes a single total already in the display currency through unchanged', () => {
    expect(displayCurrencyTotals([{ currency: 'NZD', total: 115 }], 'NZD', rates)).toEqual([
      { currency: 'NZD', total: 115 },
    ])
  })

  it('returns the exact billing totals when rates are absent', () => {
    const totals = [{ currency: 'AUD', total: 80 }]
    expect(displayCurrencyTotals(totals, 'USD', null)).toBe(totals)
  })

  it('returns the exact billing totals when any currency cannot be cross-rated', () => {
    const totals = [
      { currency: 'NZD', total: 100 },
      { currency: 'JPY', total: 5000 },
    ]
    expect(displayCurrencyTotals(totals, 'USD', rates)).toBe(totals)
  })

  it('leaves an empty list empty rather than inventing a zero total', () => {
    expect(displayCurrencyTotals([], 'USD', rates)).toEqual([])
  })
})
