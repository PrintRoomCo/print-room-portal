import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { ProductDetailClient } from '../ProductDetailClient'
import type { MemberPermission } from '@/lib/shop/fulfilment-mode'

// Mock the actual hook import paths used by the component (mirrors pills.test):
//   useCart   <- '@/components/cart/useCart'
//   useCurrency <- '@/contexts/CurrencyContext'
vi.mock('@/components/cart/useCart', () => ({ useCart: () => ({ addLine: vi.fn() }) }))
vi.mock('@/contexts/CurrencyContext', () => ({
  useCurrency: () => ({ format: (n: number) => `$${n}` }),
}))
// CatalogueTopBar (rendered by the PDP) calls useRouter() from next/navigation,
// which has no router mounted under jsdom — stub it.
vi.mock('next/navigation', () => ({ useRouter: () => ({ back: vi.fn() }) }))

// sizing_type must NOT be 'one_size' so sizingMode resolves to
// 'multi_size_with_variants' (with variants.length > 0), the path where
// currentSelectionHasInventory becomes true off the per-colour size rows.
const baseProduct = {
  id: 'p1',
  name: 'Tee',
  description: null,
  image_url: null,
  moq: 1,
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

function renderPDP(opts: {
  fulfilment_type: 'stocked' | 'made_to_order' | 'mixed'
  role: 'org_admin' | 'staff'
  orderingPermission: MemberPermission
  availability?: Record<string, { available_qty: number; allow_order_without_stock: boolean }>
}) {
  return render(
    <ProductDetailClient
      product={{ ...baseProduct, fulfilment_type: opts.fulfilment_type }}
      variants={[
        {
          variant_id: 'v1',
          color_swatch_id: 'red',
          color_label: 'Red',
          color_hex: '#f00',
          color_position: 0,
          size_id: 1,
          size_label: 'S',
          size_order: 0,
        },
      ]}
      sizes={[{ size_id: 1, size_label: 'S', size_order: 0 }]}
      brackets={[{ min_quantity: 1, max_quantity: null, unit_price: 10 }]}
      availability={
        opts.availability ?? {
          'v1::1': { available_qty: 5, allow_order_without_stock: false },
        }
      }
      organizationId="o1"
      customerRole={opts.role}
      orderingPermission={opts.orderingPermission}
      images={[]}
      colourOptions={[]}
      decorations={[]}
      effectiveMoq={1}
    />,
  )
}

describe('PDP ordering permissions (dead-zone + member cap)', () => {
  // made_to_order product × stock_only member: product offers only reorder,
  // member may only draw stock → intersection empty → structural dead-zone.
  it('made_to_order × staff × stock_only → dead-zone copy, no toggle', () => {
    renderPDP({
      fulfilment_type: 'made_to_order',
      role: 'staff',
      orderingPermission: 'stock_only',
    })
    expect(
      screen.getByText(
        /unavailable to order right now\. contact the print room/i,
      ),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('group', { name: /order mode/i }),
    ).not.toBeInTheDocument()
  })

  it('made_to_order × staff × stock_only with order-without-stock rows → orderable, no dead-zone', () => {
    renderPDP({
      fulfilment_type: 'made_to_order',
      role: 'staff',
      orderingPermission: 'stock_only',
      availability: {
        'v1::1': { available_qty: 0, allow_order_without_stock: true },
      },
    })
    expect(
      screen.queryByText(
        /unavailable to order right now\. contact the print room/i,
      ),
    ).not.toBeInTheDocument()
    expect(screen.getByLabelText('Quantity for size S')).toBeInTheDocument()
    // Orderability is proven by the Qty input above; Item 6 hides the
    // Available column in purchase-order mode, so the chip no longer renders.
    expect(screen.queryByText(/Available to order/i)).not.toBeInTheDocument()
  })

  // stocked product × reorder_only member: product offers only draw, member may
  // only reorder → intersection empty → dead-zone.
  it('stocked × staff × reorder_only → dead-zone copy', () => {
    renderPDP({
      fulfilment_type: 'stocked',
      role: 'staff',
      orderingPermission: 'reorder_only',
    })
    expect(
      screen.getByText(
        /unavailable to order right now\. contact the print room/i,
      ),
    ).toBeInTheDocument()
  })

  // mixed product × both member, stock + brackets present → choice offered.
  it('mixed × staff × both → order-mode toggle present, no dead-zone', () => {
    renderPDP({
      fulfilment_type: 'mixed',
      role: 'staff',
      orderingPermission: 'both',
    })
    const group = screen.getByRole('group', { name: /order mode/i })
    expect(group).toHaveTextContent('Stock on hand')
    expect(group).toHaveTextContent('Purchase order')
    expect(
      screen.queryByText(
        /unavailable to order right now\. contact the print room/i,
      ),
    ).not.toBeInTheDocument()
  })

  // org_admin always 'both' by role (effectivePermission) — the stored
  // stock_only restriction is ignored, so the Reorder choice still shows.
  it('mixed × org_admin × stock_only (stored) → admin ignores cap → toggle present', () => {
    renderPDP({
      fulfilment_type: 'mixed',
      role: 'org_admin',
      orderingPermission: 'stock_only',
    })
    const group = screen.getByRole('group', { name: /order mode/i })
    expect(group).toHaveTextContent('Stock on hand')
    expect(group).toHaveTextContent('Purchase order')
    expect(
      screen.queryByText(
        /unavailable to order right now\. contact the print room/i,
      ),
    ).not.toBeInTheDocument()
  })
})
