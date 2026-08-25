import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ShipToRow } from './ShipToRow'

const line = {
  lineId: 'line-1',
  productId: 'product-1',
  productName: 'Test tee',
  variantId: 'variant-1',
  variantLabel: 'Black / M',
  qty: 2,
  unitPrice: 10,
  priceCurrency: 'NZD',
  imageUrl: null,
  decorations: [],
}

describe('ShipToRow reviewed country price', () => {
  it('shows the prepared unit price instead of relabelling the drawer price', () => {
    render(
      <ShipToRow
        line={line}
        stores={[{ id: 'store-au', name: 'Melbourne', city: 'Melbourne', country: 'AU' }]}
        value="store-au"
        onChange={vi.fn()}
        format={(amount) => `$${amount.toFixed(2)} AUD`}
        billedUnitPrice={11}
        billedGoodsValue={22}
      />,
    )

    expect(screen.getByText('$11.00 AUD')).toBeInTheDocument()
    expect(screen.queryByText('$10.00 AUD')).not.toBeInTheDocument()
    expect(screen.getByText('$22.00 AUD')).toBeInTheDocument()
  })
})
