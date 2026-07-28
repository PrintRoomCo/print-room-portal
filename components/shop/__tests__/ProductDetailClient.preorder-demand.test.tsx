import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { ProductDetailClient } from '../ProductDetailClient'

vi.mock('@/components/cart/useCart', () => ({ useCart: () => ({ addLine: vi.fn() }) }))
vi.mock('@/contexts/CurrencyContext', () => ({
  useCurrency: () => ({ format: (n: number) => `$${n}` }),
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ back: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
}))

const product = {
  id: 'tee', name: 'Basic Tee', description: null, image_url: null,
  moq: 1, lead_time_days: 14, sizing_type: 'multi_size',
  decoration_methods: null, decoration_price: null, sku: null, safety_standard: null,
  specs: null, supports_labels: null, garment_family: null, default_sizes: null,
  brand_name: null, category_name: null, catalogueItemId: 'i-tee',
  fulfilment_type: 'made_to_order' as const,
}
const variants = [{
  variant_id: 'tee-navy', color_swatch_id: 'navy', color_label: 'Navy', color_hex: '#003',
  color_position: 0, size_id: null, size_label: null, size_order: 0,
}]

function renderPdp(preOrderDemand: { unitsOrdered: number; orderCount: number } | null) {
  return render(
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
      preOrderDemand={preOrderDemand}
    />,
  )
}

describe('PDP — pre-order demand counts', () => {
  it('shows units + orders when demand is provided', () => {
    renderPdp({ unitsOrdered: 124, orderCount: 38 })
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
})
