import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { CurrencyProvider } from '@/contexts/CurrencyContext'
import { ConfirmationView } from './ConfirmationView'

function renderView(props: React.ComponentProps<typeof ConfirmationView>) {
  return render(
    <CurrencyProvider initialCurrency="NZD">
      <ConfirmationView {...props} />
    </CurrencyProvider>,
  )
}

const base: React.ComponentProps<typeof ConfirmationView> = {
  orderId: 'o1',
  orderRef: 'R1',
  status: 'in-production',
  awaitingApproval: false,
  mondaySynced: true,
  isInventoryOrder: false,
  customerEmail: 'jamie@theprint-room.co.nz',
  shippingAddress: null,
  fulfilmentLabel: 'Ship to store',
  requiredBy: null,
  lines: [],
  subtotalExGst: 10,
  decorationCost: 0,
  pickingFee: 0,
  prepaidGoodsValue: 0,
  gst: 1.5,
  totalIncGst: 11.5,
  gstRate: 0.15,
}

describe('ConfirmationView track CTA', () => {
  it('shows "Track this order" for a normal order', () => {
    renderView({ ...base })
    expect(screen.getByText('Track this order')).toBeTruthy()
  })

  it('hides "Track this order" for a stock-on-hand order, keeps Continue shopping', () => {
    renderView({ ...base, isStockOnHandOrder: true })
    expect(screen.queryByText('Track this order')).toBeNull()
    expect(screen.getByText('Continue shopping')).toBeTruthy()
  })

  it('renders stamped order money and tax label independently of visitor FX', () => {
    render(
      <CurrencyProvider
        initialCurrency="AUD"
        initialRates={{ NZD: 1, AUD: 2, USD: 1, GBP: 1, EUR: 1 }}
      >
        <ConfirmationView
          {...({
            ...base,
            currency: 'NZD',
            taxLabel: 'GST 15%',
          } as React.ComponentProps<typeof ConfirmationView> & {
            currency: string
            taxLabel: string
          })}
        />
      </CurrencyProvider>,
    )

    expect(screen.getAllByText('$10.00').length).toBeGreaterThan(0)
    expect(screen.queryByText('A$20.00')).toBeNull()
    expect(screen.getByText('GST 15%')).toBeTruthy()
  })
})
