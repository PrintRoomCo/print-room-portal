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
const availability = {
  'red-s': { available_qty: 4, allow_order_without_stock: false },
  'red-m': { available_qty: 0, allow_order_without_stock: false },
} as never

function renderPDP(opts: {
  fulfilment_type: 'stocked' | 'made_to_order' | 'mixed'
  role: 'org_admin' | 'staff'
}) {
  return render(
    <ProductDetailClient
      product={{ ...baseProduct, fulfilment_type: opts.fulfilment_type }}
      variants={variants}
      brackets={[{ min_quantity: 1, max_quantity: null, unit_price: 10 }]}
      availability={availability}
      organizationId="o1"
      customerRole={opts.role}
      images={[]}
      colourOptions={[]}
      decorations={[]}
      effectiveMoq={1}
    />,
  )
}

describe('PDP multi-size table — From-inventory suppression (Item 3)', () => {
  it('inventory mode (stocked): only in-stock sizes, no Available status column', () => {
    // stocked product → isInventoryMode is forced true regardless of role.
    renderPDP({ fulfilment_type: 'stocked', role: 'org_admin' })
    // In-stock size S is orderable…
    expect(screen.getByLabelText('Quantity for size S')).toBeInTheDocument()
    // …the 0-stock size M is hidden…
    expect(screen.queryByLabelText('Quantity for size M')).not.toBeInTheDocument()
    // …and the availability status column is dropped.
    expect(
      screen.queryByRole('columnheader', { name: 'Available' }),
    ).not.toBeInTheDocument()
  })

  it('reorder mode (made_to_order): all sizes + Available column unchanged', () => {
    // made_to_order + org_admin + tiers → isInventoryMode false (reorder).
    renderPDP({ fulfilment_type: 'made_to_order', role: 'org_admin' })
    expect(screen.getByLabelText('Quantity for size S')).toBeInTheDocument()
    expect(screen.getByLabelText('Quantity for size M')).toBeInTheDocument()
    expect(
      screen.getByRole('columnheader', { name: 'Available' }),
    ).toBeInTheDocument()
  })
})
