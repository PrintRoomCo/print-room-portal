import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { CatalogueGrid } from '../CatalogueGrid'
import type { CatalogueProductForGrid } from '@/lib/shop/explode-variants'

// ProductCard -> Money calls useCurrency(), which throws without a provider.
// Stub it so the grid test stays focused on explode behaviour.
vi.mock('@/contexts/CurrencyContext', () => ({
  useCurrency: () => ({
    format: (n: number) => `$${n.toFixed(2)}`,
    loading: false,
    currency: 'NZD',
  }),
}))

// next/image rejects relative test-fixture src values ("black.png") via its
// loader. The grid test cares about tiles/links, not image rendering —
// render a plain <img> so fixtures don't need absolute URLs.
vi.mock('next/image', () => ({
  __esModule: true,
  default: ({ src, alt }: { src?: string; alt?: string }) => (
    <img src={typeof src === 'string' ? src : ''} alt={alt ?? ''} />
  ),
}))

const products: CatalogueProductForGrid[] = [
  {
    id: 'p1', name: 'Crew Socks', sku: 'CS', image_url: 'master.png', type: null,
    price_low: 10, price_high: 18, price_status: 'ok', has_stock: true, total_stock: null,
    colours: [
      { swatchId: 'sw-black', label: 'Black', hex: '#191919', imageUrl: 'black.png' },
      { swatchId: 'sw-pink', label: 'Pink', hex: '#e17ace', imageUrl: 'pink.png' },
    ],
  },
]

describe('CatalogueGrid', () => {
  it('renders one tile per colour', () => {
    render(<CatalogueGrid products={products} />)
    expect(screen.getByText('Crew Socks — Black')).toBeInTheDocument()
    expect(screen.getByText('Crew Socks — Pink')).toBeInTheDocument()
    const blackLink = screen.getByText('Crew Socks — Black').closest('a')
    expect(blackLink).toHaveAttribute('href', '/catalogue/p1?color=sw-black')
  })
})
