import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { ProductDetailClient } from '../ProductDetailClient'

// Same mock surface as the sibling ProductDetailClient tests.
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

function renderPdp(locationOptions: Array<{ value: string; label: string }>) {
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
      locationOptions={locationOptions}
    />,
  )
}

describe('PDP — required location dropdown (feature 1)', () => {
  it('renders the required dropdown, gates add-to-cart, and clears the gate on selection', () => {
    renderPdp([
      { value: 'v1', label: 'MTF Avalon' },
      { value: 'v2', label: 'MTF Newmarket' },
    ])

    // The required dropdown renders with its options.
    const select = screen.getByLabelText(/Location/i) as HTMLSelectElement
    expect(select).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'MTF Avalon' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'MTF Newmarket' })).toBeInTheDocument()

    // Unselected → the required banner is shown and Add-to-cart is disabled
    // (disabled regardless of pricing, since meetsLocation is false).
    expect(screen.getByText(/Choose a location to add this item/i)).toBeInTheDocument()
    const addBtn = screen.getByRole('button', { name: /Add to cart|Checking price|Ordering opens/i })
    expect(addBtn).toBeDisabled()

    // Picking a location clears the gate banner (meetsLocation flips true).
    fireEvent.change(select, { target: { value: 'v1' } })
    expect(select.value).toBe('v1')
    expect(screen.queryByText(/Choose a location to add this item/i)).not.toBeInTheDocument()
  })

  it('renders no location dropdown when the product has no dataset', () => {
    renderPdp([])
    expect(screen.queryByLabelText(/Location/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/Choose a location to add this item/i)).not.toBeInTheDocument()
  })
})
