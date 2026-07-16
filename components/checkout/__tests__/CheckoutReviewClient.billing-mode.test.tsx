import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CheckoutReviewClient } from '../CheckoutReviewClient'
import { CHECKOUT_REVIEW_STORAGE_KEY } from '../checkoutReviewState'

const mocks = vi.hoisted(() => ({
  lines: [] as Array<Record<string, unknown>>,
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}))

vi.mock('@/components/cart/useCart', () => ({
  useCart: () => ({
    lines: mocks.lines,
    clear: vi.fn(),
  }),
}))

vi.mock('@/lib/pricing/usePricingContext', () => ({
  usePricingContext: () => ({
    pricingMode: 'catalogue',
    tierLabel: 'Catalogue',
    tierDiscount: 0,
  }),
}))

vi.mock('@/contexts/CurrencyContext', () => ({
  useCurrency: () => ({
    format: (n: number) => `$${n.toFixed(2)}`,
  }),
}))

vi.mock('@/contexts/CompanyContext', () => ({
  useCompany: () => ({ access: null, loading: false }),
}))

function line(over: Record<string, unknown> = {}) {
  return {
    lineId: 'line-1',
    productId: 'product-1',
    productName: 'Test tee',
    variantId: 'variant-1',
    variantLabel: 'Black / M',
    qty: 12,
    unitPrice: 10,
    imageUrl: null,
    decorations: [],
    fulfilmentType: 'stocked',
    catalogueItemId: 'catalogue-item-1',
    ...over,
  }
}

function renderReview(billingModeByItemId: Record<string, 'invoice_on_dispatch' | 'prepaid'>) {
  return render(
    <CheckoutReviewClient
      stores={[{ id: 'store-1', name: 'Main store', city: 'Auckland' }]}
      customerCode="CUST-1"
      paymentTerms="net20"
      defaultDepositPercent={null}
      isTest={false}
      billingModeByItemId={billingModeByItemId}
    />,
  )
}

beforeEach(() => {
  sessionStorage.clear()
  sessionStorage.setItem(
    CHECKOUT_REVIEW_STORAGE_KEY,
    JSON.stringify({
      idempotencyKey: 'idem-1',
      requiredBy: '',
      notes: '',
      intent: 'customer',
      perLineShipTo: { 'line-1': 'store-1' },
      customAddress: { name: '', address: '', city: '', postal_code: '', country: 'NZ' },
      createdAt: '2026-06-05T00:00:00.000Z',
    }),
  )
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      json: vi.fn().mockResolvedValue({ imagesByLineId: {} }),
    }),
  )
})

describe('CheckoutReviewClient — Pre-paid badge uses fresh billing_mode over the cart snapshot', () => {
  it('hides the badge when the item was flipped to invoice_on_dispatch after add-to-cart', async () => {
    mocks.lines = [line({ billingMode: 'prepaid' })] // stale snapshot
    renderReview({ 'catalogue-item-1': 'invoice_on_dispatch' }) // fresh truth
    expect((await screen.findAllByText('Test tee')).length).toBeGreaterThan(0)
    expect(screen.queryByText(/pre-paid/i)).toBeNull()
  })

  it('shows the badge when the item was flipped to prepaid after add-to-cart', async () => {
    mocks.lines = [line({ billingMode: 'invoice_on_dispatch' })] // stale snapshot
    renderReview({ 'catalogue-item-1': 'prepaid' }) // fresh truth
    expect(await screen.findByText(/pre-paid/i)).toBeTruthy()
  })

  it('falls back to the cart snapshot when the fresh map has no entry (legacy line)', async () => {
    mocks.lines = [line({ billingMode: 'prepaid', catalogueItemId: null })]
    renderReview({})
    expect(await screen.findByText(/pre-paid/i)).toBeTruthy()
  })
})
