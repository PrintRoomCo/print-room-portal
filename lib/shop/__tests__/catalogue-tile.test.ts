import { describe, it, expect } from 'vitest'
import { toProductTile, type CatalogueProductForGrid } from '../catalogue-tile'

const base: CatalogueProductForGrid = {
  id: 'p1',
  title: 'Team Crew Socks',
  name: 'Crew Socks',
  brand: 'AS Colour',
  sku: 'CS',
  image_url: 'master.png',
  type: null,
  price_low: 10,
  price_high: 18,
  price_status: 'ok',
  has_stock: true,
  total_stock: null,
  colours: [
    { swatchId: 'sw-black', label: 'Black', hex: '#191919', imageUrl: 'black.png' },
    { swatchId: 'sw-pink', label: 'Pink', hex: '#e17ace', imageUrl: 'pink.png' },
  ],
}

describe('toProductTile', () => {
  it('builds one tile per product, linking to the PDP (no colour explosion)', () => {
    const tile = toProductTile(base)
    expect(tile.key).toBe('p1')
    expect(tile.href).toBe('/catalogue/p1')
    expect(tile.product.title).toBe('Team Crew Socks')
    expect(tile.product.name).toBe('Crew Socks')
    expect(tile.product.brand).toBe('AS Colour')
    expect(tile.product.image_url).toBe('master.png')
  })

  it('carries every colour as a swatch', () => {
    const tile = toProductTile(base)
    expect(tile.product.swatches).toEqual([
      { hex: '#191919', label: 'Black' },
      { hex: '#e17ace', label: 'Pink' },
    ])
  })

  it('handles a single-colour product', () => {
    const tile = toProductTile({ ...base, colours: [base.colours[0]] })
    expect(tile.href).toBe('/catalogue/p1')
    expect(tile.product.swatches).toEqual([{ hex: '#191919', label: 'Black' }])
  })

  it('carries the canonical authored currency and exact stock scalar to the card', () => {
    const tile = toProductTile({
      ...base,
      price_currency: 'AUD',
      stock_unit_price: 0,
    })
    expect(tile.product.price_currency).toBe('AUD')
    expect(tile.product.stock_unit_price).toBe(0)
  })
})
