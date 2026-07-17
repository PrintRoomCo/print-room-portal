import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CheckoutReviewClient } from '../CheckoutReviewClient'
import { CHECKOUT_REVIEW_STORAGE_KEY } from '../checkoutReviewState'

const mocks = vi.hoisted(() => ({
  lines: [] as Array<Record<string, unknown>>,
  /** What GET /api/checkout/billing-modes returns — the FRESH read. */
  billingModes: {} as Record<string, string>,
  /** Set to make the fresh read fail, exercising the fail-closed path. */
  billingModesFail: false,
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
  mocks.billingModes = {}
  mocks.billingModesFail = false
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
  // URL-aware: the page calls two endpoints, and billing-modes decides the
  // money. A catch-all stub would hand image data to the billing read, which
  // then fails closed and silently masks whatever the test meant to assert.
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (String(url).startsWith('/api/checkout/billing-modes')) {
        if (mocks.billingModesFail) return { status: 500, ok: false }
        return {
          status: 200,
          ok: true,
          json: async () => ({ modeByVariantId: mocks.billingModes }),
        }
      }
      return { status: 200, ok: true, json: async () => ({ imagesByLineId: {} }) }
    }),
  )
})

// Spec 2026-07-17 D4: billing is per VARIANT and read FRESH at checkout. The
// cart's own billingMode is a PDP snapshot that can be days stale, and since the
// badge now shares its predicate with the price, a stale snapshot would mean
// showing $0 on goods we would invoice in full.
describe('CheckoutReviewClient — Pre-paid badge reads the FRESH per-variant billing mode', () => {
  it('shows the badge for a prepaid stock-drawing line', async () => {
    mocks.lines = [line({ fulfilmentType: 'stocked' })]
    mocks.billingModes = { 'variant-1': 'prepaid' }
    renderReview()
    expect(await screen.findByText('Pre-paid')).toBeTruthy()
  })

  it('hides the badge for a pay-at-checkout line', async () => {
    mocks.lines = [line({ fulfilmentType: 'stocked' })]
    mocks.billingModes = { 'variant-1': 'invoice_on_dispatch' }
    renderReview()
    expect((await screen.findAllByText('Test tee')).length).toBeGreaterThan(0)
    expect(screen.queryByText('Pre-paid')).toBeNull()
  })

  // The reason the fresh read exists. If the snapshot won here, we would badge
  // the line "Pre-paid", price it at $0, and then invoice it in full.
  it('the FRESH read wins over a stale prepaid cart snapshot', async () => {
    mocks.lines = [line({ billingMode: 'prepaid', fulfilmentType: 'stocked' })]
    mocks.billingModes = { 'variant-1': 'invoice_on_dispatch' }
    renderReview()
    expect((await screen.findAllByText('Test tee')).length).toBeGreaterThan(0)
    expect(screen.queryByText('Pre-paid')).toBeNull()
  })

  it('fails CLOSED when the fresh read errors — no badge, full price', async () => {
    mocks.lines = [line({ billingMode: 'prepaid', fulfilmentType: 'stocked' })]
    mocks.billingModesFail = true
    renderReview()
    expect((await screen.findAllByText('Test tee')).length).toBeGreaterThan(0)
    expect(screen.queryByText('Pre-paid')).toBeNull()
  })

  it('hides the badge on a made_to_order line even if the variant is prepaid', async () => {
    // isPrepaidDrawn gates on the CHOSEN fulfilment, not the product's nature:
    // a prepaid variant's production-run line draws no stock (qty_from_stock 0)
    // and is charged, so it must not be badged.
    mocks.lines = [line({ fulfilmentType: 'made_to_order', nature: 'made_to_order' })]
    mocks.billingModes = { 'variant-1': 'prepaid' }
    renderReview()
    expect((await screen.findAllByText('Test tee')).length).toBeGreaterThan(0)
    expect(screen.queryByText('Pre-paid')).toBeNull()
  })

  it('hides the badge for a variant the fresh read does not know', async () => {
    mocks.lines = [line({ billingMode: undefined, catalogueItemId: null })]
    mocks.billingModes = {}
    renderReview()
    expect((await screen.findAllByText('Test tee')).length).toBeGreaterThan(0)
    expect(screen.queryByText('Pre-paid')).toBeNull()
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
        variantId: 'variant-2',
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

    // Bands on the stocked partition only: 10 x $10 = $100 → the $100-199 band.
    expect(await screen.findByText('Picking fee')).toBeTruthy()
    expect(screen.getByText('$30.00')).toBeTruthy()
  })
})
