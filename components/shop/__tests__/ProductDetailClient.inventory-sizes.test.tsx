import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { ProductDetailClient } from '../ProductDetailClient'

// Same mock surface as ProductDetailClient.pills.test.tsx.
vi.mock('@/components/cart/useCart', () => ({ useCart: () => ({ addLine: vi.fn() }) }))
vi.mock('@/contexts/CurrencyContext', () => ({
  useCurrency: () => ({ format: (n: number) => `$${n}` }),
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
  catalogueVariantLabel: null,
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
  'red-s::1': { available_qty: 4, allow_order_without_stock: false },
  'red-s::2': { available_qty: 0, allow_order_without_stock: false },
} as never

// All-out-of-stock variant of `availability`: with no inventory on the current
// selection, canChooseOrderIntent is false, so an org_admin lands in reorder
// (made-to-order) mode by default — the canonical bulk-order case.
const noStock = {
  'red-s::1': { available_qty: 0, allow_order_without_stock: false },
  'red-s::2': { available_qty: 0, allow_order_without_stock: false },
} as never

const backorderable = {
  'red-s::1': { available_qty: 0, allow_order_without_stock: true },
  'red-m::2': { available_qty: 0, allow_order_without_stock: true },
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

  it('reorder mode (made_to_order, no stock): all sizes + Available column unchanged', () => {
    // made_to_order + org_admin + tiers, but NO inventory on the selection →
    // canChooseOrderIntent false → reorder mode (all sizes + Available column).
    // (A made_to_order product that DOES carry stock now defaults to inventory
    //  mode with a toggle — restored pre-2026-06-03 behavior; see pills test.)
    renderPDP({ fulfilment_type: 'made_to_order', role: 'org_admin', availability: noStock })
    expect(screen.getByLabelText('Quantity for size S')).toBeInTheDocument()
    expect(screen.getByLabelText('Quantity for size M')).toBeInTheDocument()
    expect(
      screen.getByRole('columnheader', { name: 'Available' }),
    ).toBeInTheDocument()
  })

  it('legacy per-size variants display every order-without-stock size as available to order', () => {
    renderPDP({
      fulfilment_type: 'made_to_order',
      role: 'org_admin',
      availability: backorderable,
    })
    expect(screen.getByLabelText('Quantity for size S')).toBeInTheDocument()
    expect(screen.getByLabelText('Quantity for size M')).toBeInTheDocument()
    expect(screen.getAllByText(/Available to order/i)).toHaveLength(3)
    expect(screen.queryByText('Out of stock')).not.toBeInTheDocument()
  })
})

describe('PDP multi-size table — made-to-order rows with no inventory record (2026-06-29)', () => {
  it('shows "Available to order" per untracked size instead of a — placeholder', () => {
    // made_to_order + org_admin + NO availability rows → every size is untracked
    // (available === null), the canonical MTO/in-house product case. The product
    // is still fully orderable via production (deadZone false, !isInventoryMode),
    // so each size row should read "Available to order" rather than "—".
    renderPDP({ fulfilment_type: 'made_to_order', role: 'org_admin', availability: {} as never })
    expect(screen.getByLabelText('Quantity for size S')).toBeInTheDocument()
    expect(screen.getByLabelText('Quantity for size M')).toBeInTheDocument()
    // One mint pill per untracked size row. The header AvailabilityBadge renders
    // nothing here (colourTotalAvailable is undefined), so the only matches are
    // the two in-table cells — and the "—" placeholder is gone.
    expect(screen.getAllByText(/Available to order/i)).toHaveLength(2)
  })
})
