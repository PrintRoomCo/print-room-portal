import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CheckoutReviewClient } from '../CheckoutReviewClient'
import { CHECKOUT_REVIEW_STORAGE_KEY } from '../checkoutReviewState'

const mocks = vi.hoisted(() => ({ lines: [] as Array<Record<string, unknown>> }))

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('@/components/cart/useCart', () => ({
  useCart: () => ({ lines: mocks.lines, clear: vi.fn() }),
}))
vi.mock('@/lib/pricing/usePricingContext', () => ({
  usePricingContext: () => ({ pricingMode: 'catalogue', tierLabel: 'Catalogue', tierDiscount: 0 }),
}))
vi.mock('@/contexts/CurrencyContext', () => ({
  useCurrency: () => ({ format: (n: number) => `$${n.toFixed(2)}` }),
}))
vi.mock('@/contexts/CompanyContext', () => ({
  useCompany: () => ({ access: null, loading: false, defaultBillingCountry: { code: 'NZ', name: 'New Zealand', currency: 'NZD', taxRate: 0.15, taxLabel: 'GST 15%', isDefault: true } }),
}))

function line(over: Record<string, unknown> = {}) {
  return {
    lineId: 'line-1', productId: 'product-1', productName: 'Test tee', variantId: 'variant-1',
    variantLabel: 'Black / M', qty: 12, unitPrice: 10, imageUrl: null, decorations: [],
    fulfilmentType: 'stocked', nature: 'stocked', catalogueItemId: 'catalogue-item-1', ...over,
  }
}

const STORES = [{ id: 'store-1', name: 'Avalon', city: 'Lower Hutt', country: 'NZ' }]

function renderReview() {
  return render(
    <CheckoutReviewClient
      stores={STORES}
      customerCode="CUST-1"
      paymentTerms="net20"
      defaultDepositPercent={null}
      isTest={false}
      role="org_admin"
      branchStoreIds={[]}
      defaultStoreId="store-1"
    />,
  )
}

// Records only the order-placing POST so tests can assert whether it fired.
let checkoutPosts: Array<{ url: string; body: Record<string, unknown> }> = []

beforeEach(() => {
  checkoutPosts = []
  mocks.lines = [line()]
  sessionStorage.clear()
  sessionStorage.setItem(
    CHECKOUT_REVIEW_STORAGE_KEY,
    JSON.stringify({
      idempotencyKey: 'idem-1', requiredBy: '', notes: '', intent: 'customer',
      perLineShipTo: { 'line-1': 'store-1' },
      customAddress: { name: '', address: '', city: '', postal_code: '', country: 'NZ' },
      createdAt: '2026-06-05T00:00:00.000Z',
    }),
  )
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).startsWith('/api/checkout/billing-modes')) {
        return { status: 200, ok: true, json: async () => ({ modeByVariantId: {} }) }
      }
      if (String(url) === '/api/checkout') {
        checkoutPosts.push({ url: String(url), body: JSON.parse(String(init?.body ?? '{}')) })
        return { status: 200, ok: true, json: async () => ({ order_id: 'o-1', order_ref: 'O-1' }) }
      }
      return { status: 200, ok: true, json: async () => ({ imagesByLineId: {} }) }
    }),
  )
})

const clickPlaceOrder = () =>
  fireEvent.click(
    screen.getByRole('button', { name: /confirm & place order/i }),
  )

describe('CheckoutReviewClient: Terms & Conditions', () => {
  it('shows an error banner and does NOT POST when the box is unticked', async () => {
    renderReview()
    await screen.findAllByText('Test tee')
    clickPlaceOrder()
    expect(await screen.findByText(/read and agree to the terms/i)).toBeTruthy()
    expect(checkoutPosts).toHaveLength(0)
  })

  it('POSTs with terms_accepted + terms_version once the box is ticked', async () => {
    renderReview()
    await screen.findAllByText('Test tee')
    fireEvent.click(screen.getByLabelText(/i have read and agree/i))
    clickPlaceOrder()
    await waitFor(() => expect(checkoutPosts).toHaveLength(1))
    expect(checkoutPosts[0].body.terms_accepted).toBe(true)
    expect(checkoutPosts[0].body.terms_version).toBe('v1-2026-08-11')
  })

  it('opens the terms modal from the inline link without ticking the box', async () => {
    renderReview()
    await screen.findAllByText('Test tee')
    const checkbox = screen.getByLabelText(/i have read and agree/i) as HTMLInputElement
    fireEvent.click(screen.getByRole('button', { name: /terms & conditions/i }))
    expect(await screen.findByRole('dialog')).toBeTruthy()
    expect(checkbox.checked).toBe(false)
  })

  it('aborts silently (no banner, no POST) when the honeypot is filled', async () => {
    const { container } = renderReview()
    await screen.findAllByText('Test tee')
    const honeypot = container.querySelector('input[name="company_url"]') as HTMLInputElement
    expect(honeypot).toBeTruthy()
    fireEvent.change(honeypot, { target: { value: 'bot-filled' } })
    fireEvent.click(screen.getByLabelText(/i have read and agree/i))
    clickPlaceOrder()
    await Promise.resolve()
    expect(checkoutPosts).toHaveLength(0)
    expect(screen.queryByText(/read and agree to the terms/i)).toBeNull()
  })
})
