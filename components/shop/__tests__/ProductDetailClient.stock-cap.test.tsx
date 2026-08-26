import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ProductDetailClient } from '../ProductDetailClient'

const { addLine } = vi.hoisted(() => ({ addLine: vi.fn() }))
vi.mock('@/components/cart/useCart', () => ({ useCart: () => ({ addLine }) }))
vi.mock('@/contexts/CurrencyContext', () => ({
  useCurrency: () => ({ format: (n: number) => `$${n}` }),
}))
// Supply the complete NZ country config used by this component's price display.
vi.mock('@/contexts/CompanyContext', () => ({
  useCompany: () => ({ access: null, loading: false, defaultBillingCountry: { code: 'NZ', name: 'New Zealand', currency: 'NZD', taxRate: 0.15, taxLabel: 'GST 15%', isDefault: true } }),
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
  'red-s::1': { available_qty: 4 },
  'red-s::2': { available_qty: 0 },
} as never

const SIZES = [
  { size_id: 1, size_label: 'S', size_order: 0 },
  { size_id: 2, size_label: 'M', size_order: 1 },
]

function renderPDP(
  role: 'org_admin' | 'staff' = 'org_admin',
  orderingPermission: 'stock_only' | 'reorder_only' | 'both' = 'both',
  opts: { limitToAvailableStock?: boolean } = {},
) {
  return render(
    <ProductDetailClient
      product={{
        ...baseProduct,
        fulfilment_type: 'mixed',
        limitToAvailableStock: opts.limitToAvailableStock ?? true,
      }}
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

// Stock-on-hand orders are hard-capped at available stock. There is no
// overflow-into-production from this pill: a buyer who wants more than is in
// stock is sent to the Purchase Order pill, which places a production run
// subject to the product MOQ. Nothing on the stock side ever says "to be made".
describe('PDP Stock-on-hand cap — orders never exceed available stock', () => {
  it('ordering beyond a size’s stock blocks Add-to-cart and prompts Purchase order', () => {
    renderPDP('org_admin')
    // Request 28 of S (only 4 in stock).
    fireEvent.change(screen.getByLabelText('Quantity for size S'), {
      target: { value: '28' },
    })
    expect(
      screen.getByText(/4 available\. Order the other 24 as a purchase order\?/i),
    ).toBeInTheDocument()
    // Stock-on-hand never uses production language.
    expect(screen.queryByText(/to be made/i)).not.toBeInTheDocument()
  })

  it('shows no "to be made" anywhere on the stock-on-hand side', () => {
    renderPDP('org_admin')
    fireEvent.change(screen.getByLabelText('Quantity for size S'), {
      target: { value: '5' },
    })
    expect(screen.queryByText(/to be made/i)).not.toBeInTheDocument()
  })

  it('within-stock order adds a single stocked line', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ status: 'ok', unit_price: 10 }),
      })),
    )
    renderPDP('org_admin')
    fireEvent.change(screen.getByLabelText('Quantity for size S'), {
      target: { value: '3' },
    })
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /add to cart/i })).toBeEnabled(),
    )
    fireEvent.click(screen.getByRole('button', { name: /add to cart/i }))

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

describe('PDP Purchase-order side — production run subject to MOQ', () => {
  it('the Purchase order pill surfaces "to be made" and enforces the product MOQ', () => {
    renderPDP('org_admin')
    // Switch to the Purchase order pill (production run).
    fireEvent.click(screen.getByRole('button', { name: /purchase order/i }))
    fireEvent.change(screen.getByLabelText('Quantity for size S'), {
      target: { value: '5' },
    })
    // The whole quantity is a production run — surfaced in the size grid and
    // echoed in the order summary.
    expect(screen.getAllByText(/\(5 to be made\)/i).length).toBeGreaterThanOrEqual(1)
    // MOQ 24 not met -> minimum-order guidance (Add-to-cart stays blocked).
    expect(screen.getByText(/Minimum order/i)).toBeInTheDocument()
  })
})

describe('PDP Stock-on-hand cap — restricted staff', () => {
  it('staff cannot exceed stock: shortfall message, no production language', () => {
    renderPDP('staff', 'stock_only')
    fireEvent.change(screen.getByLabelText('Quantity for size S'), {
      target: { value: '28' },
    })
    // No reorder path for this member, so the offer degrades to the plain cap.
    expect(
      screen.getByText(/4 available\. Reduce quantity to order from stock\./i),
    ).toBeInTheDocument()
    expect(screen.queryByText(/to be made/i)).not.toBeInTheDocument()
  })
})

describe('PDP Stock-on-hand cap — the over-stock remainder', () => {
  it('offers the remainder as a purchase order when the item caps at available', () => {
    renderPDP('org_admin', 'both', { limitToAvailableStock: true })
    // 4 on hand, 28 asked for.
    fireEvent.change(screen.getByLabelText('Quantity for size S'), {
      target: { value: '28' },
    })
    expect(
      screen.getByText(/4 available\. Order the other 24 as a purchase order\?/i),
    ).toBeInTheDocument()
  })

  it('accepting the offer adds the draw and the balance as two lines', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ status: 'ok', unit_price: 10 }),
      })),
    )
    renderPDP('org_admin', 'both', { limitToAvailableStock: true })
    fireEvent.change(screen.getByLabelText('Quantity for size S'), {
      target: { value: '28' },
    })
    // Settle pricing first: the Add-to-cart label flips off "Checking price..."
    // once it loads, and handleAddToCart no-ops until then.
    await screen.findByRole('button', { name: /^add to cart$/i })
    fireEvent.click(
      screen.getByRole('button', { name: /add 24 as a purchase order/i }),
    )

    // The split is per-cell: 4 drawn, 24 produced — not one global cap.
    expect(addLine).toHaveBeenCalledTimes(2)
    expect(addLine).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ variantId: 'red-s', qty: 4, fulfilmentType: 'stocked' }),
    )
    expect(addLine).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ variantId: 'red-s', qty: 24, fulfilmentType: 'made_to_order' }),
    )
  })

  it('says nothing about a remainder when the item splits on its own', () => {
    // limit off = 'mixed' = the server draws what exists and produces the rest,
    // so there is no shortfall to resolve and no second line to add.
    renderPDP('org_admin', 'both', { limitToAvailableStock: false })
    fireEvent.change(screen.getByLabelText('Quantity for size S'), {
      target: { value: '28' },
    })
    expect(screen.queryByText(/as a purchase order\?/i)).not.toBeInTheDocument()
  })
})
