import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CheckoutClient } from '../CheckoutClient'
import { CHECKOUT_REVIEW_STORAGE_KEY } from '../checkoutReviewState'

const mocks = vi.hoisted(() => ({
  clear: vi.fn(),
  push: vi.fn(),
  updateLine: vi.fn(),
  removeLine: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.push }),
}))

vi.mock('@/components/cart/useCart', () => ({
  useCart: () => ({
    lines: [
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
      },
    ],
    clear: mocks.clear,
    updateLine: mocks.updateLine,
    removeLine: mocks.removeLine,
  }),
}))

vi.mock('@/lib/pricing/usePricingContext', () => ({
  usePricingContext: () => ({
    pricingMode: 'catalogue',
    tierLabel: 'Catalogue',
    tierDiscount: 0,
  }),
}))

beforeEach(() => {
  sessionStorage.clear()
  mocks.clear.mockClear()
  mocks.push.mockClear()
  mocks.updateLine.mockClear()
  mocks.removeLine.mockClear()
  vi.stubGlobal('fetch', vi.fn())
})

describe('CheckoutClient review step', () => {
  it('navigates to checkout review on submit and does not post the order', async () => {
    const user = userEvent.setup()
    render(
      <CheckoutClient
        stores={[{ id: 'store-1', name: 'Main store', city: 'Auckland' }]}
        customerCode="CUST-1"
        paymentTerms="net20"
        defaultDepositPercent={null}
        defaultStoreId={null}
        isBuyer={false}
        tenantType="studio"
      />,
    )

    await user.click(screen.getByRole('button', { name: /review order/i }))

    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith('/checkout/review'))
    expect(fetch).not.toHaveBeenCalled()

    const raw = sessionStorage.getItem(CHECKOUT_REVIEW_STORAGE_KEY)
    expect(raw).toBeTruthy()
    expect(JSON.parse(raw ?? '{}')).toMatchObject({
      requiredBy: '',
      notes: '',
      perLineShipTo: { 'line-1': 'store-1' },
    })
  })
})
