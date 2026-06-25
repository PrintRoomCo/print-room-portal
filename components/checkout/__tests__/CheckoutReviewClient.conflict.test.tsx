import { render, screen, waitFor } from '@testing-library/react'
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

function renderReview() {
  return render(
    <CheckoutReviewClient
      stores={[{ id: 'store-1', name: 'Main store', city: 'Auckland' }]}
      customerCode="CUST-1"
      paymentTerms="net20"
      defaultDepositPercent={null}
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
