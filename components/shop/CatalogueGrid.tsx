import Link from 'next/link'
import { ProductCard } from './ProductCard'
import { toProductTile, type CatalogueProductForGrid } from '@/lib/shop/catalogue-tile'

interface Props {
  products: CatalogueProductForGrid[]
}

export function CatalogueGrid({ products }: Props) {
  const tiles = products.map(toProductTile)

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-4 lg:gap-4 xl:grid-cols-5">
      {tiles.map((tile) => (
        <Link
          key={tile.key}
          href={tile.href}
          className="block transition-transform duration-150 active:scale-[0.99]"
        >
          <ProductCard product={tile.product} />
        </Link>
      ))}
    </div>
  )
}
