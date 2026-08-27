import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MinimumOrderNotice } from '../MinimumOrderNotice'

const GATED = {
  applies: true,
  met: false,
  threshold: 500,
  currency: 'NZD',
  value: 380,
  shortfall: 120,
}

describe('MinimumOrderNotice', () => {
  it('states the threshold, the value and the shortfall', () => {
    render(<MinimumOrderNotice status={GATED} />)
    const notice = screen.getByTestId('minimum-order-notice')
    expect(notice.textContent).toBe(
      'Made-to-order orders have a $500 minimum (excl. GST). This order is $380 — ' +
        'add $120 to continue, or talk to us about smaller runs.',
    )
  })

  it('renders the CTA as a mailto link with a prefilled subject', () => {
    render(<MinimumOrderNotice status={GATED} />)
    const link = screen.getByRole('link', { name: 'talk to us about smaller runs' })
    expect(link).toHaveAttribute(
      'href',
      `mailto:hello@theprint-room.co.nz?subject=${encodeURIComponent('Order below $500 minimum')}`,
    )
  })

  it('announces a hard block as an alert', () => {
    render(<MinimumOrderNotice status={GATED} />)
    expect(screen.getByRole('alert')).toBeTruthy()
  })

  it('uses the softer wording and a status role when tentative', () => {
    render(<MinimumOrderNotice status={GATED} tentative />)
    expect(screen.getByTestId('minimum-order-notice').textContent).toContain(
      'may be below the minimum at $380',
    )
    expect(screen.getByRole('status')).toBeTruthy()
  })
})
