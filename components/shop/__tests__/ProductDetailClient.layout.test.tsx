import { render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ProductDetailClient } from '../ProductDetailClient'
import type { DecorationOption } from '@/lib/shop/decorations'

vi.mock('@/components/cart/useCart', () => ({ useCart: () => ({ addLine: vi.fn() }) }))
vi.mock('@/contexts/CurrencyContext', () => ({
  useCurrency: () => ({ format: (n: number) => `$${n}` }),
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
}

describe('ProductDetailClient PDP layout', () => {
  it('keeps decoration artwork in the gallery and limits product facts to sku, brand, and category', () => {
    render(
      <ProductDetailClient
        product={{
          id: 'p1',
          name: 'Staple Tee',
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
        availability={{ 'red-s::1': { available_qty: 115, allow_order_without_stock: false } }}
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

    expect(screen.getByText('SKU')).toBeInTheDocument()
    expect(screen.getByText('5001')).toBeInTheDocument()
    expect(screen.getByText('Brand')).toBeInTheDocument()
    expect(screen.getByText('AS Colour')).toBeInTheDocument()
    expect(screen.getByText('Category')).toBeInTheDocument()
    expect(screen.getByText('T-Shirt')).toBeInTheDocument()
    expect(screen.queryByText('Garment family')).not.toBeInTheDocument()
    expect(screen.queryByText('ProductType')).not.toBeInTheDocument()
    expect(screen.queryByText('TotalColors')).not.toBeInTheDocument()
    expect(screen.queryByText('Safety standard')).not.toBeInTheDocument()
  })
})
