import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { ProductDetailClient } from '../ProductDetailClient'

// Same mock surface as ProductDetailClient.pills.test.tsx.
vi.mock('@/components/cart/useCart', () => ({ useCart: () => ({ addLine: vi.fn() }) }))
vi.mock('@/contexts/CurrencyContext', () => ({
  useCurrency: () => ({ format: (n: number) => `$${n}` }),
}))
// Supply the complete NZ country config used by this component's price display.
vi.mock('@/contexts/CompanyContext', () => ({
  useCompany: () => ({ access: null, loading: false, defaultBillingCountry: { code: 'NZ', name: 'New Zealand', currency: 'NZD', taxRate: 0.15, taxLabel: 'GST 15%', isDefault: true } }),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ back: vi.fn() }) }))

const baseProduct = {
  id: 'p1',
  name: 'Tee',
  description: null,
  image_url: null,
  moq: 1,
  lead_time_days: 7,
  sizing_type: 'multi_size_with_variants',
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
  catalogueItemId: 'i1',
}

// Red has an in-stock S (4) and an out-of-stock M (0). The inline multi-size
// table is the real PDP size surface (VariantPicker renders colour-only here).
const variants = [
  {
    variant_id: 'red-s',
    color_swatch_id: 'red',
    color_label: 'Red',
    color_hex: '#f00',
    color_position: 0,
    size_id: 1,
    size_label: 'S',
    size_order: 0,
  },
  {
    variant_id: 'red-m',
    color_swatch_id: 'red',
    color_label: 'Red',
    color_hex: '#f00',
    color_position: 0,
    size_id: 2,
    size_label: 'M',
    size_order: 1,
  },
]
// SKUCOLLAPSE: availability keyed `${colourwayVariantId}::${sizeId}`. The
// component elects the first variant of a colour as the colourway → 'red-s'.
const availability = {
  'red-s::1': { available_qty: 4 },
  'red-s::2': { available_qty: 0 },
} as never

// All-out-of-stock variant of `availability`: with no inventory on the current
// selection, canChooseOrderIntent is false, so an org_admin lands in reorder
// (made-to-order) mode by default — the canonical bulk-order case.
const noStock = {
  'red-s::1': { available_qty: 0 },
  'red-s::2': { available_qty: 0 },
} as never

const backorderable = {
  'red-s::1': { available_qty: 0 },
  'red-m::2': { available_qty: 0 },
} as never

const SIZES = [
  { size_id: 1, size_label: 'S', size_order: 0 },
  { size_id: 2, size_label: 'M', size_order: 1 },
]

function renderPDP(opts: {
  fulfilment_type: 'stocked' | 'made_to_order' | 'mixed'
  role: 'org_admin' | 'staff'
  availability?: typeof availability
}) {
  return render(
    <ProductDetailClient
      product={{ ...baseProduct, fulfilment_type: opts.fulfilment_type }}
      variants={variants}
      sizes={SIZES}
      brackets={[{ min_quantity: 1, max_quantity: null, unit_price: 10 }]}
      availability={opts.availability ?? availability}
      organizationId="o1"
      customerRole={opts.role}
      orderingPermission="both"
      images={[]}
      colourOptions={[]}
      decorations={[]}
      effectiveMoq={1}
    />,
  )
}

describe('PDP multi-size table — From-inventory available qty (Item 3, inverted 2026-06-03)', () => {
  it('inventory mode (stocked): only in-stock sizes, AND shows the Available qty per size', () => {
    // stocked product → isInventoryMode is forced true regardless of role.
    renderPDP({ fulfilment_type: 'stocked', role: 'org_admin' })
    // In-stock size S is orderable…
    expect(screen.getByLabelText('Quantity for size S')).toBeInTheDocument()
    // …the 0-stock size M is hidden (in-stock-only filter stays)…
    expect(screen.queryByLabelText('Quantity for size M')).not.toBeInTheDocument()
    // …and From-inventory mode SHOWS the available quantity per size:
    // the Available column is present and S's stock (4) is displayed.
    // (Reversal of Plan C Task 6/7, confirmed 2026-06-03 — customers need to
    //  see how much stock is available per size when drawing from inventory.)
    expect(
      screen.getByRole('columnheader', { name: 'Available' }),
    ).toBeInTheDocument()
    expect(screen.getByText('4')).toBeInTheDocument()
  })

  it('reorder mode (made_to_order, no stock): all sizes shown, Available column hidden (Item 6)', () => {
    // made_to_order + org_admin + tiers, but NO inventory on the selection →
    // canChooseOrderIntent false → purchase-order mode. Item 6 hides the whole
    // Available column in purchase-order mode; every size row still renders.
    renderPDP({ fulfilment_type: 'made_to_order', role: 'org_admin', availability: noStock })
    expect(screen.getByLabelText('Quantity for size S')).toBeInTheDocument()
    expect(screen.getByLabelText('Quantity for size M')).toBeInTheDocument()
    expect(
      screen.queryByRole('columnheader', { name: 'Available' }),
    ).not.toBeInTheDocument()
  })

  it('backorderable made-to-order sizes still render, Available column hidden (Item 6)', () => {
    renderPDP({
      fulfilment_type: 'made_to_order',
      role: 'org_admin',
      availability: backorderable,
    })
    expect(screen.getByLabelText('Quantity for size S')).toBeInTheDocument()
    expect(screen.getByLabelText('Quantity for size M')).toBeInTheDocument()
    // Item 6: purchase-order mode hides the whole Available column AND the header
    // badge, so the per-size "Available to order" chips no longer render.
    expect(screen.queryByText(/Available to order/i)).not.toBeInTheDocument()
    expect(screen.queryByText('Out of stock')).not.toBeInTheDocument()
  })
})

describe('PDP multi-size table — made-to-order rows with no inventory record (2026-06-29)', () => {
  it('renders every untracked size row with the Available column hidden (Item 6)', () => {
    // made_to_order + org_admin + NO availability rows → purchase-order mode.
    // Item 6 hides the whole Available column here, so the per-size
    // "Available to order" chips no longer render; the size rows still do.
    renderPDP({ fulfilment_type: 'made_to_order', role: 'org_admin', availability: {} as never })
    expect(screen.getByLabelText('Quantity for size S')).toBeInTheDocument()
    expect(screen.getByLabelText('Quantity for size M')).toBeInTheDocument()
    expect(screen.queryByText(/Available to order/i)).not.toBeInTheDocument()
  })
})
