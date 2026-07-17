import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { OrdersTable } from '../OrdersTable'
import type { PortalPastOrder } from '@/lib/portal-data'

function order(overrides: Partial<PortalPastOrder>): PortalPastOrder {
  return {
    orderId: 'o1',
    quoteId: 'q1',
    orderRef: 'REF-1',
    quoteNumber: null,
    reference: null,
    status: 'shipped',
    orderType: 'purchase_order',
    customerName: null,
    customerEmail: 'a@x.co',
    customerCompany: null,
    subtotal: 100,
    totalAmount: 115,
    currency: 'NZD',
    pickingFee: 0,
    billed: 100,
    createdAt: '2026-07-01T00:00:00.000Z',
    tracking: null,
    ...overrides,
  }
}

const cheap = order({ orderId: 'o1', quoteId: 'q1', orderRef: 'REF-1', billed: 50, createdAt: '2026-07-02T00:00:00.000Z' })
const dear = order({ orderId: 'o2', quoteId: 'q2', orderRef: 'REF-2', billed: 500, orderType: 'stock_on_hand', createdAt: '2026-07-01T00:00:00.000Z' })

function bodyRefs(): string[] {
  const rows = within(screen.getAllByRole('rowgroup')[1]).getAllByRole('row')
  return rows.map((r) => within(r).getAllByRole('cell')[1].textContent ?? '')
}

describe('OrdersTable', () => {
  it('renders newest-first by default with type labels and both money columns', () => {
    render(<OrdersTable orders={[dear, cheap]} />)
    expect(bodyRefs()).toEqual(['REF-1', 'REF-2'])
    expect(screen.getByText('Stock')).toBeDefined()
    expect(screen.getAllByText('$100.00').length).toBeGreaterThan(0)
    expect(screen.getByText('$500.00')).toBeDefined()
  })

  it('clicking the Billed header sorts ascending, clicking again flips to descending', () => {
    render(<OrdersTable orders={[dear, cheap]} />)
    const billedHeader = screen.getByRole('button', { name: /billed/i })
    fireEvent.click(billedHeader)
    expect(bodyRefs()).toEqual(['REF-1', 'REF-2'])
    fireEvent.click(billedHeader)
    expect(bodyRefs()).toEqual(['REF-2', 'REF-1'])
  })

  it('rows link to the my-collections detail page keyed on quoteId', () => {
    render(<OrdersTable orders={[cheap]} />)
    expect(screen.getByRole('link', { name: 'REF-1' }).getAttribute('href')).toBe('/my-collections/q1')
  })
})
