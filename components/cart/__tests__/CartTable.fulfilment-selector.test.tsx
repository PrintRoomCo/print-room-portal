import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CartTable } from '../CartTable'
import type { CartLine } from '@/lib/cart/types'

vi.mock('@/contexts/CurrencyContext', () => ({
  useCurrency: () => ({ format: (n: number) => `$${n.toFixed(2)}` }),
}))

function makeLine(overrides: Partial<CartLine> = {}): CartLine {
  return {
    lineId: 'line-1', productId: 'p1', productName: 'Tee', variantId: 'v1',
    variantLabel: 'Black / M', qty: 30, unitPrice: 10, imageUrl: null,
    decorations: [], ...overrides,
  }
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => ({ availability: {}, effectiveMoq: undefined }) })),
  )
})

describe('CartTable order-type selector', () => {
  it('shows the selector for a mixed-nature line when the viewer is an org admin', async () => {
    render(
      <CartTable
        lines={[makeLine({ nature: 'mixed', fulfilmentType: 'stocked' })]}
        onUpdateQty={() => {}} onRemove={() => {}} isOrgAdmin onFulfilmentChange={() => {}}
      />,
    )
    await waitFor(() => expect(fetch).toHaveBeenCalled())
    expect(screen.getByRole('group', { name: /order type/i })).toBeInTheDocument()
    expect(screen.getByText('Purchase order')).toBeInTheDocument()
    expect(screen.getByText('Stock on hand')).toBeInTheDocument()
  })

  it('hides the selector for a single-nature (made_to_order) line', async () => {
    render(
      <CartTable
        lines={[makeLine({ nature: 'made_to_order', fulfilmentType: 'made_to_order' })]}
        onUpdateQty={() => {}} onRemove={() => {}} isOrgAdmin onFulfilmentChange={() => {}}
      />,
    )
    await waitFor(() => expect(fetch).toHaveBeenCalled())
    expect(screen.queryByRole('group', { name: /order type/i })).not.toBeInTheDocument()
  })

  it('hides the selector for a mixed-nature line when the viewer is not an org admin', async () => {
    render(
      <CartTable
        lines={[makeLine({ nature: 'mixed', fulfilmentType: 'stocked' })]}
        onUpdateQty={() => {}} onRemove={() => {}} isOrgAdmin={false} onFulfilmentChange={() => {}}
      />,
    )
    await waitFor(() => expect(fetch).toHaveBeenCalled())
    expect(screen.queryByRole('group', { name: /order type/i })).not.toBeInTheDocument()
  })

  it('fires onFulfilmentChange with the chosen mode when a pill is clicked', async () => {
    const onFulfilmentChange = vi.fn()
    render(
      <CartTable
        lines={[makeLine({ nature: 'mixed', fulfilmentType: 'stocked' })]}
        onUpdateQty={() => {}} onRemove={() => {}} isOrgAdmin onFulfilmentChange={onFulfilmentChange}
      />,
    )
    await waitFor(() => expect(fetch).toHaveBeenCalled())
    screen.getByText('Purchase order').click()
    expect(onFulfilmentChange).toHaveBeenCalledWith('line-1', 'made_to_order')
  })
})
