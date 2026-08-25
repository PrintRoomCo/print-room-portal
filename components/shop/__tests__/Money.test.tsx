import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { Money } from '../Money'

vi.mock('@/contexts/CurrencyContext', () => ({
  useCurrency: () => ({
    currency: 'NZD',
    loading: false,
    format: (amount: number) => `VISITOR-NZD ${amount.toFixed(2)}`,
  }),
}))

describe('Money canonical authored currency', () => {
  it('formats an authored AUD amount directly instead of applying visitor conversion', () => {
    render(<Money nzd={25.5} currency="AUD" />)
    expect(screen.getByText('$25.50')).toBeInTheDocument()
    expect(screen.queryByText(/VISITOR-NZD/)).not.toBeInTheDocument()
  })
})
