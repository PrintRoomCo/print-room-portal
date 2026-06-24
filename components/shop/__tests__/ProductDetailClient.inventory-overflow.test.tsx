import { render, screen, fireEvent, waitFor } from '@testing-library/react'
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
// SKUCOLLAPSE: availability keyed `${colourwayVariantId}::${sizeId}` → 'red-s'.
const availability = {
  'red-s::1': { available_qty: 4, allow_order_without_stock: false },
  'red-s::2': { available_qty: 0, allow_order_without_stock: false },
} as never

const SIZES = [
  { size_id: 1, size_label: 'S', size_order: 0 },
  { size_id: 2, size_label: 'M', size_order: 1 },
]

function renderPDP(
  role: 'org_admin' | 'staff' = 'org_admin',
  orderingPermission: 'stock_only' | 'reorder_only' | 'both' = 'both',
) {
  return render(
    <ProductDetailClient
      product={{ ...baseProduct, fulfilment_type: 'mixed' }}
      variants={variants}
      sizes={SIZES}
      brackets={[{ min_quantity: 1, max_quantity: null, unit_price: 10 }]}
      availability={availability}
      organizationId="o1"
      customerRole={role}
      orderingPermission={orderingPermission}
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

describe('PDP From-inventory production top-up — cart split (multi-size)', () => {
  beforeEach(() => {
    // Pricing is fetched (debounced) before Add-to-cart enables. Stub it OK.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ status: 'ok', unit_price: 10 }),
      })),
    )
  })

  it('overflowing variant adds a stocked line + a make_to_stock line', async () => {
    renderPDP('org_admin')
    // 28 of S, 4 in stock -> 4 stocked + 24 made (meets MOQ 24).
    fireEvent.change(screen.getByLabelText('Quantity for size S'), {
      target: { value: '28' },
    })
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /add to cart/i })).toBeEnabled(),
    )
    const btn = screen.getByRole('button', { name: /add to cart/i })
    fireEvent.click(btn)

    expect(addLine).toHaveBeenCalledTimes(2)
    expect(addLine).toHaveBeenCalledWith(
      expect.objectContaining({
        variantId: 'red-s',
        qty: 4,
        fulfilmentType: 'stocked',
      }),
    )
    expect(addLine).toHaveBeenCalledWith(
      expect.objectContaining({
        variantId: 'red-s',
        qty: 24,
        fulfilmentType: 'make_to_stock',
      }),
    )
  })

  it('within-stock variant adds a single stocked line', async () => {
    renderPDP('org_admin')
    fireEvent.change(screen.getByLabelText('Quantity for size S'), {
      target: { value: '3' },
    })
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /add to cart/i })).toBeEnabled(),
    )
    const btn = screen.getByRole('button', { name: /add to cart/i })
    fireEvent.click(btn)

    expect(addLine).toHaveBeenCalledTimes(1)
    expect(addLine).toHaveBeenCalledWith(
      expect.objectContaining({
        variantId: 'red-s',
        qty: 3,
        fulfilmentType: 'stocked',
      }),
    )
  })
})

describe('PDP From-inventory production top-up — size grid caption', () => {
  it('shows per-size "to be made" once a size overflows its stock', () => {
    renderPDP('org_admin')
    fireEvent.change(screen.getByLabelText('Quantity for size S'), {
      target: { value: '28' },
    })
    // S row Available cell now annotates the 24-unit production portion.
    expect(screen.getByText(/\(24 to be made\)/i)).toBeInTheDocument()
  })
})

describe('PDP From-inventory production top-up — restricted staff unchanged', () => {
  it('staff cannot overflow: no production hint, Add-to-cart stays blocked', () => {
    // Restricted (stock_only) staff: member cap removes the reorder path, so
    // the overflow-into-production scope never activates.
    renderPDP('staff', 'stock_only')
    // Staff are inventory-only; the in-stock-only filter keeps S visible.
    fireEvent.change(screen.getByLabelText('Quantity for size S'), {
      target: { value: '28' },
    })
    // No production top-up surfaces for restricted staff...
    expect(screen.queryByText(/to be made · production min/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/Production run minimum is/i)).not.toBeInTheDocument()
    // ...and the existing hard-cap shortfall message still fires.
    expect(screen.getByText(/Only 4 available/i)).toBeInTheDocument()
  })
})
