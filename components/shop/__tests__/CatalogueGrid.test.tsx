import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { CatalogueGrid } from '../CatalogueGrid'
import type { CatalogueProductForGrid } from '@/lib/shop/explode-variants'
import { SHOW_ALL_VARIANTS_KEY } from '@/lib/shop/show-all-variants'

// ProductCard -> Money calls useCurrency(), which throws without a provider.
// Stub it so the grid test stays focused on explode/toggle behaviour.
vi.mock('@/contexts/CurrencyContext', () => ({
  useCurrency: () => ({
    format: (n: number) => `$${n.toFixed(2)}`,
    loading: false,
    currency: 'NZD',
  }),
}))

// next/image rejects relative test-fixture src values ("black.png") via its
// loader. The grid test cares about tiles/links/toggle, not image rendering —
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
  beforeEach(() => window.localStorage.clear())

  it('defaults to exploded (one tile per colour)', () => {
    render(<CatalogueGrid products={products} />)
    expect(screen.getByText('Crew Socks — Black')).toBeInTheDocument()
    expect(screen.getByText('Crew Socks — Pink')).toBeInTheDocument()
    const blackLink = screen.getByText('Crew Socks — Black').closest('a')
    expect(blackLink).toHaveAttribute('href', '/catalogue/p1?color=sw-black')
  })

  it('collapses when the toggle is switched off, and persists the choice', () => {
    render(<CatalogueGrid products={products} />)
    fireEvent.click(screen.getByRole('switch', { name: /show all variants/i }))
    expect(screen.queryByText('Crew Socks — Black')).not.toBeInTheDocument()
    expect(screen.getByText('Crew Socks')).toBeInTheDocument()
    expect(window.localStorage.getItem(SHOW_ALL_VARIANTS_KEY)).toBe('0')
  })

  it('honours a stored OFF preference on mount', () => {
    window.localStorage.setItem(SHOW_ALL_VARIANTS_KEY, '0')
    render(<CatalogueGrid products={products} />)
    expect(screen.getByText('Crew Socks')).toBeInTheDocument()
    expect(screen.queryByText('Crew Socks — Black')).not.toBeInTheDocument()
  })
})
