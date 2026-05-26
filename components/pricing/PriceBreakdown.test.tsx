import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PriceBreakdown } from './PriceBreakdown'

const ob = {
  lines: [],
  grossSubtotal: 215.0,
  decorationTotal: 15.0,
  discountAmount: 0,
  netSubtotal: 215.0,
  gstRate: 0.15,
  gst: 32.25,
  total: 247.25,
}

describe('PriceBreakdown', () => {
  it('cart-totals variant renders garments, decoration, GST, total', () => {
    render(<PriceBreakdown breakdown={ob} variant="cart-totals" />)
    expect(screen.getByText(/Garments/i)).toBeDefined()
    expect(screen.getByText(/\$200\.00/)).toBeDefined()
    expect(screen.getByText(/\$15\.00/)).toBeDefined()
    expect(screen.getByText(/\$32\.25/)).toBeDefined()
    expect(screen.getByText(/\$247\.25/)).toBeDefined()
  })

  it('hides decoration line when decorationTotal is 0', () => {
    render(
      <PriceBreakdown
        breakdown={{ ...ob, decorationTotal: 0 }}
        variant="cart-totals"
      />
    )
    expect(screen.queryByText(/Decoration/i)).toBeNull()
  })

  it('never renders a discount line', () => {
    render(<PriceBreakdown breakdown={ob} variant="cart-totals" />)
    expect(screen.queryByText(/discount/i)).toBeNull()
  })

  it('honours a custom format prop in place of NZD fallback', () => {
    const format = (n: number) => `A$${(n * 0.9).toFixed(2)}`
    render(<PriceBreakdown breakdown={ob} variant="cart-totals" format={format} />)
    // (215 - 15) * 0.9 = 180.00
    expect(screen.getByText(/A\$180\.00/)).toBeDefined()
    // 247.25 * 0.9 = 222.525 -> 222.53
    expect(screen.getByText(/A\$222\.53/)).toBeDefined()
    // NZD-formatted strings should be absent.
    expect(screen.queryByText(/\$215\.00/)).toBeNull()
  })
})
