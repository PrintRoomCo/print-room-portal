import Image from 'next/image'
import { TierBadge } from '@/components/pricing/TierBadge'
import { Money } from './Money'

interface ProductCardData {
  id: string
  name: string
  sku: string | null
  image_url: string | null
  from_unit_price: number
  price_status: 'ok' | 'missing'
  has_stock: boolean
  // Stock total across every variant the org tracks. `null` means the org
  // doesn't track stock for this product (catalogue-only entry) → no chip.
  // A positive number → "N in stock". Zero → "Made to order" (stock tracking
  // exists but everything is committed or unstocked).
  total_stock?: number | null
}

interface ProductCardProps {
  product: ProductCardData
}

export function ProductCard({ product }: ProductCardProps) {
  const stock = product.total_stock
  return (
    <div className="group relative flex h-full flex-col overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm transition-all duration-300 ease-spring hover:-translate-y-0.5 hover:border-[rgb(var(--color-brand-blue))]/20 hover:shadow-md">
      <div className="relative aspect-square w-full bg-gray-50">
        {product.image_url ? (
          <Image
            src={product.image_url}
            alt={product.name}
            fill
            sizes="(min-width:1024px) 25vw, (min-width:768px) 33vw, 50vw"
            className="object-contain p-4 transition-transform duration-500 ease-spring group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-gray-300 text-sm">
            No image
          </div>
        )}
        <div className="absolute right-3 top-3 flex flex-col items-end gap-1">
          <TierBadge />
          {stock != null && stock > 0 && (
            <span className="rounded-full bg-lime-100 px-2.5 py-1 text-xs font-medium text-lime-800">
              {stock} in stock
            </span>
          )}
          {stock != null && stock === 0 && (
            <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-800">
              Made to order
            </span>
          )}
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-1 p-4">
        <p className="text-xs uppercase tracking-wide text-gray-400">{product.sku}</p>
        <h3 className="text-sm font-medium text-gray-900 line-clamp-2">{product.name}</h3>
        {product.price_status === 'missing' ? (
          <p className="mt-auto pt-3 text-sm text-gray-500">Price on request</p>
        ) : (
          <p className="mt-auto pt-3 text-sm text-gray-600">
            From{' '}
            <span className="rounded-full bg-[rgb(var(--color-brand-yellow))] px-2 py-0.5 font-semibold text-[rgb(var(--color-brand-blue))]">
              <Money nzd={product.from_unit_price} />
            </span>
          </p>
        )}
      </div>
    </div>
  )
}
