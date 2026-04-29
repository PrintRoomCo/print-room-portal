import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PriceBreakdown } from './PriceBreakdown'

const ob = {
  lines: [],
  grossSubtotal: 215.0,
  decorationTotal: 15.0,
  discountAmount: 20.0,
  netSubtotal: 195.0,
  gstRate: 0.15,
  gst: 29.25,
  total: 224.25,
}

describe('PriceBreakdown', () => {
  it('cart-totals variant renders subtotal, decoration, discount, GST, total', () => {
    render(
      <PriceBreakdown
        breakdown={ob}
        pricingMode="tiered"
        tierLabel="Trade"
        tierDiscount={0.1}
        variant="cart-totals"
      />
    )
    expect(screen.getByText(/\$215\.00/)).toBeDefined() // gross subtotal
    expect(screen.getByText(/\$15\.00/)).toBeDefined() // decoration total
    expect(screen.getByText(/Trade/)).toBeDefined() // discount line label
    expect(screen.getByText(/−\$20\.00/)).toBeDefined() // discount line
    expect(screen.getByText(/\$29\.25/)).toBeDefined() // GST
    expect(screen.getByText(/\$224\.25/)).toBeDefined() // total
  })

  it('catalogue mode hides the discount line', () => {
    render(
      <PriceBreakdown
        breakdown={{
          ...ob,
          discountAmount: 0,
          netSubtotal: 215.0,
          gst: 32.25,
          total: 247.25,
        }}
        pricingMode="catalogue"
        tierLabel="Wholesale"
        tierDiscount={0.1}
        variant="cart-totals"
      />
    )
    expect(screen.queryByText(/discount/i)).toBeNull()
  })

  it('hides decoration line when decorationTotal is 0', () => {
    render(
      <PriceBreakdown
        breakdown={{ ...ob, decorationTotal: 0 }}
        pricingMode="tiered"
        tierLabel="Trade"
        tierDiscount={0.1}
        variant="cart-totals"
      />
    )
    expect(screen.queryByText(/Decoration/i)).toBeNull()
  })
})
