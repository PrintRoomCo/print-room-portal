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
  name: 'Acrylic Cap',
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
]

const SIZES = [{ size_id: 1, size_label: 'S', size_order: 0 }]

function renderPDP(
  role: 'org_admin' | 'staff' = 'org_admin',
  orderingPermission: 'stock_only' | 'reorder_only' | 'both' = 'both',
  opts: {
    fulfilmentType?: 'stocked' | 'made_to_order' | 'mixed'
    availability?: Record<string, { available_qty: number }>
  } = {},
) {
  return render(
    <ProductDetailClient
      product={{ ...baseProduct, fulfilment_type: opts.fulfilmentType ?? 'made_to_order' }}
      variants={variants}
      sizes={SIZES}
      brackets={[{ min_quantity: 1, max_quantity: null, unit_price: 10 }]}
      availability={(opts.availability ?? {}) as never} // default: NO inventory rows anywhere
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

beforeEach(() => {
  addLine.mockClear()
  // Pricing is fetched (debounced) before Add-to-cart enables. Stub it OK.
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      json: async () => ({ status: 'ok', unit_price: 10 }),
    })),
  )
})

describe('one_size colour product — variant identity on the cart line', () => {
  // A product with colourway variants but NO `sizes` rows resolves to `one_size`
  // (resolveSizingMode). The line MUST carry the selected colourway variant_id —
  // resolveSizingMode's own contract is "ordered straight off the colourway
  // variant". Dropping it (variantId: '') sent variant_id: null to checkout,
  // where submit_b2b_order raised NO_INVENTORY ("stocked product line missing
  // variant_id") for a stock_only member and lost the per-variant billing_mode
  // (prepaid → full price). The Staple Tee escaped only because it is multi_size.
  it('carries the SELECTED colourway variant_id onto the cart line, not empty', async () => {
    render(
      <ProductDetailClient
        product={{ ...baseProduct, fulfilment_type: 'stocked' }}
        variants={[
          {
            variant_id: 'white',
            color_swatch_id: 'w',
            color_label: 'White',
            color_hex: '#fff',
            color_position: 0,
            size_id: null,
            size_label: null,
            size_order: 0,
          },
          {
            variant_id: 'black',
            color_swatch_id: 'b',
            color_label: 'Black',
            color_hex: '#000',
            color_position: 1,
            size_id: null,
            size_label: null,
            size_order: 0,
          },
        ]}
        sizes={[]} // no sizes → one_size mode
        brackets={[{ min_quantity: 1, max_quantity: null, unit_price: 10 }]}
        availability={{ 'white::': { available_qty: 250 } } as never}
        organizationId="o1"
        customerRole="org_admin"
        orderingPermission="both"
        images={[]}
        colourOptions={[]}
        decorations={[]}
        effectiveMoq={1}
      />,
    )
    fireEvent.change(await screen.findByLabelText('Quantity'), { target: { value: '5' } })
    const button = await screen.findByRole('button', { name: /add to cart/i })
    await waitFor(() => expect(button).toBeEnabled())
    fireEvent.click(button)

    expect(addLine).toHaveBeenCalledTimes(1)
    expect(addLine).toHaveBeenCalledWith(
      expect.objectContaining({ variantId: 'white', qty: 5 }),
    )
  })
})

describe('PDP fulfilment fallback — untracked made_to_order product', () => {
  it('org_admin add tags the line made_to_order, NOT stocked (regression: TEST-000080)', async () => {
    renderPDP('org_admin', 'both')
    fireEvent.change(screen.getByLabelText('Quantity for size S'), {
      target: { value: '24' }, // meets MOQ 24 (activeMoq applies: not inventory mode)
    })
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /add to cart/i })).toBeEnabled(),
    )
    fireEvent.click(screen.getByRole('button', { name: /add to cart/i }))

    expect(addLine).toHaveBeenCalledTimes(1)
    expect(addLine).toHaveBeenCalledWith(
      expect.objectContaining({
        variantId: 'red-s',
        qty: 24,
        fulfilmentType: 'made_to_order',
      }),
    )
  })

  it('stock_only member CANNOT add beyond available stock (server would PERMISSION_DENIED)', async () => {
    // Mixed product, 4 on hand, 5 requested. The line resolves to made_to_order
    // (over stock), which submit_b2b_order refuses for a stock_only member
    // (member_cannot_produce) — so the PDP must not let it into the cart.
    //
    // This used to be expressed with a zero-stock backorderable cell. That flag
    // is retired, and a zero-stock row no longer renders in inventory mode at
    // all, so the over-stock case is what still carries the rule.
    renderPDP('staff', 'stock_only', {
      fulfilmentType: 'mixed',
      availability: { 'red-s::1': { available_qty: 4 } },
    })
    fireEvent.change(screen.getByLabelText('Quantity for size S'), { target: { value: '5' } })

    // Settle: the button label flips off "Checking price..." once pricing loads,
    // regardless of whether it ends up enabled or disabled.
    const button = await screen.findByRole('button', { name: /add to cart/i })
    expect(button).toBeDisabled()

    fireEvent.click(button)
    expect(addLine).not.toHaveBeenCalled()
  })

  it('reorder_only staff add also tags made_to_order', async () => {
    renderPDP('staff', 'reorder_only')
    fireEvent.change(screen.getByLabelText('Quantity for size S'), {
      target: { value: '24' },
    })
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /add to cart/i })).toBeEnabled(),
    )
    fireEvent.click(screen.getByRole('button', { name: /add to cart/i }))

    expect(addLine).toHaveBeenCalledTimes(1)
    expect(addLine).toHaveBeenCalledWith(
      expect.objectContaining({ fulfilmentType: 'made_to_order' }),
    )
  })
})
