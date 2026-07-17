import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CheckoutReviewClient } from '../CheckoutReviewClient'
import { CHECKOUT_REVIEW_STORAGE_KEY } from '../checkoutReviewState'

const mocks = vi.hoisted(() => ({
  clear: vi.fn(),
  push: vi.fn(),
  lines: [] as Array<Record<string, unknown>>,
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.push }),
}))

vi.mock('@/components/cart/useCart', () => ({
  useCart: () => ({
    lines: mocks.lines,
    clear: mocks.clear,
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

function checkoutConflict(payload: unknown) {
  return {
    status: 409,
    ok: false,
    json: vi.fn().mockResolvedValue(payload),
  } as unknown as Response
}

function okJson(payload: unknown) {
  return {
    status: 200,
    ok: true,
    json: vi.fn().mockResolvedValue(payload),
  } as unknown as Response
}

function renderReview(overrides?: { isTest?: boolean; paymentTerms?: string | null }) {
  return render(
    <CheckoutReviewClient
      stores={[{ id: 'store-1', name: 'Main store', city: 'Auckland' }]}
      customerCode="CUST-1"
      paymentTerms={overrides?.paymentTerms ?? 'net20'}
      defaultDepositPercent={null}
      isTest={overrides?.isTest ?? false}
    />,
  )
}

function mockCheckoutFetch(response: Response) {
  vi.mocked(fetch).mockImplementation((input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString()
    if (url.includes('/api/checkout/review-images')) {
      return Promise.resolve(okJson({ imagesByLineId: {} }))
    }
    if (url.includes('/api/checkout')) {
      return Promise.resolve(response)
    }
    return Promise.reject(new Error(`Unexpected fetch: ${url}`))
  })
}

beforeEach(() => {
  sessionStorage.clear()
  mocks.lines = [
    {
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
    },
  ]
  mocks.clear.mockClear()
  mocks.push.mockClear()
  sessionStorage.setItem(
    CHECKOUT_REVIEW_STORAGE_KEY,
    JSON.stringify({
      idempotencyKey: 'idem-1',
      requiredBy: '',
      notes: '',
      intent: 'customer',
      perLineShipTo: { 'line-1': 'store-1' },
      customAddress: {
        name: '',
        address: '',
        city: '',
        postal_code: '',
        country: 'NZ',
      },
      createdAt: '2026-06-05T00:00:00.000Z',
    }),
  )
  vi.stubGlobal('fetch', vi.fn())
})

describe('CheckoutReviewClient conflict handling', () => {
  it('keeps unit price drift visible on the review page instead of routing to cart', async () => {
    const user = userEvent.setup()
    mockCheckoutFetch(
      checkoutConflict({
        error: 'unit_price_drift',
        priceDrift: [
          {
            cartLineId: 'line-1',
            productId: 'product-1',
            productName: 'Test tee',
            qty: 12,
            claimedUnitPrice: 10,
            canonicalUnitPrice: 11,
          },
        ],
      }),
    )

    renderReview()

    await user.click(await screen.findByRole('button', { name: /confirm & place order/i }))

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        /pricing has changed since you added these to your cart/i,
      ),
    )
    expect(screen.getByRole('alert')).toHaveTextContent(/test tee/i)
    expect(mocks.push).not.toHaveBeenCalledWith('/cart')
    expect(mocks.push).not.toHaveBeenCalled()
    expect(mocks.clear).not.toHaveBeenCalled()
  })

  it('keeps OUT_OF_STOCK visible on the review page instead of routing to cart', async () => {
    const user = userEvent.setup()
    mockCheckoutFetch(checkoutConflict({ error: 'OUT_OF_STOCK' }))

    renderReview()

    await user.click(await screen.findByRole('button', { name: /confirm & place order/i }))

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        /stock changed while you were checking out/i,
      ),
    )
    expect(mocks.push).not.toHaveBeenCalledWith('/cart')
    expect(mocks.push).not.toHaveBeenCalled()
    expect(mocks.clear).not.toHaveBeenCalled()
  })
})

describe('CheckoutReviewClient double-submit guard', () => {
  it('issues only one /api/checkout POST when the place-order button is double-fired', async () => {
    // review-images resolves so the page hydrates; the checkout POST never
    // resolves, so the first submit stays in flight. Two clicks dispatched in a
    // single act() (before React can re-render + disable the button) exercise the
    // re-entry guard directly rather than relying on the disabled state.
    vi.mocked(fetch).mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url.includes('/api/checkout/review-images')) {
        return Promise.resolve(okJson({ imagesByLineId: {} }))
      }
      // Must precede the '/api/checkout' catch-all below, which would otherwise
      // hand the POST's response to the billing read. The page holds its total
      // (and disables the CTA) until this resolves.
      if (url.includes('/api/checkout/billing-modes')) {
        return Promise.resolve(okJson({ modeByVariantId: {} }))
      }
      if (url.includes('/api/checkout')) {
        return new Promise<Response>(() => {}) // never resolves — stays in flight
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`))
    })

    renderReview()
    const btn = await screen.findByRole('button', { name: /confirm & place order/i })

    await act(async () => {
      btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
      btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    })

    const checkoutPosts = vi.mocked(fetch).mock.calls.filter(([input]) => {
      const url = typeof input === 'string' ? input : (input as URL).toString()
      return (
        url.includes('/api/checkout') &&
        !url.includes('review-images') &&
        !url.includes('billing-modes')
      )
    })
    expect(checkoutPosts).toHaveLength(1)
  })
})

describe('CheckoutReviewClient placing overlay', () => {
  it('shows the placing overlay while submitting and keeps it up through the redirect', async () => {
    let resolveCheckout: (v: Response) => void = () => {}
    vi.mocked(fetch).mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url.includes('/api/checkout/review-images')) {
        return Promise.resolve(okJson({ imagesByLineId: {} }))
      }
      // Must precede the '/api/checkout' catch-all below, which would otherwise
      // hand the POST's response to the billing read. The page holds its total
      // (and disables the CTA) until this resolves.
      if (url.includes('/api/checkout/billing-modes')) {
        return Promise.resolve(okJson({ modeByVariantId: {} }))
      }
      if (url.includes('/api/checkout')) {
        return new Promise<Response>((r) => {
          resolveCheckout = r
        })
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`))
    })

    const user = userEvent.setup()
    renderReview()
    await user.click(await screen.findByRole('button', { name: /confirm & place order/i }))

    // Overlay visible while the POST is in flight.
    expect(await screen.findByRole('status')).toHaveTextContent(/placing your order/i)

    // Resolve the POST successfully → the client navigates (router.push) but must
    // keep the overlay up so the emptied cart never flashes on the review page.
    await act(async () => {
      resolveCheckout(okJson({ order_id: 'o1', order_ref: 'R1' }))
    })

    expect(mocks.push).toHaveBeenCalledWith('/checkout/confirmation/o1')
    expect(screen.getByRole('status')).toHaveTextContent(/placing your order/i)
  })
})

