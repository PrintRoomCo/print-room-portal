import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ProductDetailClient } from '../ProductDetailClient'

/**
 * Country-partition pricing is verified by a DEBOUNCED fetch keyed on qty, so
 * every quantity keystroke re-opens that window. Marking the item unavailable
 * while the window is open swapped the whole ordering UI — variant picker, qty
 * input, price, CTA — for "<product> is not orderable to NZ yet" on every
 * keystroke, on a fully-configured NZ catalogue. (2026-08-26, Jon.)
 *
 * Pending is not the same claim as unavailable. Pending blocks the CTA; only a
 * RESOLVED missing price may say the country is not orderable.
 */

const { addLine } = vi.hoisted(() => ({ addLine: vi.fn() }))
vi.mock('@/components/cart/useCart', () => ({ useCart: () => ({ addLine }) }))
vi.mock('@/contexts/CurrencyContext', () => ({
  useCurrency: () => ({ format: (n: number) => `$${n}` }),
}))
vi.mock('@/contexts/CompanyContext', () => ({
  useCompany: () => ({
    access: null,
    loading: false,
    defaultBillingCountry: {
      code: 'NZ',
      name: 'New Zealand',
      currency: 'NZD',
      taxRate: 0.15,
      taxLabel: 'GST 15%',
      isDefault: true,
    },
  }),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ back: vi.fn() }) }))
vi.mock('next/image', () => ({
  // eslint-disable-next-line @next/next/no-img-element
  default: ({ alt = '' }: { alt?: string }) => <img alt={alt} />,
}))

const product = {
  id: 'p-hoodie',
  name: 'Everyday Pullover Hoodie',
  description: null,
  image_url: null,
  moq: 1,
  lead_time_days: 7,
  sizing_type: 'one_size',
  decoration_methods: null,
  decoration_price: null,
  sku: null,
  safety_standard: null,
  specs: null,
  supports_labels: null,
  garment_family: null,
  default_sizes: null,
  fulfilment_type: 'made_to_order' as const,
  brand_name: null,
  category_name: null,
  catalogueItemId: 'ci-hoodie',
  priceMode: 'manual_final' as const,
  manualDecorationSeed: { 1: 6.5 },
}

function stubFetch(decorationPricing: () => Promise<unknown>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('/api/shop/decoration-pricing')) {
        return { ok: true, json: decorationPricing }
      }
      return { ok: true, json: async () => ({ status: 'ok', unit_price: 49.16 }) }
    }),
  )
}

function renderPDP() {
  return render(
    <ProductDetailClient
      product={product}
      variants={[]}
      sizes={[]}
      brackets={[{ min_quantity: 1, max_quantity: null, unit_price: 49.16 }]}
      availability={{}}
      organizationId="o1"
      customerRole="org_admin"
      orderingPermission="both"
      images={[]}
      colourOptions={[]}
      decorations={[]}
      effectiveMoq={1}
      priceCurrency="NZD"
      priceCountryCode="NZ"
    />,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  stubFetch(async () => ({ pricesByQty: {}, manualByQty: { '1': 6.5, '50': 5 } }))
})

describe('PDP country pricing — pending is not unavailable', () => {
  it('does not claim the country is unorderable while a qty re-price is in flight', async () => {
    renderPDP()
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /add to cart/i })).toBeEnabled(),
    )

    // Re-price never resolves: the pending window stays open indefinitely.
    stubFetch(() => new Promise<never>(() => {}))
    fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: '50' } })

    expect(
      screen.queryByText('Everyday Pullover Hoodie is not orderable to NZ yet'),
    ).not.toBeInTheDocument()
    // The ordering UI must survive the keystroke — this is what was vanishing.
    expect(screen.getByLabelText('Quantity')).toBeInTheDocument()
  })

  it('still blocks the CTA while that re-price is in flight', async () => {
    renderPDP()
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /add to cart/i })).toBeEnabled(),
    )

    stubFetch(() => new Promise<never>(() => {}))
    fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: '50' } })

    // The CTA relabels to "Checking price..." while a re-price runs — still the
    // same button, still disabled. That is the correct blocked state: a disabled
    // CTA, not a vanished ordering UI.
    expect(
      screen.getByRole('button', { name: /add to cart|checking price/i }),
    ).toBeDisabled()
  })

  it('does say unorderable once a resolved fetch confirms no price at that qty', async () => {
    renderPDP()
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /add to cart/i })).toBeEnabled(),
    )

    stubFetch(async () => ({ pricesByQty: {}, manualByQty: { '50': null } }))
    fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: '50' } })

    await waitFor(
      () =>
        expect(
          screen.getByText('Everyday Pullover Hoodie is not orderable to NZ yet'),
        ).toBeInTheDocument(),
      { timeout: 3000 },
    )
  })
})
