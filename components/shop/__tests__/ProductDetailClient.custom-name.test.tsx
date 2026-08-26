import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { ProductDetailClient } from '../ProductDetailClient'

vi.mock('@/components/cart/useCart', () => ({ useCart: () => ({ addLine: vi.fn() }) }))
vi.mock('@/contexts/CurrencyContext', () => ({
  useCurrency: () => ({ format: (n: number) => `$${n}` }),
}))
// Supply the complete NZ country config used by this component's price display.
vi.mock('@/contexts/CompanyContext', () => ({
  useCompany: () => ({ access: null, loading: false, defaultBillingCountry: { code: 'NZ', name: 'New Zealand', currency: 'NZD', taxRate: 0.15, taxLabel: 'GST 15%', isDefault: true } }),
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

function renderPdp(customNameMaxLength: number | null) {
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
      customNameMaxLength={customNameMaxLength}
    />,
  )
}

describe('PDP — optional custom name (feature 2)', () => {
  it('renders a maxlength-capped input when the product allows it', () => {
    renderPdp(12)
    const input = screen.getByLabelText(/Custom name/i) as HTMLInputElement
    expect(input).toBeInTheDocument()
    expect(input.maxLength).toBe(12)
  })

  it('does NOT render the input when custom name is off (null)', () => {
    renderPdp(null)
    expect(screen.queryByLabelText(/Custom name/i)).not.toBeInTheDocument()
  })

  it('does not gate add-to-cart: the input is optional (no required marker, no gate banner)', () => {
    // Unlike feature 1's required location dropdown, a blank custom name must
    // never block add-to-cart. This fixture enters no qty, so the button is
    // disabled by the qty gate regardless — asserting "enabled" would test the
    // fixture, not the feature. Instead assert the field is genuinely optional:
    // no `required` attribute, an "(optional)" hint, and none of the
    // location-style "you must choose …" gate banner.
    renderPdp(12)
    const input = screen.getByLabelText(/Custom name/i) as HTMLInputElement
    expect(input.required).toBe(false)
    expect(screen.getByText(/optional/i)).toBeInTheDocument()
    expect(screen.queryByText(/to add this item to your cart/i)).not.toBeInTheDocument()
  })
})
