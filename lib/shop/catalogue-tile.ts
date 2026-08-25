import type { ProductCardSwatch } from '@/components/shop/ProductCard'

export interface CatalogueColour {
  swatchId: string
  label: string | null
  hex: string | null
  /** Per-colour thumbnail, precomputed server-side. */
  imageUrl: string | null
}

/** Product shape the grid needs: the ProductCard fields plus the colour breakdown. */
export interface CatalogueProductForGrid {
  id: string
  /** Customer-facing catalogue-item name shown as the card title. */
  title: string
  /** Underlying blank garment name (the "Product" line, alongside brand + SKU). */
  name: string
  /** Brand of the blank garment; null when unset. */
  brand: string | null
  sku: string | null
  image_url: string | null
  type: string | null
  price_low: number
  price_high: number
  price_status: 'ok' | 'missing'
  price_currency?: string
  stock_unit_price?: number | null
  has_stock: boolean
  total_stock?: number | null
  colours: CatalogueColour[]
}

export interface ProductCardData {
  id: string
  title: string
  name: string
  brand: string | null
  sku: string | null
  image_url: string | null
  type: string | null
  price_low: number
  price_high: number
  price_status: 'ok' | 'missing'
  price_currency?: string
  stock_unit_price?: number | null
  has_stock: boolean
  total_stock?: number | null
  swatches: ProductCardSwatch[]
}

export interface CatalogueTile {
  key: string
  href: string
  product: ProductCardData
}

/**
 * One catalogue card per product. Every colour the product comes in is carried
 * as a swatch (ProductCard renders up to five, then "+N"); the card links to
 * the product's PDP, where the specific colour is chosen.
 */
export function toProductTile(p: CatalogueProductForGrid): CatalogueTile {
  return {
    key: p.id,
    href: `/catalogue/${p.id}`,
    product: {
      id: p.id,
      title: p.title,
      name: p.name,
      brand: p.brand,
      sku: p.sku,
      image_url: p.image_url,
      type: p.type,
      price_low: p.price_low,
      price_high: p.price_high,
      price_status: p.price_status,
      price_currency: p.price_currency,
      stock_unit_price: p.stock_unit_price ?? null,
      has_stock: p.has_stock,
      total_stock: p.total_stock ?? null,
      swatches: p.colours.map((c) => ({ hex: c.hex, label: c.label })),
    },
  }
}
