import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { ProductDetailClient } from '../ProductDetailClient'

// Mock the actual hook import paths used by the component:
//   useCart   <- '@/components/cart/useCart'
//   useCurrency <- '@/contexts/CurrencyContext'
vi.mock('@/components/cart/useCart', () => ({ useCart: () => ({ addLine: vi.fn() }) }))
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
// CatalogueTopBar (rendered by the PDP) calls useRouter() from next/navigation,
// which has no router mounted under jsdom — stub it.
vi.mock('next/navigation', () => ({ useRouter: () => ({ back: vi.fn() }) }))

// sizing_type must NOT be 'one_size' so sizingMode resolves to
// 'multi_size_with_variants' (with variants.length > 0), which is the only
// path where currentSelectionHasInventory becomes true off the per-colour
// size rows — the gate that mounts the order-mode toggle.
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
  orderingPermission?: 'stock_only' | 'reorder_only' | 'both'
  brackets?: Array<{ min_quantity: number; max_quantity: number | null; unit_price: number }>
  availability?: Record<string, { available_qty: number }>
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
      brackets={opts.brackets ?? [{ min_quantity: 1, max_quantity: null, unit_price: 10 }]}
      availability={opts.availability ?? { 'v1::1': { available_qty: 5 } }}
      organizationId="o1"
      customerRole={opts.role}
      orderingPermission={opts.orderingPermission ?? 'both'}
      images={[]}
      colourOptions={[]}
      decorations={[]}
      effectiveMoq={1}
    />,
  )
}

describe('PDP ordering-mode pills', () => {
  it('mixed + org_admin → both relabelled pills, no legacy wording', () => {
    renderPDP({ fulfilment_type: 'mixed', role: 'org_admin' })
    const group = screen.getByRole('group', { name: /order mode/i })
    expect(group).toHaveTextContent('Stock on hand')
    expect(group).toHaveTextContent('Purchase order')
    expect(group).not.toHaveTextContent('From Stock')
    expect(group).not.toHaveTextContent('Made to Order')
  })

  // A stock_only-restricted staff member has no reorder path (member cap), so
  // the From-inventory/Reorder choice never mounts — they are inventory-only.
  it('restricted (stock_only) member never sees the Reorder pill', () => {
    renderPDP({
      fulfilment_type: 'mixed',
      role: 'staff',
      orderingPermission: 'stock_only',
    })
    expect(
      screen.queryByRole('group', { name: /order mode/i }),
    ).not.toBeInTheDocument()
  })

  // Shared resolver (D1, 2026-06-18): orderingOptions('made_to_order', …) yields
  // canDrawStock=false (a made_to_order product has no stock-draw path by
  // nature), so there is nothing to toggle between — it is reorder-only and the
  // From-inventory/Reorder choice does not mount. This supersedes the
  // 2026-06-03 stock+tiers gate, which keyed on fulfilment_type !== 'stocked'
  // rather than the product's actual draw capability.
  it('made_to_order + org_admin → reorder-only, NO toggle', () => {
    renderPDP({ fulfilment_type: 'made_to_order', role: 'org_admin' })
    expect(
      screen.queryByRole('group', { name: /order mode/i }),
    ).not.toBeInTheDocument()
  })

  // Defect (2026-06-03, Symptom 1+2): a 'stocked' product with stock + tiers
  // rendered the order-mode toggle for an org_admin, but isInventoryMode is
  // hard-forced true for stocked, so clicking Reorder did nothing — an inert
  // pill that never revealed the bulk-order sizes. Spec (pillsFor) says
  // stocked = inventory-only, NO toggle. The toggle must not mount at all.
  it('stocked + org_admin with stock + tiers → NO toggle (inventory-only)', () => {
    renderPDP({ fulfilment_type: 'stocked', role: 'org_admin' })
    expect(
      screen.queryByRole('group', { name: /order mode/i }),
    ).not.toBeInTheDocument()
  })

  it('keeps the Stock on hand pill when there are no volume tiers, and says why', () => {
    // Previously the whole toggle vanished and the item silently became
    // inventory-only with no explanation (regression class, 2026-06-03).
    const { container } = renderPDP({
      fulfilment_type: 'mixed', role: 'org_admin', brackets: [],
    })
    const text = container.textContent ?? ''
    expect(text).toContain('Stock on hand')
    expect(text).toContain('Purchase order')
    expect(text).toContain('No volume pricing set for this product')
  })

  it('keeps the Purchase order pill when the selection has no stock, and says why', () => {
    const { container } = renderPDP({
      fulfilment_type: 'mixed', role: 'org_admin', availability: {},
    })
    const text = container.textContent ?? ''
    expect(text).toContain('Purchase order')
    expect(text).toContain('No stock on hand for this selection')
  })

  it('never shows Purchase order to a stock_only member', () => {
    const { container } = renderPDP({
      fulfilment_type: 'mixed', role: 'staff', orderingPermission: 'stock_only',
    })
    // Only one route is open to this viewer, so no toggle renders at all — and
    // certainly no pill for a route submit_b2b_order would refuse
    // (member_cannot_produce). Do NOT also assert the other label is present:
    // with a single open route there is no toggle to carry it.
    expect(container.textContent ?? '').not.toContain('Purchase order')
  })

  it('never shows Stock on hand to a reorder_only member', () => {
    const { container } = renderPDP({
      fulfilment_type: 'mixed', role: 'staff', orderingPermission: 'reorder_only',
    })
    expect(container.textContent ?? '').not.toContain('Stock on hand')
  })
})
