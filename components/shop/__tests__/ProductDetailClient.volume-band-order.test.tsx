import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { ProductDetailClient } from '../ProductDetailClient'

vi.mock('@/components/cart/useCart', () => ({ useCart: () => ({ addLine: vi.fn() }) }))
vi.mock('@/contexts/CurrencyContext', () => ({
  useCurrency: () => ({ format: (n: number) => `$${n}` }),
}))
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
  fulfilment_type: 'made_to_order' as const,
}

// Ascending as the loader always supplies it; the widget order is the knob.
const brackets = [
  { min_quantity: 24, max_quantity: 49, unit_price: 12.5 },
  { min_quantity: 50, max_quantity: 99, unit_price: 11.2 },
  { min_quantity: 100, max_quantity: null, unit_price: 10.4 },
]

function renderPDP(opts: { order?: number[]; hidden?: number[] } = {}) {
  return render(
    <ProductDetailClient
      product={baseProduct}
      variants={[{
        variant_id: 'v1', color_swatch_id: 'red', color_label: 'Red',
        color_hex: '#f00', color_position: 0, size_id: 1,
        size_label: 'S', size_order: 0,
      }]}
      sizes={[{ size_id: 1, size_label: 'S', size_order: 0 }]}
      brackets={brackets}
      availability={{ 'v1::1': { available_qty: 5, allow_order_without_stock: false } }}
      organizationId="o1"
      customerRole="org_admin"
      orderingPermission="both"
      images={[]}
      colourOptions={[]}
      decorations={[]}
      effectiveMoq={1}
      billingModeByVariant={{}}
      stockPurchasePriceByVariant={{}}
      stockUnitPrice={null}
      volumeDisplayHiddenBands={opts.hidden ?? []}
      volumeDisplayBandOrder={opts.order ?? []}
    />,
  )
}

/** The band labels ("24–49", "100+") in the order the widget renders them. */
function renderedBandLabels(): string[] {
  const heading = screen.getByText('Volume Pricing')
  const section = heading.closest('section') as HTMLElement
  return Array.from(section.querySelectorAll('li')).map(
    (li) => li.querySelector('span')?.textContent?.trim() ?? '',
  )
}

describe('PDP Volume pricing — staff-dragged band order', () => {
  it('renders ascending when no order is saved (unchanged behaviour)', () => {
    renderPDP()
    expect(renderedBandLabels()).toEqual(['24–49', '50–99', '100+'])
  })

  it('renders the bands in the staff-dragged order', () => {
    renderPDP({ order: [100, 24, 50] })
    expect(renderedBandLabels()).toEqual(['100+', '24–49', '50–99'])
  })

  it('keeps each band paired with its own price after reordering', () => {
    renderPDP({ order: [100, 24, 50] })
    const section = screen.getByText('Volume Pricing').closest('section') as HTMLElement
    const rows = Array.from(section.querySelectorAll('li')).map((li) => li.textContent)
    expect(rows[0]).toContain('100+')
    expect(rows[0]).toContain('$10.4')
    expect(rows[2]).toContain('50–99')
    expect(rows[2]).toContain('$11.2')
  })

  it('applies the order after the hide filter', () => {
    renderPDP({ order: [100, 24, 50], hidden: [24] })
    expect(renderedBandLabels()).toEqual(['100+', '50–99'])
  })

  it('puts bands absent from the order last, ascending', () => {
    renderPDP({ order: [100] })
    expect(renderedBandLabels()).toEqual(['100+', '24–49', '50–99'])
  })
})