describe('CheckoutReviewClient line display', () => {
  it('uses the catalogue front image when the cart line stored the product fallback', async () => {
    mocks.lines[0] = {
      ...mocks.lines[0],
      imageUrl: 'https://cdn.example/marketing.jpg',
    }
    vi.mocked(fetch).mockResolvedValue(
      okJson({ imagesByLineId: { 'line-1': 'https://cdn.example/front.png' } }),
    )

    const { container } = renderReview()

    await waitFor(() =>
      expect(container.querySelector('img')?.getAttribute('src')).toContain(
        'https://cdn.example/front.png',
      ),
    )
  })

  it('hides the generic custom decoration label on review lines', async () => {
    mocks.lines[0] = {
      ...mocks.lines[0],
      catalogueItemId: null,
      decorations: [
        {
          linkId: 'deco-1',
          decorationId: 'org-deco-1',
          name: 'Custom decoration',
          method: 'custom',
          positionLabel: null,
          unitPrice: 0,
          artworkUrl: null,
          snapshotUrl: null,
        },
      ],
    }
    vi.mocked(fetch).mockResolvedValue(okJson({ imagesByLineId: {} }))

    renderReview()

    expect(screen.queryByText('Custom decoration')).not.toBeInTheDocument()
    await waitFor(() => expect(fetch).toHaveBeenCalledWith(
      '/api/checkout/review-images',
      expect.objectContaining({ method: 'POST' }),
    ))
  })
})

describe('CheckoutReviewClient payment terms visibility', () => {
  it('shows the payment terms block for a real (non-test) org', async () => {
    vi.mocked(fetch).mockResolvedValue(okJson({ imagesByLineId: {} }))

    renderReview({ isTest: false, paymentTerms: 'net30' })

    expect(await screen.findByText(/payment terms:/i)).toBeInTheDocument()
    expect(screen.getByText('net30')).toBeInTheDocument()
  })

  it('hides the payment terms block for a test/demo org', async () => {
    vi.mocked(fetch).mockResolvedValue(okJson({ imagesByLineId: {} }))

    renderReview({ isTest: true, paymentTerms: 'net30' })

    // Wait for the review to hydrate (product line only renders in the full view).
    await screen.findAllByText('Test tee')
    expect(screen.queryByText(/payment terms:/i)).not.toBeInTheDocument()
    expect(screen.queryByText('net30')).not.toBeInTheDocument()
  })
})
