import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { Money } from '../Money'

vi.mock('@/contexts/CurrencyContext', () => ({
  useCurrency: () => ({
    currency: 'USD',
    loading: false,
    format: (amount: number) => `BASE>USD ${amount.toFixed(2)}`,
    formatFrom: (amount: number, sourceCurrency: string) =>
      `${sourceCurrency}>USD ${amount.toFixed(2)}`,
  }),
}))

// The pre-D8 rule from be9e931 ("an authored currency bypasses visitor
// conversion") moved to the billing surfaces: /checkout/review renders
// authored figures verbatim via CountryBilledOrderSummary's default
// formatter. On shopping surfaces Money now converts; the rule is to convert
// wherever the number is not the number you will be billed.
describe('Money display conversion', () => {
  it('converts an amount denominated in sourceCurrency into the display currency', () => {
    render(<Money amount={25.5} sourceCurrency="AUD" />)
    expect(screen.getByText('AUD>USD 25.50')).toBeInTheDocument()
  })

  it('formats through the base-currency path when sourceCurrency is omitted', () => {
    render(<Money amount={25.5} />)
    expect(screen.getByText('BASE>USD 25.50')).toBeInTheDocument()
  })
})
