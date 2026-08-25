import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { act } from 'react'
import { renderToString } from 'react-dom/server'
import { hydrateRoot } from 'react-dom/client'
import { CheckoutCTAStickyBar } from '../CheckoutCTAStickyBar'

describe('CheckoutCTAStickyBar', () => {
  it('shows a spinner and the submitting label while submitting, and disables the button', () => {
    render(
      <CheckoutCTAStickyBar
        itemCount={3}
        orderCount={2}
        totalsByCurrency={[
          { currency: 'AUD', total: 90 },
          { currency: 'NZD', total: 100 },
        ]}
        onSubmit={vi.fn()}
        disabled={false}
        submitting
        action="place"
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
        orderCount={2}
        totalsByCurrency={[
          { currency: 'AUD', total: 90 },
          { currency: 'NZD', total: 100 },
        ]}
        onSubmit={vi.fn()}
        disabled={false}
        submitting={false}
        action="place"
      />,
    )
    const btn = screen.getByRole('button', { name: 'Place 2 orders' })
    expect(btn.querySelector('svg')).toBeNull()
    expect(screen.getByText('$90.00 AUD')).toBeInTheDocument()
    expect(screen.getByText('$100.00 NZD')).toBeInTheDocument()
  })

  it('uses singular order grammar and a retry action for failed groups', () => {
    render(
      <CheckoutCTAStickyBar
        itemCount={1}
        orderCount={1}
        totalsByCurrency={[{ currency: 'NZD', total: 115 }]}
        onSubmit={vi.fn()}
        disabled={false}
        submitting={false}
        action="retry"
      />,
    )

    expect(screen.getByRole('button', { name: 'Retry 1 order' })).toBeInTheDocument()
  })

  it('hydrates direct AUD and NZD formatting without changing server markup', async () => {
    const props = {
      itemCount: 2,
      orderCount: 2,
      totalsByCurrency: [
        { currency: 'AUD', total: 132 },
        { currency: 'NZD', total: 138 },
      ],
      onSubmit: vi.fn(),
      disabled: false,
      submitting: false,
      action: 'place' as const,
    }
    const container = document.createElement('div')
    container.innerHTML = renderToString(<CheckoutCTAStickyBar {...props} />)
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const root = hydrateRoot(container, <CheckoutCTAStickyBar {...props} />)

    await act(async () => {})

    expect(container).toHaveTextContent('$132.00 AUD')
    expect(container).toHaveTextContent('$138.00 NZD')
    expect(
      consoleError.mock.calls.some((call) => String(call[0]).includes('hydration')),
    ).toBe(false)
    await act(async () => root.unmount())
    consoleError.mockRestore()
  })
})
