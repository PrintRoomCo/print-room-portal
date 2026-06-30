import { describe, it, expect } from 'vitest'
import { explodeVariants, type CatalogueProductForGrid } from '../explode-variants'

const base: CatalogueProductForGrid = {
  id: 'p1',
  name: 'Crew Socks',
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

describe('explodeVariants', () => {
  it('explodes a 2-colour product into one tile per colour when showAll', () => {
    const tiles = explodeVariants(base, true)
    expect(tiles.map((t) => t.key)).toEqual(['p1:sw-black', 'p1:sw-pink'])
    expect(tiles[0].href).toBe('/catalogue/p1?color=sw-black')
    expect(tiles[0].product.name).toBe('Crew Socks — Black')
    expect(tiles[0].product.image_url).toBe('black.png')
    expect(tiles[0].product.swatches).toEqual([{ hex: '#191919', label: 'Black' }])
    expect(tiles[1].product.image_url).toBe('pink.png')
  })

  it('collapses to one product tile when showAll is false', () => {
    const tiles = explodeVariants(base, false)
    expect(tiles).toHaveLength(1)
    expect(tiles[0].key).toBe('p1')
    expect(tiles[0].href).toBe('/catalogue/p1')
    expect(tiles[0].product.image_url).toBe('master.png')
    expect(tiles[0].product.swatches).toEqual([
      { hex: '#191919', label: 'Black' },
      { hex: '#e17ace', label: 'Pink' },
    ])
  })

  it('renders a single tile for a 1-colour product even when showAll', () => {
    const oneColour = { ...base, colours: [base.colours[0]] }
    const tiles = explodeVariants(oneColour, true)
    expect(tiles).toHaveLength(1)
    expect(tiles[0].key).toBe('p1')
    expect(tiles[0].href).toBe('/catalogue/p1')
  })

  it('falls back to the product image when a colour has no own image', () => {
    const noImg = { ...base, colours: [{ ...base.colours[0], imageUrl: null }, base.colours[1]] }
    const tiles = explodeVariants(noImg, true)
    expect(tiles[0].product.image_url).toBe('master.png')
  })
})
