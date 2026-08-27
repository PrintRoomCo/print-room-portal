import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { InvoiceCurrencyInfo } from './InvoiceCurrencyInfo'

function openTooltip() {
  fireEvent.focus(screen.getByRole('button', { name: 'Invoicing currency' }))
}

describe('InvoiceCurrencyInfo', () => {
  it('names the single invoicing currency and flags converted totals as estimates', () => {
    render(<InvoiceCurrencyInfo billingCurrencies={['NZD']} displayCurrency="USD" />)
    openTooltip()
    expect(
      screen.getByText(
        "You will be invoiced in NZD. Converted totals are an estimate at today's rate.",
      ),
    ).toBeInTheDocument()
  })

  it('lists every destination currency for a multi-country order', () => {
    render(<InvoiceCurrencyInfo billingCurrencies={['NZD', 'AUD']} displayCurrency="USD" />)
    openTooltip()
    expect(
      screen.getByText(
        "This order is invoiced per destination country: NZD and AUD. Converted totals are an estimate at today's rate.",
      ),
    ).toBeInTheDocument()
  })

  it('renders nothing when the billing set is exactly the display currency', () => {
    const { container } = render(
      <InvoiceCurrencyInfo billingCurrencies={['NZD', 'NZD']} displayCurrency="NZD" />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('still renders for a multi-currency set that includes the display currency', () => {
    render(<InvoiceCurrencyInfo billingCurrencies={['NZD', 'AUD']} displayCurrency="NZD" />)
    expect(screen.getByRole('button', { name: 'Invoicing currency' })).toBeInTheDocument()
  })

  it('closes on Escape', () => {
    render(<InvoiceCurrencyInfo billingCurrencies={['NZD']} displayCurrency="USD" />)
    openTooltip()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
