import { render, screen, fireEvent } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CartProvider } from '../CartProvider'
import { useCart } from '../useCart'

vi.mock('@/contexts/CompanyContext', () => ({
  useCompany: () => ({ access: { companyId: 'org-1', isPreview: false, role: 'org_admin' } }),
}))

function Probe() {
  const cart = useCart()
  const line = cart.lines[0]
  return (
    <div>
      <button
        onClick={() =>
          cart.addLine({
            productId: 'p1', productName: 'Tee', variantId: 'v1', variantLabel: 'Black / M',
            qty: 10, unitPrice: 10, imageUrl: null, decorations: [], fulfilmentType: 'made_to_order',
          })
        }
      >
        add
      </button>
      {line && (
        <>
          <span data-testid="mode">{line.fulfilmentType}</span>
          <span data-testid="qty">{line.qty}</span>
          <button onClick={() => cart.setFulfilmentType(line.lineId, 'stocked')}>flip</button>
        </>
      )}
    </div>
  )
}

beforeEach(() => {
  window.localStorage.clear()
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ imagesByLineId: {} }) })))
})

describe('CartProvider.setFulfilmentType', () => {
  it('flips a line between made_to_order and stocked without touching other fields', () => {
    render(
      <CartProvider>
        <Probe />
      </CartProvider>,
    )
    fireEvent.click(screen.getByText('add'))
    expect(screen.getByTestId('mode')).toHaveTextContent('made_to_order')
    expect(screen.getByTestId('qty')).toHaveTextContent('10')
    fireEvent.click(screen.getByText('flip'))
    expect(screen.getByTestId('mode')).toHaveTextContent('stocked')
    expect(screen.getByTestId('qty')).toHaveTextContent('10')
  })
})
