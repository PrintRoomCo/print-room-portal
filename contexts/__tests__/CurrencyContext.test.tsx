import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { CurrencyProvider, useCurrency } from '../CurrencyContext'
import { formatCurrency } from '@/lib/currency/format'
import type { ExchangeRates, SupportedCurrency } from '@/lib/currency/types'

// Keep the rates-absent test deterministic: the client-side rate fetch never
// resolves, so the provider stays in its fallback formatting path.
vi.mock('@/lib/currency/exchange-rates', () => ({
  fetchExchangeRates: () => new Promise(() => {}),
}))

const rates: ExchangeRates = { NZD: 1, AUD: 0.8, USD: 0.6, GBP: 0.44, EUR: 0.51 }
const storedValues = new Map<string, string>()
const localStorageStub: Storage = {
  get length() {
    return storedValues.size
  },
  clear: () => storedValues.clear(),
  getItem: (key) => storedValues.get(key) ?? null,
  key: (index) => Array.from(storedValues.keys())[index] ?? null,
  removeItem: (key) => storedValues.delete(key),
  setItem: (key, value) => storedValues.set(key, value),
}

function Probe() {
  const { currency, setCurrency, format, formatFrom, baseCurrency } = useCurrency()
  return (
    <div>
      <span data-testid="currency">{currency}</span>
      <span data-testid="base">{baseCurrency}</span>
      <span data-testid="formatted">{format(100)}</span>
      <span data-testid="from-aud">{formatFrom(100, 'AUD')}</span>
      <button type="button" onClick={() => setCurrency('USD')}>
        pick USD
      </button>
    </div>
  )
}

function renderProvider(props: {
  initialRates?: ExchangeRates | null
  initialCurrency?: SupportedCurrency
  baseCurrency?: SupportedCurrency
}) {
  return render(
    <CurrencyProvider {...props}>
      <Probe />
    </CurrencyProvider>,
  )
}

beforeEach(() => {
  vi.stubGlobal('localStorage', localStorageStub)
  localStorage.clear()
  document.cookie = 'prs-currency=; path=/; max-age=0'
})

describe('CurrencyProvider with an AUD base', () => {
  it('converts a base AUD amount into the picked display currency', () => {
    renderProvider({ initialRates: rates, initialCurrency: 'USD', baseCurrency: 'AUD' })
    // 100 AUD -> USD through the NZD-base table: 100 * 0.6 / 0.8 = 75.
    expect(screen.getByTestId('formatted')).toHaveTextContent(formatCurrency(75, 'USD'))
  })

  it('lets an AU org change currency, updating state and persistence', () => {
    renderProvider({ initialRates: rates, initialCurrency: 'AUD', baseCurrency: 'AUD' })
    expect(screen.getByTestId('currency')).toHaveTextContent('AUD')
    fireEvent.click(screen.getByRole('button', { name: 'pick USD' }))
    expect(screen.getByTestId('currency')).toHaveTextContent('USD')
    expect(localStorage.getItem('prs-currency')).toBe('USD')
    expect(document.cookie).toContain('prs-currency=USD')
  })

  it('formats in the base currency, not NZD, while rates are absent', () => {
    renderProvider({ initialRates: null, initialCurrency: 'USD', baseCurrency: 'AUD' })
    // No rates: fall back to the authored denomination rather than relabelling.
    expect(screen.getByTestId('formatted')).toHaveTextContent(formatCurrency(100, 'AUD'))
  })
})

describe('formatFrom', () => {
  it('converts an amount denominated in another supported currency into display', () => {
    renderProvider({ initialRates: rates, initialCurrency: 'NZD', baseCurrency: 'NZD' })
    // 100 AUD -> NZD: 100 * 1 / 0.8 = 125.
    expect(screen.getByTestId('from-aud')).toHaveTextContent(formatCurrency(125, 'NZD'))
  })

  it('renders an unconvertible amount verbatim in its own currency', () => {
    renderProvider({ initialRates: null, initialCurrency: 'USD', baseCurrency: 'NZD' })
    expect(screen.getByTestId('from-aud')).toHaveTextContent(formatCurrency(100, 'AUD'))
  })
})
