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
    productName: 'Test tee',
    variantId: 'variant-1',
    variantLabel: 'Black / M',
    sizeId: 55910,
    sizeLabel: 'M',
    qty: 30,
    unitPrice: 10,
    imageUrl: null,
    decorations: [],
    ...overrides,
  }
}

beforeEach(() => {
  // Availability endpoint — return nothing so the oversell guard stays quiet and
  // the only status line under test is the fulfilment copy.
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      json: async () => ({ availability: {}, effectiveMoq: undefined }),
    })),
  )
})

describe('CartTable fulfilment copy', () => {
  it('describes a made_to_order line as produced before dispatch, not an inventory shelf', async () => {
    render(
      <CartTable
        lines={[makeLine({ fulfilmentType: 'made_to_order' })]}
        onUpdateQty={() => {}}
        onRemove={() => {}}
      />,
    )

    await waitFor(() => expect(fetch).toHaveBeenCalled())

    expect(screen.getByText(/produced before dispatch/i)).toBeInTheDocument()
    // Regression: the old copy wrongly told customers their order goes to the
    // inventory shelf — that only happens on an explicit inventory checkout.
    expect(screen.queryByText(/inventory shelf/i)).not.toBeInTheDocument()
  })

  it('shows no fulfilment note for a plain stocked line', async () => {
    render(
      <CartTable
        lines={[makeLine({ fulfilmentType: 'stocked' })]}
        onUpdateQty={() => {}}
        onRemove={() => {}}
      />,
    )

    await waitFor(() => expect(fetch).toHaveBeenCalled())

    expect(screen.queryByText(/produced before dispatch/i)).not.toBeInTheDocument()
  })
})
