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
vi.mock('next/navigation', () => ({
  useRouter: () => ({ back: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
}))

const product = {
  id: 'duffel', name: 'Recycled Weekender Duffel', description: null, image_url: null,
  moq: 48, lead_time_days: 14, sizing_type: 'one_size',
  decoration_methods: null, decoration_price: null, sku: null, safety_standard: null,
  specs: null, supports_labels: null, garment_family: null, default_sizes: null,
  brand_name: null, category_name: null, catalogueItemId: 'duffel-item',
  // The PDP normalises the pre_order nature onto its made-to-order control path;
  // preOrderDemand is the explicit surface gate exercised by this test.
  fulfilment_type: 'made_to_order' as const,
}
const variants = [{
  variant_id: 'duffel-black', color_swatch_id: 'black', color_label: 'Black', color_hex: '#000',
  color_position: 0, size_id: null, size_label: null, size_order: 0,
}]

function renderPdp(
  preOrderDemand: {
    unitsOrdered: number
    orderCount: number
    closesAt: string
  } | null,
) {
  return render(
    <ProductDetailClient
      product={product}
      variants={variants as never}
      sizes={[{ size_id: 1, size_label: 'One Size', size_order: 0 }]}
      brackets={[
        { min_quantity: 1, max_quantity: 23, unit_price: 32.12 },
        { min_quantity: 24, max_quantity: 49, unit_price: 32.12 },
        { min_quantity: 50, max_quantity: 99, unit_price: 32.12 },
        { min_quantity: 100, max_quantity: 249, unit_price: 30.14 },
        { min_quantity: 250, max_quantity: null, unit_price: 19.15 },
      ]}
      availability={{} as never}
      organizationId="o1"
      customerRole="org_admin"
      orderingPermission="both"
      images={[]}
      colourOptions={[{ id: 'black', label: 'Black', hex: '#000', imageUrl: null } as never]}
      decorations={[]}
      effectiveMoq={48}
      preOrderDemand={preOrderDemand}
    />,
  )
}

describe('PDP — pre-order demand counts', () => {
  it('shows units + orders when demand is provided', () => {
    renderPdp({
      unitsOrdered: 124,
      orderCount: 38,
      closesAt: '2026-08-21T12:00:00.000Z',
    })
    const block = screen.getByRole('status', { name: /pre-order demand so far/i })
    expect(block).toHaveTextContent(/124/)
    expect(block).toHaveTextContent(/38/)
    expect(block).toHaveTextContent(/orders/i)
  })

  it('renders nothing when demand is null', () => {
    renderPdp(null)
    expect(
      screen.queryByRole('status', { name: /pre-order demand so far/i }),
    ).not.toBeInTheDocument()
  })

  it('names the product and shows this franchise total saving', () => {
    renderPdp({
      unitsOrdered: 0,
      orderCount: 0,
      closesAt: '2026-08-21T12:00:00.000Z',
    })
    const block = screen.getByRole('status', { name: /pre-order demand so far/i })
    expect(block).toHaveTextContent('52 more units of Recycled Weekender Duffel')
    expect(block).toHaveTextContent('$30.14 per unit')
    expect(block).toHaveTextContent('$95.04')
    expect(block).toHaveTextContent('$1.98 per unit')
    expect(block).not.toHaveTextContent('$0.00')
    const heading = screen.getByRole('heading', {
      name: 'Recycled Weekender Duffel',
    })
    expect(heading.parentElement).not.toHaveTextContent('Order Quantity Savings')
  })
})
