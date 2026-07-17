import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { BilledOrderSummary } from './BilledOrderSummary'
import { billedOrderShape, type BilledLineInput } from '@/lib/pricing/order-billing-shape'

const format = (n: number) =>
  `$${n.toLocaleString('en-NZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

function line(over: Partial<BilledLineInput> = {}): BilledLineInput {
  return {
    lineId: 'tee',
    qty: 120,
    unitPrice: 12.21,
    decorationPerUnit: 0,
    fulfilmentType: 'stocked',
    billingMode: 'prepaid',
    ...over,
  }
}

const prepaidShape = () =>
  billedOrderShape({ lines: [line()], gstRate: 0.15, shipCountry: 'NZ' })

const mixedShape = () =>
  billedOrderShape({
    lines: [
      line(),
      line({
        lineId: 'hoodie',
        qty: 50,
        unitPrice: 40,
        fulfilmentType: 'made_to_order',
        billingMode: 'invoice_on_dispatch',
      }),
    ],
    gstRate: 0.15,
    shipCountry: 'NZ',
  })

const renderLine = (l: { lineId: string }) => <div data-testid={`row-${l.lineId}`}>{l.lineId}</div>

describe('BilledOrderSummary — single prepaid order', () => {
  it('shows the billed total, not the goods value', () => {
    render(
      <BilledOrderSummary shape={prepaidShape()} format={format} renderLine={renderLine} defaultBreakdownOpen />,
    )
    // Twice by design (headline Total + breakdown Total) — and they must agree.
    expect(screen.getAllByText('$17.25')).toHaveLength(2)
    // The number from Chris's screenshot must be gone entirely.
    expect(screen.queryByText('$1,684.98')).not.toBeInTheDocument()
  })

  it('surfaces the banding figure — without it the fee is underivable', () => {
    render(
      <BilledOrderSummary shape={prepaidShape()} format={format} renderLine={renderLine} defaultBreakdownOpen />,
    )
    expect(screen.getByText('Drawn from pre-paid stock')).toBeInTheDocument()
    expect(screen.getByText('$1,465.20')).toBeInTheDocument()
  })

  it('labels prepaid goods and shows the picking fee and GST', () => {
    render(
      <BilledOrderSummary shape={prepaidShape()} format={format} renderLine={renderLine} defaultBreakdownOpen />,
    )
    expect(screen.getByText('Goods (pre-paid)')).toBeInTheDocument()
    expect(screen.getByText('Picking fee')).toBeInTheDocument()
    expect(screen.getByText('$15.00')).toBeInTheDocument()
    expect(screen.getByText('GST (15%)')).toBeInTheDocument()
    expect(screen.getByText('$2.25')).toBeInTheDocument()
  })

  it('renders the line row via renderLine', () => {
    render(<BilledOrderSummary shape={prepaidShape()} format={format} renderLine={renderLine} />)
    expect(screen.getByTestId('row-tee')).toBeInTheDocument()
  })

  it('shows no order-group headers for a single order', () => {
    render(<BilledOrderSummary shape={prepaidShape()} format={format} renderLine={renderLine} />)
    expect(screen.queryByText('Stock-on-hand order')).not.toBeInTheDocument()
    expect(screen.queryByText(/You'll receive/)).not.toBeInTheDocument()
  })

  it('renders afterLines between the last line and the grand total', () => {
    const { container } = render(
      <BilledOrderSummary
        shape={prepaidShape()}
        format={format}
        renderLine={renderLine}
        afterLines={<div data-testid="inventory-toggle">toggle</div>}
      />,
    )
    const toggle = screen.getByTestId('inventory-toggle')
    const row = screen.getByTestId('row-tee')
    // [0] is the headline Total; the closed <details> breakdown holds a second.
    const headlineTotal = screen.getAllByText('Total')[0]
    // An order-level control must read as applying to the items, not the money.
    expect(row.compareDocumentPosition(toggle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(
      toggle.compareDocumentPosition(headlineTotal) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    expect(container).toBeTruthy()
  })
})

describe('BilledOrderSummary — mixed cart', () => {
  it('groups the lines under their order headings', () => {
    render(<BilledOrderSummary shape={mixedShape()} format={format} renderLine={renderLine} />)
    expect(screen.getByText('Purchase order')).toBeInTheDocument()
    expect(screen.getByText('Stock-on-hand order')).toBeInTheDocument()
    expect(screen.getByTestId('row-tee')).toBeInTheDocument()
    expect(screen.getByTestId('row-hoodie')).toBeInTheDocument()
  })

  it('shows a per-order total for each group', () => {
    render(<BilledOrderSummary shape={mixedShape()} format={format} renderLine={renderLine} />)
    expect(screen.getAllByText('Order total')).toHaveLength(2)
    expect(screen.getByText('$2,300.00')).toBeInTheDocument()
    expect(screen.getByText('$17.25')).toBeInTheDocument()
  })

  it('states the grand total and the invoice count', () => {
    render(<BilledOrderSummary shape={mixedShape()} format={format} renderLine={renderLine} />)
    expect(screen.getByText('Total across 2 orders')).toBeInTheDocument()
    expect(screen.getByText('$2,317.25')).toBeInTheDocument()
    expect(screen.getByText("You'll receive 2 invoices.")).toBeInTheDocument()
  })

  it('shows no picking fee on the purchase-order group', () => {
    render(<BilledOrderSummary shape={mixedShape()} format={format} renderLine={renderLine} />)
    // One fee row only — the stock order's.
    expect(screen.getAllByText('Picking fee')).toHaveLength(1)
  })
})

describe('BilledOrderSummary — non-prepaid order', () => {
  it('labels goods "Subtotal" and omits the prepaid row', () => {
    const shape = billedOrderShape({
      lines: [line({ billingMode: 'invoice_on_dispatch', qty: 10, unitPrice: 50 })],
      gstRate: 0.15,
      shipCountry: 'NZ',
    })
    render(<BilledOrderSummary shape={shape} format={format} renderLine={renderLine} defaultBreakdownOpen />)
    expect(screen.getByText('Subtotal')).toBeInTheDocument()
    expect(screen.queryByText('Drawn from pre-paid stock')).not.toBeInTheDocument()
  })
})
