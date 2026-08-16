import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
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

const baseProduct = {
  id: 'p1', name: 'Tee', description: null, image_url: null, moq: 1,
  lead_time_days: 7, sizing_type: 'multi_size_with_variants',
  decoration_methods: null, decoration_price: null, sku: null,
  safety_standard: null, specs: null, supports_labels: null,
  default_sizes: null, garment_family: null, brand_name: null,
  category_name: null, catalogueItemId: 'i1',
}

function renderPDP(fulfilment_type: 'stocked' | 'made_to_order' | 'mixed') {
  return render(
    <ProductDetailClient
      product={{ ...baseProduct, fulfilment_type }}
      variants={[{
        variant_id: 'v1', color_swatch_id: 'red', color_label: 'Red',
        color_hex: '#f00', color_position: 0, size_id: 1,
        size_label: 'S', size_order: 0,
      }]}
      sizes={[{ size_id: 1, size_label: 'S', size_order: 0 }]}
      brackets={[{ min_quantity: 1, max_quantity: null, unit_price: 10 }]}
      availability={{ 'v1::1': { available_qty: 5, allow_order_without_stock: false } }}
      organizationId="o1"
      customerRole="org_admin"
      orderingPermission="both"
      images={[]}
      colourOptions={[]}
      decorations={[]}
      effectiveMoq={1}
    />,
  )
}

describe('PDP availability visibility by ordering mode (Item 6)', () => {
  // stocked → orderingOptions = {draw:true, reorder:false} → isInventoryMode true.
  it('stock-on-hand mode shows the Available column header and stock badge', () => {
    renderPDP('stocked')
    expect(screen.getByRole('columnheader', { name: 'Available' })).toBeInTheDocument()
    expect(screen.getByText(/in stock \(5 available\)/i)).toBeInTheDocument()
  })

  // made_to_order + tracked stock + tiers → canChooseOrderIntent false (no draw
  // path), brackets.length>0 → isInventoryMode false → Purchase-order mode.
  it('purchase-order mode hides the Available column header and stock badge', () => {
    renderPDP('made_to_order')
    expect(screen.queryByRole('columnheader', { name: 'Available' })).not.toBeInTheDocument()
    expect(screen.queryByText(/in stock/i)).not.toBeInTheDocument()
  })
})
