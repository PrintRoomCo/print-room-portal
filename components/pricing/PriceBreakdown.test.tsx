import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PriceBreakdown } from './PriceBreakdown'

const ob = {
  lines: [],
  grossSubtotal: 215.0,
  decorationTotal: 15.0,
  discountAmount: 0,
  netSubtotal: 215.0,
  pickingFee: 0,
  gstRate: 0.15,
  gst: 32.25,
  total: 247.25,
}

const obPdp = {
  lines: [
    {
      qty: 10,
      unitEffective: 21.5,
      unitGross: 21.5,
      decorationPerUnit: 1.5,
      lineGross: 230.0,
      lineDiscount: 0,
      lineNet: 230.0,
    },
  ],
  grossSubtotal: 230.0,
  decorationTotal: 15.0,
  discountAmount: 0,
  netSubtotal: 230.0,
  pickingFee: 0,
  gstRate: 0.15,
  gst: 34.5,
  total: 264.5,
}

describe('PriceBreakdown', () => {
  it('cart-totals variant renders all-in subtotal, GST, total', () => {
    render(<PriceBreakdown breakdown={ob} variant="cart-totals" />)
    expect(screen.getByText(/Subtotal/i)).toBeDefined()
    expect(screen.getByText(/\$215\.00/)).toBeDefined()
    expect(screen.getByText(/\$32\.25/)).toBeDefined()
    expect(screen.getByText(/\$247\.25/)).toBeDefined()
  })

  it('hides the raw decoration line even when decorationTotal is present', () => {
    render(
      <PriceBreakdown
        breakdown={ob}
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
    // 215 * 0.9 = 193.50
    expect(screen.getByText(/A\$193\.50/)).toBeDefined()
    // 247.25 * 0.9 = 222.525 -> 222.53
    expect(screen.getByText(/A\$222\.53/)).toBeDefined()
    // NZD-formatted strings should be absent.
    expect(screen.queryByText(/\$215\.00/)).toBeNull()
  })

  it('pdp variant renders a Per unit row from lines[0].unitEffective', () => {
    render(<PriceBreakdown breakdown={obPdp} variant="pdp" />)
    expect(screen.getByText(/Per unit/i)).toBeDefined()
    expect(screen.getByText(/\$21\.50/)).toBeDefined()
  })

  it('does not render a Per unit row for cart-totals', () => {
    render(<PriceBreakdown breakdown={obPdp} variant="cart-totals" />)
    expect(screen.queryByText(/Per unit/i)).toBeNull()
  })

  it('formats the Per unit value with a custom format prop', () => {
    const format = (n: number) => `A$${(n * 0.9).toFixed(2)}`
    render(<PriceBreakdown breakdown={obPdp} variant="pdp" format={format} />)
    // 21.50 * 0.9 = 19.35
    expect(screen.getByText(/A\$19\.35/)).toBeDefined()
  })

  it('renders a Picking fee row when pickingFee > 0', () => {
    render(
      <PriceBreakdown
        breakdown={{ ...ob, pickingFee: 30 }}
        variant="cart-totals"
      />,
    )
    expect(screen.getByText(/Picking fee/i)).toBeDefined()
    expect(screen.getByText(/\$30\.00/)).toBeDefined()
  })

  it('renders no Picking fee row when pickingFee is 0', () => {
    render(<PriceBreakdown breakdown={ob} variant="cart-totals" />)
    expect(screen.queryByText(/Picking fee/i)).toBeNull()
  })
})
