import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ProductDetailClient } from '../ProductDetailClient'

const { addLine } = vi.hoisted(() => ({ addLine: vi.fn() }))
vi.mock('@/components/cart/useCart', () => ({ useCart: () => ({ addLine }) }))
vi.mock('@/contexts/CurrencyContext', () => ({
  useCurrency: () => ({ format: (n: number) => `$${n}` }),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ back: vi.fn() }) }))

const product = {
  id: 'tote1',
  name: 'Tote',
  description: null,
  image_url: null,
  moq: 24,
  lead_time_days: 7,
  sizing_type: 'one_size',
  fulfilment_type: 'mixed' as const,
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

// Single one-size variant with 4 in stock.
const variants = [
  {
    variant_id: 'os',
    color_swatch_id: 'natural',
    color_label: 'Natural',
    color_hex: '#eee',
    color_position: 0,
    size_id: 1,
    size_label: 'OS',
    size_order: 0,
  },
]
// SKUCOLLAPSE: one_size colourway → stock keyed `${variantId}::` (size_id null).
const availability = {
  'os::': { available_qty: 4, allow_order_without_stock: false },
} as never

function renderPDP() {
  return render(
    <ProductDetailClient
      product={product}
      variants={variants}
      sizes={[]}
      brackets={[{ min_quantity: 1, max_quantity: null, unit_price: 10 }]}
      availability={availability}
      organizationId="o1"
      customerRole="org_admin"
      orderingPermission="both"
      images={[]}
      colourOptions={[]}
      decorations={[]}
      effectiveMoq={24}
    />,
  )
}

beforeEach(() => {
  addLine.mockClear()
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      json: async () => ({ status: 'ok', unit_price: 10 }),
    })),
  )
})

describe('PDP From-inventory production top-up — cart split (one_size)', () => {
  it('overflowing one_size order adds a stocked line + a made_to_order line', async () => {
    renderPDP()
    // 28 ordered, 4 in stock -> 4 stocked + 24 made (meets MOQ 24).
    fireEvent.change(screen.getByLabelText('Quantity'), {
      target: { value: '28' },
    })
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /add to cart/i })).toBeEnabled(),
    )
    const btn = screen.getByRole('button', { name: /add to cart/i })
    fireEvent.click(btn)

    expect(addLine).toHaveBeenCalledTimes(2)
    expect(addLine).toHaveBeenCalledWith(
      expect.objectContaining({ qty: 4, fulfilmentType: 'stocked' }),
    )
    expect(addLine).toHaveBeenCalledWith(
      expect.objectContaining({ qty: 24, fulfilmentType: 'made_to_order' }),
    )
  })
})
