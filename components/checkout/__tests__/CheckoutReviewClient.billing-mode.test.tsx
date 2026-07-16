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
    nature: 'stocked',
    catalogueItemId: 'catalogue-item-1',
    ...over,
  }
}

function renderReview(
  stores = [{ id: 'store-1', name: 'Main store', city: 'Auckland', country: 'NZ' }],
) {
  return render(
    <CheckoutReviewClient
      stores={stores}
      customerCode="CUST-1"
      paymentTerms="net20"
      defaultDepositPercent={null}
      isTest={false}
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

// Spec 3a: billing is per VARIANT. The cart line's own billingMode snapshot
// (set from variant_inventory.billing_mode on the PDP) drives the badge — the
// item-level SSR billing fetch is gone.
describe('CheckoutReviewClient — Pre-paid badge reads the cart line per-variant snapshot', () => {
  it('shows the badge for a prepaid stock-drawing line', async () => {
    mocks.lines = [line({ billingMode: 'prepaid', nature: 'stocked' })]
    renderReview()
    expect(await screen.findByText(/pre-paid/i)).toBeTruthy()
  })

  it('hides the badge for a pay-at-checkout line', async () => {
    mocks.lines = [line({ billingMode: 'invoice_on_dispatch', nature: 'stocked' })]
    renderReview()
    expect((await screen.findAllByText('Test tee')).length).toBeGreaterThan(0)
    expect(screen.queryByText(/pre-paid/i)).toBeNull()
  })

  it('hides the badge on a made_to_order nature even if the variant is prepaid', async () => {
    // showsPrepaidTag gates on a stock-drawing nature (stocked/mixed) — a
    // prepaid variant's production-run line is charged, so no badge.
    mocks.lines = [line({ billingMode: 'prepaid', nature: 'made_to_order' })]
    renderReview()
    expect((await screen.findAllByText('Test tee')).length).toBeGreaterThan(0)
    expect(screen.queryByText(/pre-paid/i)).toBeNull()
  })

  it('hides the badge for a legacy line with no snapshot', async () => {
    mocks.lines = [line({ billingMode: undefined, catalogueItemId: null })]
    renderReview()
    expect((await screen.findAllByText('Test tee')).length).toBeGreaterThan(0)
    expect(screen.queryByText(/pre-paid/i)).toBeNull()
  })

  it('shows the stock-partition picking fee for a mixed cart', async () => {
    sessionStorage.setItem(
      CHECKOUT_REVIEW_STORAGE_KEY,
      JSON.stringify({
        idempotencyKey: 'idem-1',
        requiredBy: '',
        notes: '',
        intent: 'customer',
        perLineShipTo: { 'line-1': 'store-au', 'line-2': 'store-nz' },
        customAddress: { name: '', address: '', city: '', postal_code: '', country: '' },
        createdAt: '2026-06-05T00:00:00.000Z',
      }),
    )
    mocks.lines = [
      line({
        productName: 'Made-to-order tee',
        qty: 10,
        unitPrice: 10,
        fulfilmentType: 'made_to_order',
        nature: 'made_to_order',
      }),
      line({
        lineId: 'line-2',
        productId: 'product-2',
        productName: 'Stock tee',
        catalogueItemId: 'catalogue-item-2',
        qty: 10,
        unitPrice: 10,
        fulfilmentType: 'stocked',
        nature: 'stocked',
      }),
    ]

    renderReview([
      { id: 'store-au', name: 'Sydney', city: 'Sydney', country: 'Australia' },
      { id: 'store-nz', name: 'Auckland', city: 'Auckland', country: 'NZ' },
    ])

    expect(await screen.findByText('Picking fee')).toBeTruthy()
    expect(screen.getByText('$30.00')).toBeTruthy()
  })
})
