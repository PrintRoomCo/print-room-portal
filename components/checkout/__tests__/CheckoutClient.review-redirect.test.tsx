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
  lines: [] as Array<Record<string, unknown>>,
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.push }),
}))

vi.mock('@/components/cart/useCart', () => ({
  useCart: () => ({
    lines: mocks.lines,
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

vi.mock('@/contexts/CurrencyContext', () => ({
  useCurrency: () => ({
    format: (n: number) => `$${n.toFixed(2)}`,
  }),
}))

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
    },
  ]
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
      intent: 'customer',
      perLineShipTo: { 'line-1': 'store-1' },
    })
  })

  it('defaults make-to-stock lines to customer intent (inventory is opt-in)', async () => {
    mocks.lines = [{ ...mocks.lines[0], fulfilmentType: 'made_to_order' }]
    const user = userEvent.setup()
    render(
      <CheckoutClient
        stores={[{ id: 'store-1', name: 'Main store', city: 'Auckland' }]}
        customerCode="CUST-1"
        paymentTerms="net20"
        defaultDepositPercent={null}
        defaultStoreId={null}
        isBuyer={false}
        tenantType="franchise"
      />,
    )

    // made_to_order means the qty must be produced — it does NOT auto-route to
    // the inventory shelf. The switch starts OFF; the order ships to the
    // customer by default.
    const inventorySwitch = screen.getByRole('switch', { name: /add all lines to my inventory/i })
    expect(inventorySwitch).toHaveAttribute('aria-checked', 'false')

    await user.click(screen.getByRole('button', { name: /review order/i }))

    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith('/checkout/review'))
    expect(JSON.parse(sessionStorage.getItem(CHECKOUT_REVIEW_STORAGE_KEY) ?? '{}')).toMatchObject({
      intent: 'customer',
      perLineShipTo: { 'line-1': 'store-1' },
    })
  })

  it('routes the order to inventory only when the admin opts in', async () => {
    mocks.lines = [{ ...mocks.lines[0], fulfilmentType: 'made_to_order' }]
    const user = userEvent.setup()
    render(
      <CheckoutClient
        stores={[{ id: 'store-1', name: 'Main store', city: 'Auckland' }]}
        customerCode="CUST-1"
        paymentTerms="net20"
        defaultDepositPercent={null}
        defaultStoreId={null}
        isBuyer={false}
        tenantType="franchise"
      />,
    )

    const inventorySwitch = screen.getByRole('switch', { name: /add all lines to my inventory/i })
    await user.click(inventorySwitch)
    expect(inventorySwitch).toHaveAttribute('aria-checked', 'true')

    await user.click(screen.getByRole('button', { name: /review order/i }))

    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith('/checkout/review'))
    expect(JSON.parse(sessionStorage.getItem(CHECKOUT_REVIEW_STORAGE_KEY) ?? '{}')).toMatchObject({
      intent: 'inventory',
    })
  })
})
