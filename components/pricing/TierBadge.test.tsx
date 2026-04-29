import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TierBadge } from './TierBadge'

describe('TierBadge', () => {
  it('renders tier-suffixed pricing copy when label is present', () => {
    render(<TierBadge label="Wholesale" />)
    expect(screen.getByText(/Wholesale pricing/i)).toBeDefined()
  })

  it('renders catalogue copy in catalogue mode regardless of label', () => {
    render(<TierBadge label="Wholesale" pricingMode="catalogue" />)
    expect(screen.getByText(/Catalogue pricing/i)).toBeDefined()
  })

  it('returns null with no label and standard mode', () => {
    const { container } = render(<TierBadge label={null} pricingMode="standard" />)
    expect(container.firstChild).toBeNull()
  })
})
