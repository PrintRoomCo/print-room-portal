import { act, render, screen, waitFor } from '@testing-library/react'
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
    currency: 'NZD',
    rates: { NZD: 1, AUD: 0.8, USD: 0.6, GBP: 0.44, EUR: 0.51 },
    convert: (n: number) => n,
    format: (n: number) => `$${n.toFixed(2)}`,
    formatFrom: (n: number, sourceCurrency: string) => `DISPLAY(${n}:${sourceCurrency})`,
  }),
}))
// Supply the complete NZ country config used by this component's price display.
vi.mock('@/contexts/CompanyContext', () => ({
  useCompany: () => ({ access: null, loading: false, defaultBillingCountry: { code: 'NZ', name: 'New Zealand', currency: 'NZD', taxRate: 0.15, taxLabel: 'GST 15%', isDefault: true } }),
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

// SP1: CheckoutClient now requires the org's enabled countries. These tests
// are all single-country (NZ) orgs, so the select renders hidden-equivalent.
const ENABLED_COUNTRIES = [{ code: 'NZ', name: 'New Zealand', isDefault: true }]

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
        enabledCountries={ENABLED_COUNTRIES}
      />,
    )

    await user.click(screen.getByRole('button', { name: /review order/i }))

    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith('/checkout/review'))
    expect(
      vi.mocked(fetch).mock.calls.some(([input]) => String(input) === '/api/checkout'),
    ).toBe(false)
    expect(
      vi.mocked(fetch).mock.calls.some(([input]) => String(input) === '/api/checkout/preview'),
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

  it('renders the server-priced country group and blocks review until it resolves', async () => {
    let resolvePreview!: (value: Response) => void
    vi.mocked(fetch).mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/checkout/preview') {
        return new Promise<Response>((resolve) => { resolvePreview = resolve })
      }
      if (url.startsWith('/api/checkout/billing-modes')) {
        return Promise.resolve({
          ok: true, status: 200, json: async () => ({ modeByVariantId: {} }),
        } as Response)
      }
      return Promise.resolve({
        ok: true, status: 200, json: async () => ({ imagesByLineId: {} }),
      } as Response)
    })
    mocks.lines[0] = { ...mocks.lines[0], priceCurrency: 'NZD' }

    render(
      <CheckoutClient
        stores={[{ id: 'store-au', name: 'Melbourne', city: 'Melbourne', country: 'AU' }]}
        customerCode="CUST-1"
        paymentTerms="net20"
        defaultDepositPercent={null}
        isTest={false}
        defaultStoreId={null}
        isBuyer={false}
        tenantType="studio"
        enabledCountries={[{ code: 'AU', name: 'Australia', isDefault: true }]}
        countryPartitionEnabled
      />,
    )

    expect(screen.getByRole('button', { name: /review order/i })).toBeDisabled()
    expect(screen.queryByText('Australia · AUD')).not.toBeInTheDocument()

    await waitFor(() => expect(resolvePreview).toBeTypeOf('function'))
    await act(async () => resolvePreview({
      ok: true,
      status: 200,
      json: async () => ({
        outcomes: [{
          ok: true,
          partition: {
            key: 'AU:purchase_order',
            country: {
              code: 'AU', name: 'Australia', currency: 'AUD', taxRate: 0.1,
              taxLabel: 'GST 10%', isDefault: true,
            },
            orderType: 'purchase_order',
            lines: [{
              product_id: 'product-1', product_name: 'Test tee', variant_id: 'variant-1',
              qty: 12, cart_line_id: 'line-1', cartLineId: 'line-1', unitPrice: 11,
              decorationUnitPrice: 0, billingMode: 'invoice_on_dispatch', billed: true,
              fulfilment_type: 'made_to_order', repricedFromCurrency: 'NZD',
            }],
            pricingPoolLines: [],
            totals: {
              goodsSubtotal: 132, decorationSubtotal: 0, pickingFee: 0,
              tax: 13.2, total: 145.2,
            },
          },
        }],
        totalsByCurrency: { AUD: 145.2 },
      }),
    } as Response))

    expect(await screen.findByText('Australia')).toBeInTheDocument()
    expect(screen.queryByText('Australia · AUD')).not.toBeInTheDocument()
    expect(screen.getByText(/Repriced from NZD for delivery to Australia/)).toBeInTheDocument()
    expect(screen.getAllByText('DISPLAY(145.2:AUD)')).not.toHaveLength(0)
    expect(screen.getByText('$181.50 NZD')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Invoicing currency' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Review order' })).toBeEnabled()
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
        enabledCountries={ENABLED_COUNTRIES}
      />,
    )

    // made_to_order means the qty must be produced; it does NOT auto-route to
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
        enabledCountries={ENABLED_COUNTRIES}
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
        enabledCountries={ENABLED_COUNTRIES}
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
    // SP1: country is a select over the org's enabled countries, pre-set to the
    // org default: free text is no longer possible, so nothing is typed here.
    const countrySelect = document.getElementById('custom-shipping-country') as HTMLSelectElement
    expect(countrySelect.value).toBe('NZ')

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
      enabledCountries: ENABLED_COUNTRIES,
    }

    const { rerender } = render(<CheckoutClient {...bannerProps} isTest={false} />)
    // Real org: the deposit / payment-terms banner is shown.
    expect(screen.getByText(/A deposit of/i)).toBeInTheDocument()

    // Demo (is_test) org: the same banner is suppressed, mirroring the review screen.
    rerender(<CheckoutClient {...bannerProps} isTest={true} />)
    expect(screen.queryByText(/A deposit of/i)).not.toBeInTheDocument()
  })

  it('uses the OEM information surface for the flag-on deposit notice', () => {
    render(
      <CheckoutClient
        stores={[{ id: 'store-1', name: 'Main store', city: 'Auckland', country: 'NZ' }]}
        customerCode="CUST-1"
        paymentTerms="net30"
        defaultDepositPercent={20}
        isTest={false}
        defaultStoreId={null}
        isBuyer={false}
        tenantType="studio"
        enabledCountries={ENABLED_COUNTRIES}
        countryPartitionEnabled
      />,
    )

    const notice = screen.getByText(/A deposit of 20% will be invoiced per order/i)
      .closest('div')
    expect(notice).toHaveClass('rounded-2xl', 'border-black/10', 'bg-white', 'text-black/70')
    expect(notice?.className).not.toMatch(/rounded-xl|sky-/)
  })
})
