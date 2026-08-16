import { render, screen, within } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ProductDetailClient } from '../ProductDetailClient'

vi.mock('@/components/cart/useCart', () => ({ useCart: () => ({ addLine: vi.fn() }) }))
vi.mock('@/contexts/CurrencyContext', () => ({
  useCurrency: () => ({ format: (n: number) => `$${n}` }),
}))
// AU Stage 1: the PDP/checkout now read the org's billing region for the GST
// rate. access: null → gstRateForRegion(undefined) → 0.15, i.e. today's NZ
// behaviour, so every assertion below is unchanged. (House idiom — same shape
// as the CheckoutReviewClient tests.)
vi.mock('@/contexts/CompanyContext', () => ({
  useCompany: () => ({ access: null, loading: false }),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ back: vi.fn() }) }))

// A one-size, single-variant product with tracked stock — the visor case.
const product = {
  id: 'visor',
  name: 'Reburger Visor',
  description: null,
  image_url: null,
  moq: 1,
  lead_time_days: 7,
  sizing_type: 'one_size',
  fulfilment_type: 'stocked' as const,
  decoration_methods: null,
  decoration_price: null,
  sku: null,
  safety_standard: null,
  specs: null,
  supports_labels: null,
  garment_family: null,
  default_sizes: null,
  brand_name: null,
  category_name: null,
  catalogueItemId: 'i-visor',
}
const variants = [
  {
    variant_id: 'visor-black',
    color_swatch_id: 'black',
    color_label: 'Black',
    color_hex: '#000',
    color_position: 0,
    size_id: null,
    size_label: null,
    size_order: 0,
  },
]
// SKUCOLLAPSE: sizeless colourway → keyed `${variantId}::`.
const availability = {
  'visor-black::': { available_qty: 6, allow_order_without_stock: false },
} as never

function renderPDP(opts: { stockUnitPrice?: number | null } = {}) {
  return render(
    <ProductDetailClient
      product={product}
      variants={variants}
      sizes={[]}
      // No volume ladder → Stock-on-hand (inventory) mode, so the Available
      // column shows (mirrors the visor).
      brackets={[]}
      availability={availability}
      organizationId="o1"
      customerRole="org_admin"
      orderingPermission="both"
      images={[]}
      colourOptions={[]}
      decorations={[]}
      effectiveMoq={1}
      stockUnitPrice={opts.stockUnitPrice ?? null}
    />,
  )
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => ({ status: 'ok', unit_price: 19.8 }) })),
  )
})

describe('PDP one-size inventory table (visor parity with the hoodie)', () => {
  it('renders an Available column with the stock count and an inline Qty input', () => {
    renderPDP()
    // The hoodie-style table: an "Available" header + "Qty" header…
    expect(screen.getByRole('columnheader', { name: 'Available' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Qty' })).toBeInTheDocument()
    // …the tracked stock count shown in the row…
    expect(screen.getByText('6')).toBeInTheDocument()
    // …and the quantity input lives in that table (not a bare field below).
    expect(screen.getByLabelText('Quantity')).toBeInTheDocument()
  })

  it('folds the stock price INTO the inventory card — one card for a single variant', () => {
    // For one_size the standalone "Price" panel is merged into the Available|Qty
    // card, so a single-variant product shows price + available + qty in ONE card
    // instead of two stacked ones.
    renderPDP({ stockUnitPrice: 19.8 })
    const pricePanel = screen.getByTestId('stock-unit-price')
    expect(pricePanel).toHaveTextContent('$19.8')
    expect(pricePanel).toHaveTextContent(/per unit, excl\. GST/i)
    // The price and the inventory table share the SAME <section> (merged card).
    const card = pricePanel.closest('section')
    expect(card).not.toBeNull()
    expect(
      within(card!).getByRole('columnheader', { name: 'Available' }),
    ).toBeInTheDocument()
    expect(within(card!).getByLabelText('Quantity')).toBeInTheDocument()
  })
})
