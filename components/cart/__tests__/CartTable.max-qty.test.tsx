import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CartTable } from '../CartTable'
import type { CartLine } from '@/lib/cart/types'

vi.mock('@/contexts/CurrencyContext', () => ({
  useCurrency: () => ({ format: (n: number) => `$${n.toFixed(2)}` }),
}))

function makeLine(overrides: Partial<CartLine> = {}): CartLine {
  return {
    lineId: 'line-1',
    productId: 'product-1',
    productName: 'Canvas Tote',
    variantId: 'variant-1',
    variantLabel: 'Natural',
    sizeId: 55910,
    sizeLabel: 'One size',
    qty: 26,
    unitPrice: 10,
    imageUrl: null,
    decorations: [],
    fulfilmentType: 'made_to_order',
    ...overrides,
  }
}

function stubAvailability(effectiveMaxQty: number | null) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      json: async () => ({ availability: {}, effectiveMoq: undefined, effectiveMaxQty }),
    })),
  )
}

describe('CartTable max-order-qty soft warning', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
  })

  it('shows the amber over-limit note when the product total exceeds the cap', async () => {
    stubAvailability(20)
    render(
      <CartTable lines={[makeLine({ qty: 26 })]} onUpdateQty={() => {}} onRemove={() => {}} />,
    )
    expect(
      await screen.findByText(
        'Over the per-order limit (20 units) — currently 26 across this product. You can still check out.',
      ),
    ).toBeInTheDocument()
  })

  it('shows nothing when there is no cap', async () => {
    stubAvailability(null)
    render(
      <CartTable lines={[makeLine({ qty: 500 })]} onUpdateQty={() => {}} onRemove={() => {}} />,
    )
    await waitFor(() => expect(fetch).toHaveBeenCalled())
    expect(screen.queryByText(/per-order limit/i)).not.toBeInTheDocument()
  })

  it('never reports the over-cap state as an MOQ violation (checkout stays enabled)', async () => {
    stubAvailability(20)
    const onMoqViolationChange = vi.fn()
    render(
      <CartTable
        lines={[makeLine({ qty: 26 })]}
        onUpdateQty={() => {}}
        onRemove={() => {}}
        onMoqViolationChange={onMoqViolationChange}
      />,
    )
    await screen.findByText(/per-order limit/i)
    expect(onMoqViolationChange).not.toHaveBeenCalledWith(true)
  })
})
