import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ProductDetailClient } from '../ProductDetailClient'

const { addLine } = vi.hoisted(() => ({ addLine: vi.fn() }))
vi.mock('@/components/cart/useCart', () => ({ useCart: () => ({ addLine }) }))
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
  'os::': { available_qty: 4 },
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

describe('PDP Stock-on-hand cap — one_size', () => {
  it('ordering beyond stock blocks Add-to-cart with a shortfall prompt', () => {
    renderPDP()
    // 28 ordered, only 4 in stock.
    fireEvent.change(screen.getByLabelText('Quantity'), {
      target: { value: '28' },
    })
    expect(
      screen.getByText(/Only 4 available for selected variant/i),
    ).toBeInTheDocument()
    expect(screen.queryByText(/to be made/i)).not.toBeInTheDocument()
  })

  it('within-stock order adds a single stocked line', async () => {
    renderPDP()
    fireEvent.change(screen.getByLabelText('Quantity'), {
      target: { value: '3' },
    })
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /add to cart/i })).toBeEnabled(),
    )
    fireEvent.click(screen.getByRole('button', { name: /add to cart/i }))

    expect(addLine).toHaveBeenCalledTimes(1)
    expect(addLine).toHaveBeenCalledWith(
      expect.objectContaining({ qty: 3, fulfilmentType: 'stocked' }),
    )
  })
})
