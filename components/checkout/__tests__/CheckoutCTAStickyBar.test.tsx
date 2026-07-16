import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { CheckoutCTAStickyBar } from '../CheckoutCTAStickyBar'

describe('CheckoutCTAStickyBar', () => {
  it('shows a spinner and the submitting label while submitting, and disables the button', () => {
    render(
      <CheckoutCTAStickyBar
        itemCount={3}
        totalLabel="$100"
        onSubmit={vi.fn()}
        disabled={false}
        submitting
        submitLabel="Confirm & place order"
        submittingLabel="Placing order…"
      />,
    )
    const btn = screen.getByRole('button', { name: /placing order/i })
    expect(btn).toBeDisabled()
    expect(btn.querySelector('svg')).toBeTruthy() // spinner present
  })

  it('shows only the submit label when idle', () => {
    render(
      <CheckoutCTAStickyBar
        itemCount={3}
        totalLabel="$100"
        onSubmit={vi.fn()}
        disabled={false}
        submitting={false}
        submitLabel="Confirm & place order"
      />,
    )
    const btn = screen.getByRole('button', { name: /confirm & place order/i })
    expect(btn.querySelector('svg')).toBeNull()
  })
})
