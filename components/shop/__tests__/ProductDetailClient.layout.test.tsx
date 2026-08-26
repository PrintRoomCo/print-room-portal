import { render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ProductDetailClient } from '../ProductDetailClient'
import type { DecorationOption } from '@/lib/shop/decorations'

vi.mock('@/components/cart/useCart', () => ({ useCart: () => ({ addLine: vi.fn() }) }))
vi.mock('@/contexts/CurrencyContext', () => ({
  useCurrency: () => ({ format: (n: number) => `$${n}` }),
}))
// Supply the complete NZ country config used by this component's price display.
vi.mock('@/contexts/CompanyContext', () => ({
  useCompany: () => ({ access: null, loading: false, defaultBillingCountry: { code: 'NZ', name: 'New Zealand', currency: 'NZD', taxRate: 0.15, taxLabel: 'GST 15%', isDefault: true } }),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ back: vi.fn() }) }))
vi.mock('next/image', () => ({
  default: ({
    alt = '',
    fill,
    priority,
    sizes,
    ...props
  }: {
    alt?: string
    fill?: boolean
    priority?: boolean
    sizes?: string
  }) => {
    void fill
    void priority
    void sizes
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img alt={alt} {...props} />
    )
  },
}))

const decoration: DecorationOption = {
  linkId: 'link-1',
  decorationId: 'dec-1',
  name: 'Screen print - Left Chest',
  method: 'screenprint',
  positionLabel: 'Left Chest',
  unitPrice: 0,
  artworkUrl: '/actual-artwork.png',
  artworkName: 'artwork.png',
  snapshotUrl: '/product-snapshot.png',
  snapshotColorSwatchId: 'red',
  isDefault: true,
  sortOrder: 0,
  recalcInputs: null,
  overlay: null,
  // Real artwork + non-'custom' method → eligible to pool (spec §5).
  poolable: true,
  // No authored price ladder → today's engine/flat pricing.
  ladder: null,
}

describe('ProductDetailClient PDP layout', () => {
  it('keeps decoration artwork in the gallery and limits product facts to sku and brand (category omitted)', () => {
    render(
      <ProductDetailClient
        product={{
          id: 'p1',
          name: 'Staple Tee',
          garment_name: 'AS Colour Staple Tee',
          description: null,
          image_url: null,
          moq: 1,
          lead_time_days: 7,
          sizing_type: 'multi_size_with_variants',
          decoration_methods: null,
          decoration_price: null,
          sku: '5001',
          safety_standard: 'AS/NZS',
          specs: { ProductType: 'T-Shirts', TotalColors: 33 },
          supports_labels: null,
          garment_family: 'tee',
          default_sizes: ['S', 'M'],
          fulfilment_type: 'mixed',
          brand_name: 'AS Colour',
          category_name: 'T-Shirt',
          catalogueItemId: 'i1',
        }}
        variants={[
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
        ]}
        sizes={[{ size_id: 1, size_label: 'S', size_order: 0 }]}
        brackets={[{ min_quantity: 1, max_quantity: null, unit_price: 10 }]}
        availability={{ 'red-s::1': { available_qty: 115 } }}
        organizationId="o1"
        customerRole="org_admin"
        orderingPermission="both"
        images={[
          {
            id: 'catalogue-hero',
            url: '/decorated-product.png',
            view: 'hero',
            position: -100,
            color_swatch_id: 'red',
            scope: 'catalogue',
            source: 'designer_snapshot',
          },
        ]}
        colourOptions={[]}
        decorations={[decoration]}
        effectiveMoq={1}
      />,
    )

    const titleRow = screen.getByRole('heading', { name: 'Staple Tee' }).parentElement
    expect(titleRow).not.toBeNull()
    expect(within(titleRow as HTMLElement).getByText('In stock (115 available)')).toBeInTheDocument()

    expect(screen.queryByText(/Decoration included/i)).not.toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /artwork: Screen print - Left Chest/i })).toBeInTheDocument()

    expect(screen.getByText('Garment Name')).toBeInTheDocument()
    expect(screen.getByText('AS Colour Staple Tee')).toBeInTheDocument()
    expect(screen.getByText('SKU')).toBeInTheDocument()
    expect(screen.getByText('5001')).toBeInTheDocument()
    expect(screen.getByText('Brand')).toBeInTheDocument()
    expect(screen.getByText('AS Colour')).toBeInTheDocument()
    // Category is intentionally omitted from the customer PDP (Anna feedback),
    // even though category_name is still supplied in the product data.
    expect(screen.queryByText('Category')).not.toBeInTheDocument()
    expect(screen.queryByText('T-Shirt')).not.toBeInTheDocument()
    expect(screen.queryByText('Garment family')).not.toBeInTheDocument()
    expect(screen.queryByText('ProductType')).not.toBeInTheDocument()
    expect(screen.queryByText('TotalColors')).not.toBeInTheDocument()
    expect(screen.queryByText('Safety standard')).not.toBeInTheDocument()
  })

  // The reported bug: author line breaks vanished on the PDP. cleanDescription now
  // preserves `\n`; the description <p> must carry whitespace-pre-line so those
  // newlines render as visible line breaks (not collapsed to spaces).
  it('renders the description with preserved line breaks', () => {
    const { container } = render(
      <ProductDetailClient
        product={{
          id: 'p1',
          name: 'Staple Tee',
          description: 'AS Colour Staple Tee\nA premium tee.\n\n- Classic fit\n- Premium cotton',
          image_url: null,
          moq: 1,
          lead_time_days: 7,
          sizing_type: 'multi_size_with_variants',
          decoration_methods: null,
          decoration_price: null,
          sku: '5001',
          safety_standard: null,
          specs: null,
          supports_labels: null,
          garment_family: 'tee',
          default_sizes: ['S'],
          fulfilment_type: 'mixed',
          brand_name: 'AS Colour',
          category_name: 'T-Shirt',
          catalogueItemId: 'i1',
        }}
        variants={[
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
        ]}
        sizes={[{ size_id: 1, size_label: 'S', size_order: 0 }]}
        brackets={[{ min_quantity: 1, max_quantity: null, unit_price: 10 }]}
        availability={{ 'red-s::1': { available_qty: 115 } }}
        organizationId="o1"
        customerRole="org_admin"
        orderingPermission="both"
        images={[]}
        colourOptions={[]}
        decorations={[]}
        effectiveMoq={1}
      />,
    )

    const desc = container.querySelector('p.whitespace-pre-line')
    expect(desc).not.toBeNull()
    expect(desc?.textContent).toBe(
      'AS Colour Staple Tee\nA premium tee.\n\n- Classic fit\n- Premium cotton',
    )
  })
})
