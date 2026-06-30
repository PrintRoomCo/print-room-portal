import type { ProductCardSwatch } from '@/components/shop/ProductCard'

export interface CatalogueColour {
  swatchId: string
  label: string | null
  hex: string | null
  /** Per-colour thumbnail, precomputed server-side; null falls back to product image. */
  imageUrl: string | null
}

/** Product shape the grid needs: the ProductCard fields plus the colour breakdown. */
export interface CatalogueProductForGrid {
  id: string
  name: string
  sku: string | null
  image_url: string | null
  type: string | null
  price_low: number
  price_high: number
  price_status: 'ok' | 'missing'
  has_stock: boolean
  total_stock?: number | null
  colours: CatalogueColour[]
}

export interface ProductCardData {
  id: string
  name: string
  sku: string | null
  image_url: string | null
  type: string | null
  price_low: number
  price_high: number
  price_status: 'ok' | 'missing'
  has_stock: boolean
  total_stock?: number | null
  swatches: ProductCardSwatch[]
}

export interface VariantTile {
  key: string
  href: string
  product: ProductCardData
}

function baseCard(p: CatalogueProductForGrid): Omit<ProductCardData, 'name' | 'image_url' | 'swatches'> {
  return {
    id: p.id,
    sku: p.sku,
    type: p.type,
    price_low: p.price_low,
    price_high: p.price_high,
    price_status: p.price_status,
    has_stock: p.has_stock,
    total_stock: p.total_stock ?? null,
  }
}

/**
 * One tile per colour when showAll AND the product has >=2 colours; otherwise a
 * single product tile carrying all colour swatches (today's behaviour).
 */
export function explodeVariants(
  p: CatalogueProductForGrid,
  showAll: boolean,
): VariantTile[] {
  if (showAll && p.colours.length >= 2) {
    return p.colours.map((c) => ({
      key: `${p.id}:${c.swatchId}`,
      href: `/catalogue/${p.id}?color=${c.swatchId}`,
      product: {
        ...baseCard(p),
        name: c.label ? `${p.name} — ${c.label}` : p.name,
        image_url: c.imageUrl ?? p.image_url,
        swatches: [{ hex: c.hex, label: c.label }],
      },
    }))
  }
  return [
    {
      key: p.id,
      href: `/catalogue/${p.id}`,
      product: {
        ...baseCard(p),
        name: p.name,
        image_url: p.image_url,
        swatches: p.colours.map((c) => ({ hex: c.hex, label: c.label })),
      },
    },
  ]
}
