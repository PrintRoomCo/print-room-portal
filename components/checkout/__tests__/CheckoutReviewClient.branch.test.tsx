import { render, screen, fireEvent } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CheckoutReviewClient } from '../CheckoutReviewClient'
import { CHECKOUT_REVIEW_STORAGE_KEY, readCheckoutReviewState } from '../checkoutReviewState'

const mocks = vi.hoisted(() => ({
  lines: [] as Array<Record<string, unknown>>,
}))

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
  useCompany: () => ({ access: null, loading: false }),
}))

function line(over: Record<string, unknown> = {}) {
  return {
    lineId: 'line-1', productId: 'product-1', productName: 'Test tee', variantId: 'variant-1',
    variantLabel: 'Black / M', qty: 12, unitPrice: 10, imageUrl: null, decorations: [],
    fulfilmentType: 'stocked', nature: 'stocked', catalogueItemId: 'catalogue-item-1', ...over,
  }
}

const STORES = [
  { id: 'store-1', name: 'Avalon', city: 'Lower Hutt', country: 'NZ' },
  { id: 'store-2', name: 'CBD', city: 'Wellington', country: 'NZ' },
]

function renderReview(
  props: {
    role: 'org_admin' | 'staff'
    branchStoreIds: string[]
    defaultStoreId: string | null
    countryPartitionEnabled?: boolean
  },
) {
  return render(
    <CheckoutReviewClient
      stores={STORES}
      customerCode="CUST-1"
      paymentTerms="net20"
      defaultDepositPercent={null}
      isTest={false}
      role={props.role}
      branchStoreIds={props.branchStoreIds}
      defaultStoreId={props.defaultStoreId}
      countryPartitionEnabled={props.countryPartitionEnabled}
    />,
  )
}

beforeEach(() => {
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
    vi.fn(async (url: string) => {
      if (String(url).startsWith('/api/checkout/billing-modes')) {
        return { status: 200, ok: true, json: async () => ({ modeByVariantId: {} }) }
      }
      return { status: 200, ok: true, json: async () => ({ imagesByLineId: {} }) }
    }),
  )
})

describe('CheckoutReviewClient branch picker', () => {
  it('a manager (staff with ≥1 grant) sees an order-level "Ordering for branch" control', async () => {
    renderReview({ role: 'staff', branchStoreIds: ['store-2'], defaultStoreId: 'store-1' })
    expect(await screen.findByLabelText(/ordering for branch/i)).toBeTruthy()
  })

  it('plain staff (no grants) sees NO branch control', async () => {
    renderReview({ role: 'staff', branchStoreIds: [], defaultStoreId: 'store-1' })
    expect(await screen.findAllByText('Test tee')).toBeTruthy()
    expect(screen.queryByLabelText(/ordering for branch/i)).toBeNull()
  })

  it('an org_admin sees NO branch control', async () => {
    renderReview({ role: 'org_admin', branchStoreIds: [], defaultStoreId: 'store-1' })
    expect(await screen.findAllByText('Test tee')).toBeTruthy()
    expect(screen.queryByLabelText(/ordering for branch/i)).toBeNull()
  })

  it('choosing a branch rewrites perLineShipTo for every line and persists', async () => {
    mocks.lines = [line(), line({ lineId: 'line-2', productId: 'product-2' })]
    sessionStorage.setItem(
      CHECKOUT_REVIEW_STORAGE_KEY,
      JSON.stringify({
        idempotencyKey: 'idem-1', requiredBy: '', notes: '', intent: 'customer',
        perLineShipTo: { 'line-1': 'store-1', 'line-2': 'store-1' },
        customAddress: { name: '', address: '', city: '', postal_code: '', country: 'NZ' },
        createdAt: '2026-06-05T00:00:00.000Z',
      }),
    )
    renderReview({ role: 'staff', branchStoreIds: ['store-2'], defaultStoreId: 'store-1' })
    const select = await screen.findByLabelText(/ordering for branch/i)
    fireEvent.change(select, { target: { value: 'store-2' } })
    const persisted = readCheckoutReviewState()
    expect(persisted?.perLineShipTo).toEqual({ 'line-1': 'store-2', 'line-2': 'store-2' })
  })

  it('aborts the in-flight country preview when a manager changes branch', async () => {
    let firstPreviewSignal: AbortSignal | undefined
    let previewCalls = 0
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = String(input)
      if (url.startsWith('/api/checkout/billing-modes')) {
        return { status: 200, ok: true, json: async () => ({ modeByVariantId: {} }) } as Response
      }
      if (url === '/api/checkout/preview') {
        previewCalls += 1
        if (previewCalls === 1) {
          firstPreviewSignal = init?.signal as AbortSignal
          return new Promise<Response>(() => {})
        }
        return {
          status: 200, ok: true,
          json: async () => ({ outcomes: [], totalsByCurrency: {} }),
        } as Response
      }
      return {
        status: 200, ok: true, json: async () => ({ imagesByLineId: {} }),
      } as Response
    })

    renderReview({
      role: 'staff', branchStoreIds: ['store-2'], defaultStoreId: 'store-1',
      countryPartitionEnabled: true,
    })
    const select = await screen.findByLabelText(/ordering for branch/i)
    await vi.waitFor(() => expect(previewCalls).toBe(1))

    fireEvent.change(select, { target: { value: 'store-2' } })

    await vi.waitFor(() => expect(previewCalls).toBe(2))
    expect(firstPreviewSignal?.aborted).toBe(true)
  })
})
