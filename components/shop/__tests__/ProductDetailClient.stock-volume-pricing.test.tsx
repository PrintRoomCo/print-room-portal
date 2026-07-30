import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { ProductDetailClient } from '../ProductDetailClient'

vi.mock('@/components/cart/useCart', () => ({ useCart: () => ({ addLine: vi.fn() }) }))
vi.mock('@/contexts/CurrencyContext', () => ({
  useCurrency: () => ({ format: (n: number) => `$${n}` }),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ back: vi.fn() }) }))

const baseProduct = {
  id: 'p1', name: 'Tee', description: null, image_url: null, moq: 1,
  lead_time_days: 7, sizing_type: 'multi_size_with_variants',
  decoration_methods: null, decoration_price: null, sku: null,
  safety_standard: null, specs: null, supports_labels: null,
  default_sizes: null, garment_family: null, brand_name: null,
  category_name: null, catalogueItemId: 'i1',
}

// Three-band ladder; format mock renders unit_price as `$<n>`.
const brackets = [
  { min_quantity: 24, max_quantity: 49, unit_price: 12.5 },
  { min_quantity: 50, max_quantity: 99, unit_price: 11.2 },
  { min_quantity: 100, max_quantity: null, unit_price: 10.4 },
]

// One variant, selected by default. billingMode, explicit stock price, prepaid
// original-purchase price and hidden bands are the only knobs the tests vary.
function renderPDP(opts: {
  fulfilment_type: 'stocked' | 'made_to_order'
  billingMode?: 'invoice_on_dispatch' | 'prepaid'
  stockPrice?: number
  stockUnitPrice?: number | null
  hiddenBands?: number[]
}) {
  return render(
    <ProductDetailClient
      product={{ ...baseProduct, fulfilment_type: opts.fulfilment_type }}
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
      billingModeByVariant={opts.billingMode ? { v1: opts.billingMode } : {}}
      stockPurchasePriceByVariant={opts.stockPrice != null ? { v1: opts.stockPrice } : {}}
      stockUnitPrice={opts.stockUnitPrice ?? null}
      volumeDisplayHiddenBands={opts.hiddenBands ?? []}
    />,
  )
}

describe('PDP pricing on stock-on-hand (volume ladder never shown for stock)', () => {
  it('invoice-on-dispatch stock with NO explicit price shows no volume ladder', () => {
    renderPDP({ fulfilment_type: 'stocked', billingMode: 'invoice_on_dispatch' })
    expect(screen.queryByText('Volume Pricing')).not.toBeInTheDocument()
    expect(screen.queryByTestId('stock-unit-price')).not.toBeInTheDocument()
  })

  it('an explicit stock price shows ONE price (no ladder) for a pay-at-checkout colour', () => {
    renderPDP({ fulfilment_type: 'stocked', billingMode: 'invoice_on_dispatch', stockUnitPrice: 15 })
    expect(screen.queryByText('Volume Pricing')).not.toBeInTheDocument()
    const panel = screen.getByTestId('stock-unit-price')
    expect(panel).toHaveTextContent('$15')
    expect(panel).toHaveTextContent(/per unit/)
  })

  it('an explicit stock price shows for a prepaid colour too and supersedes the original-purchase panel', () => {
    renderPDP({
      fulfilment_type: 'stocked', billingMode: 'prepaid', stockPrice: 9.8, stockUnitPrice: 15,
    })
    expect(screen.getByTestId('stock-unit-price')).toHaveTextContent('$15')
    expect(screen.queryByText('Volume Pricing')).not.toBeInTheDocument()
    expect(screen.queryByText('Prepaid Stock')).not.toBeInTheDocument()
    expect(screen.queryByText(/original purchase price/i)).not.toBeInTheDocument()
  })

  it('prepaid stock with no explicit price still shows the original-purchase panel, not the ladder', () => {
    renderPDP({ fulfilment_type: 'stocked', billingMode: 'prepaid', stockPrice: 9.8 })
    expect(screen.getByText('Prepaid Stock')).toBeInTheDocument()
    expect(screen.getByText(/original purchase price/i)).toBeInTheDocument()
    expect(screen.queryByText('Volume Pricing')).not.toBeInTheDocument()
  })

  it('purchase-order (made_to_order) mode still shows the ladder (unchanged)', () => {
    renderPDP({ fulfilment_type: 'made_to_order' })
    expect(screen.getByText('Volume Pricing')).toBeInTheDocument()
    expect(screen.getByText(/@ \$12.5$/)).toBeInTheDocument()
    expect(screen.getByText(/@ \$10.4$/)).toBeInTheDocument()
  })

  it('purchase-order mode respects hidden display bands', () => {
    renderPDP({ fulfilment_type: 'made_to_order', hiddenBands: [50] })
    expect(screen.getByText('Volume Pricing')).toBeInTheDocument()
    expect(screen.queryByText(/@ \$11.2$/)).not.toBeInTheDocument() // 50-band hidden
    expect(screen.getByText(/@ \$12.5$/)).toBeInTheDocument()
  })
})

// Chris 2026-07-30: unlabelled ladder prices were read as GST-inclusive and
// reconciled against ×1.15. Every PDP price surface must say excl. GST.
describe('PDP price surfaces are labelled excl. GST', () => {
  it('volume ladder carries an excl. GST note', () => {
    renderPDP({ fulfilment_type: 'made_to_order' })
    expect(screen.getByText('Volume Pricing')).toBeInTheDocument()
    expect(screen.getByText(/excl\. GST/i)).toBeInTheDocument()
  })

  it('explicit stock price panel says excl. GST', () => {
    renderPDP({ fulfilment_type: 'stocked', billingMode: 'invoice_on_dispatch', stockUnitPrice: 15 })
    expect(screen.getByTestId('stock-unit-price')).toHaveTextContent(/excl\. GST/i)
  })

  it('explicit stock price panel keeps the pre-paid suffix alongside excl. GST', () => {
    renderPDP({
      fulfilment_type: 'stocked', billingMode: 'prepaid', stockPrice: 9.8, stockUnitPrice: 15,
    })
    const panel = screen.getByTestId('stock-unit-price')
    expect(panel).toHaveTextContent(/excl\. GST/i)
    expect(panel).toHaveTextContent(/pre-paid/i)
  })

  it('prepaid original-purchase panel says excl. GST', () => {
    renderPDP({ fulfilment_type: 'stocked', billingMode: 'prepaid', stockPrice: 9.8 })
    expect(screen.getByText('Prepaid Stock')).toBeInTheDocument()
    expect(screen.getByText(/excl\. GST.*original purchase price/i)).toBeInTheDocument()
  })
})
