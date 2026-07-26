import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { billedOrderShape } from '@/lib/pricing/order-billing-shape'
import { BilledOrderSummary } from './BilledOrderSummary'

const format = (n: number) => `$${n.toFixed(2)}`

function shapeFor(shipCountry: string) {
  // qty 10 × $12 all-in = $120 goods → NZ stock order lands in the $100–$199 band ($30 fee).
  return billedOrderShape({
    lines: [
      {
        lineId: 'l1',
        qty: 10,
        unitPrice: 12,
        decorationPerUnit: 0,
        fulfilmentType: 'stocked' as const,
        billingMode: null,
      },
    ],
    gstRate: 0.15,
    shipCountry,
  })
}

describe('BilledOrderSummary picking-fee info', () => {
  it('mounts the info button beside the fee row for an NZ stock order', () => {
    render(
      <BilledOrderSummary
        shape={shapeFor('New Zealand')}
        format={format}
        renderLine={(line) => <span>{line.lineId}</span>}
        defaultBreakdownOpen
      />,
    )
    expect(
      screen.getByRole('button', { name: 'How the picking fee is calculated' }),
    ).toBeInTheDocument()
  })

  it('renders no info button when there is no fee (non-NZ ship-to)', () => {
    render(
      <BilledOrderSummary
        shape={shapeFor('Australia')}
        format={format}
        renderLine={(line) => <span>{line.lineId}</span>}
        defaultBreakdownOpen
      />,
    )
    expect(
      screen.queryByRole('button', { name: 'How the picking fee is calculated' }),
    ).toBeNull()
  })
})
