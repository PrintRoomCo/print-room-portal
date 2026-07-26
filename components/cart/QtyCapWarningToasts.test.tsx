import { describe, expect, it } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QTY_CAP_WARNING_EVENT, type QtyCapWarningDetail } from '@/lib/shop/qty-cap'
import { QtyCapWarningToasts } from './QtyCapWarningToasts'

function fire(detail: QtyCapWarningDetail) {
  act(() => {
    window.dispatchEvent(new CustomEvent(QTY_CAP_WARNING_EVENT, { detail }))
  })
}

describe('QtyCapWarningToasts', () => {
  it('renders a dismissible warning card on the event', async () => {
    render(<QtyCapWarningToasts />)
    fire({ productName: 'Canvas Tote', total: 25, max: 20 })
    expect(screen.getByText('Over per-order limit')).toBeInTheDocument()
    expect(
      screen.getByText('Canvas Tote: cart now has 25 of a suggested 20.'),
    ).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByText('Over per-order limit')).toBeNull()
  })
})
