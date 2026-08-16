import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { ProductDetailClient } from '../ProductDetailClient'

// Same mock surface as ProductDetailClient.inventory-sizes.test.tsx.
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

const product = {
  id: 'pen', name: 'Panama Stylus Pen', description: null, image_url: null,
  moq: 1, lead_time_days: 14, sizing_type: 'multi_size',
  decoration_methods: null, decoration_price: null, sku: null, safety_standard: null,
  specs: null, supports_labels: null, garment_family: null, default_sizes: null,
  brand_name: null, category_name: null, catalogueItemId: 'i-pen',
  fulfilment_type: 'made_to_order' as const,
}
// One sizeless colourway variant — the exact shape that was un-orderable.
const variants = [{
  variant_id: 'pen-navy', color_swatch_id: 'navy', color_label: 'Navy', color_hex: '#003',
  color_position: 0, size_id: null, size_label: null, size_order: 0,
}]

describe('PDP — multi_size product with variants but NO sizes', () => {
  it('renders the one-size quantity input (orderable) instead of an empty grid', () => {
    render(
      <ProductDetailClient
        product={product}
        variants={variants as never}
        sizes={[]}
        brackets={[{ min_quantity: 1, max_quantity: null, unit_price: 2.34 }]}
        availability={{} as never}
        organizationId="o1"
        customerRole="org_admin"
        orderingPermission="both"
        images={[]}
        colourOptions={[{ id: 'navy', label: 'Navy', hex: '#003', imageUrl: null } as never]}
        decorations={[]}
        effectiveMoq={1}
      />,
    )
    // one_size path renders a single "Quantity" input (id="qty")…
    expect(screen.getByLabelText('Quantity')).toBeInTheDocument()
    // …and NOT the (empty, un-orderable) multi-size grid, whose header is "Size".
    // (Don't assert the Add-to-cart label — it reads "Checking price…" while
    //  pricing loads, which is orthogonal to the sizing path under test.)
    expect(screen.queryByRole('columnheader', { name: 'Size' })).not.toBeInTheDocument()
  })
})
