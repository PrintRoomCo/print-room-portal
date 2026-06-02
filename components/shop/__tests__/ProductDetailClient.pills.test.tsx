import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { ProductDetailClient } from '../ProductDetailClient'

// Mock the actual hook import paths used by the component:
//   useCart   <- '@/components/cart/useCart'
//   useCurrency <- '@/contexts/CurrencyContext'
vi.mock('@/components/cart/useCart', () => ({ useCart: () => ({ addLine: vi.fn() }) }))
vi.mock('@/contexts/CurrencyContext', () => ({
  useCurrency: () => ({ format: (n: number) => `$${n}` }),
}))
// CatalogueTopBar (rendered by the PDP) calls useRouter() from next/navigation,
// which has no router mounted under jsdom — stub it.
vi.mock('next/navigation', () => ({ useRouter: () => ({ back: vi.fn() }) }))

// sizing_type must NOT be 'one_size' so sizingMode resolves to
// 'multi_size_with_variants' (with variants.length > 0), which is the only
// path where currentSelectionHasInventory becomes true off the per-colour
// size rows — the gate that mounts the order-mode toggle.
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

function renderPDP(opts: {
  fulfilment_type: 'stocked' | 'made_to_order' | 'mixed'
  role: 'org_admin' | 'staff'
}) {
  return render(
    <ProductDetailClient
      product={{ ...baseProduct, fulfilment_type: opts.fulfilment_type }}
      variants={[
        {
          variant_id: 'v1',
          color_swatch_id: 'red',
          color_label: 'Red',
          color_hex: '#f00',
          color_position: 0,
          size_id: 1,
          size_label: 'S',
          size_order: 0,
        },
      ]}
      brackets={[{ min_quantity: 1, max_quantity: null, unit_price: 10 }]}
      availability={{ v1: { available_qty: 5, allow_order_without_stock: false } }}
      organizationId="o1"
      customerRole={opts.role}
      images={[]}
      colourOptions={[]}
      decorations={[]}
      effectiveMoq={1}
    />,
  )
}

describe('PDP ordering-mode pills', () => {
  it('mixed + org_admin → both relabelled pills, no legacy wording', () => {
    renderPDP({ fulfilment_type: 'mixed', role: 'org_admin' })
    const group = screen.getByRole('group', { name: /order mode/i })
    expect(group).toHaveTextContent('From inventory')
    expect(group).toHaveTextContent('Reorder')
    expect(group).not.toHaveTextContent('From Stock')
    expect(group).not.toHaveTextContent('Made to Order')
  })

  it('restricted role never sees the Reorder pill', () => {
    renderPDP({ fulfilment_type: 'mixed', role: 'staff' })
    expect(
      screen.queryByRole('group', { name: /order mode/i }),
    ).not.toBeInTheDocument()
  })
})
