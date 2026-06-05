import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ProductDetailClient } from '../ProductDetailClient'

const { addLine } = vi.hoisted(() => ({ addLine: vi.fn() }))
vi.mock('@/components/cart/useCart', () => ({ useCart: () => ({ addLine }) }))
vi.mock('@/contexts/CurrencyContext', () => ({
  useCurrency: () => ({ format: (n: number) => `$${n}` }),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ back: vi.fn() }) }))

const baseProduct = {
  id: 'p1',
  name: 'Tee',
  description: null,
  image_url: null,
  moq: 24,
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

// Red S has 4 in stock; Red M is out of stock (hidden in inventory mode).
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

function renderPDP(role: 'org_admin' | 'staff' = 'org_admin') {
  return render(
    <ProductDetailClient
      product={{ ...baseProduct, fulfilment_type: 'mixed' }}
      variants={variants}
      brackets={[{ min_quantity: 1, max_quantity: null, unit_price: 10 }]}
      availability={availability}
      organizationId="o1"
      customerRole={role}
      images={[]}
      colourOptions={[]}
      decorations={[]}
      effectiveMoq={24}
    />,
  )
}

beforeEach(() => addLine.mockClear())

describe('PDP From-inventory production top-up — MOQ guard', () => {
  it('overflow below MOQ shows the production-minimum block message', () => {
    renderPDP('org_admin')
    // Request 5 of S (4 in stock) -> 1 to be made, below MOQ 24.
    fireEvent.change(screen.getByLabelText('Quantity for size S'), {
      target: { value: '5' },
    })
    expect(
      screen.getByText(/Production run minimum is 24/i),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/Production run minimum is 24\.\s+1 to be made.*add\s+23 more/i),
    ).toBeInTheDocument()
  })

  it('overflow at/above MOQ shows the neutral hint, not the block', () => {
    renderPDP('org_admin')
    // Request 28 of S (4 in stock) -> 24 to be made, meets MOQ 24.
    fireEvent.change(screen.getByLabelText('Quantity for size S'), {
      target: { value: '28' },
    })
    expect(screen.queryByText(/Production run minimum is/i)).not.toBeInTheDocument()
    expect(screen.getByText(/24 to be made · production min 24/i)).toBeInTheDocument()
  })

  it('pure stock draw (within stock) shows no overflow messaging', () => {
    renderPDP('org_admin')
    fireEvent.change(screen.getByLabelText('Quantity for size S'), {
      target: { value: '3' },
    })
    expect(screen.queryByText(/Production run minimum is/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/to be made · production min/i)).not.toBeInTheDocument()
  })
})
