import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TierBadge } from './TierBadge'

describe('TierBadge', () => {
  it('renders "Catalogue pricing" copy', () => {
    render(<TierBadge />)
    expect(screen.getByText(/Catalogue pricing/i)).toBeDefined()
  })

  it('still renders "Catalogue pricing" when given the legacy label/mode props', () => {
    render(<TierBadge label="Wholesale" pricingMode="catalogue" />)
    expect(screen.getByText(/Catalogue pricing/i)).toBeDefined()
  })
})
