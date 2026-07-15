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
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ imagesByLineId: {} }),
    }),
  )
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
        isTest={false}
        defaultStoreId={null}
        isBuyer={false}
        tenantType="studio"
      />,
    )

    await user.click(screen.getByRole('button', { name: /review order/i }))

    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith('/checkout/review'))
    expect(
      vi.mocked(fetch).mock.calls.some(([input]) => String(input) === '/api/checkout'),
    ).toBe(false)

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
        isTest={false}
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
        isTest={false}
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

  it('lets a staff member with a default store choose a one-time address', async () => {
    const user = userEvent.setup()
    render(
      <CheckoutClient
        stores={[
          { id: 'store-1', name: 'Main store', city: 'Auckland' },
          { id: 'store-2', name: 'Other store', city: 'Wellington' },
        ]}
        customerCode="CUST-1"
        paymentTerms="net20"
        defaultDepositPercent={null}
        isTest={false}
        defaultStoreId="store-1"
        isBuyer={true}
        tenantType="studio"
      />,
    )

    const shipTo = screen.getByLabelText(/ship to/i)
    expect(shipTo).toBeEnabled()
    expect(screen.getByRole('option', { name: /pick a one-time address/i })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /other store/i })).not.toBeInTheDocument()

    await user.selectOptions(shipTo, '__custom__')
    await user.type(screen.getByPlaceholderText(/recipient name/i), 'Sam Buyer')
    await user.type(screen.getByPlaceholderText(/street address/i), '12 Queen St')
    await user.type(screen.getByPlaceholderText(/^city$/i), 'Auckland')
    await user.clear(screen.getByPlaceholderText(/^country$/i))
    await user.type(screen.getByPlaceholderText(/^country$/i), 'NZ')

    await user.click(screen.getByRole('button', { name: /review order/i }))

    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith('/checkout/review'))
    expect(JSON.parse(sessionStorage.getItem(CHECKOUT_REVIEW_STORAGE_KEY) ?? '{}')).toMatchObject({
      intent: 'customer',
      perLineShipTo: { 'line-1': null },
      customAddress: {
        name: 'Sam Buyer',
        address: '12 Queen St',
        city: 'Auckland',
        country: 'NZ',
      },
    })
  })

  it('hides the deposit / payment-terms banner for a demo (is_test) org', () => {
    const bannerProps = {
      stores: [{ id: 'store-1', name: 'Main store', city: 'Auckland' }],
      customerCode: 'CUST-1',
      paymentTerms: 'net30',
      defaultDepositPercent: 20,
      defaultStoreId: null,
      isBuyer: false,
      tenantType: 'studio' as const,
    }

    const { rerender } = render(<CheckoutClient {...bannerProps} isTest={false} />)
    // Real org: the deposit / payment-terms banner is shown.
    expect(screen.getByText(/A deposit of/i)).toBeInTheDocument()

    // Demo (is_test) org: the same banner is suppressed, mirroring the review screen.
    rerender(<CheckoutClient {...bannerProps} isTest={true} />)
    expect(screen.queryByText(/A deposit of/i)).not.toBeInTheDocument()
  })
})
