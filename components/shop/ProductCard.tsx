import Image from 'next/image'
import { Money } from './Money'

export interface ProductCardSwatch {
  hex: string | null
  label: string | null
}

interface ProductCardData {
  id: string
  name: string
  sku: string | null
  image_url: string | null
  /** Garment family (preferred) or category. */
  type: string | null
  from_unit_price: number
  price_status: 'ok' | 'missing'
  has_stock: boolean
  /** Stock total across every tracked variant. Currently unused on card — */
  /** kept on the data shape so the page query can stay consistent. */
  total_stock?: number | null
  /** Already deduped + ordered by catalogue sort_order → swatch position. */
  swatches: ProductCardSwatch[]
}

interface ProductCardProps {
  product: ProductCardData
}

const MAX_VISIBLE_SWATCHES = 5

export function ProductCard({ product }: ProductCardProps) {
  const visibleSwatches = product.swatches.slice(0, MAX_VISIBLE_SWATCHES)
  const extraSwatches = Math.max(0, product.swatches.length - MAX_VISIBLE_SWATCHES)

  return (
    <article className="group flex h-full flex-col items-center rounded-3xl bg-white p-3 text-center transition-shadow duration-300 ease-spring hover:shadow-md">
      <div className="relative aspect-square w-full overflow-hidden rounded-2xl bg-gray-50">
        {product.image_url ? (
          <Image
            src={product.image_url}
            alt={product.name}
            fill
            sizes="(min-width:1024px) 20vw, (min-width:768px) 25vw, 50vw"
            className="object-contain transition-transform duration-500 ease-spring group-hover:scale-[1.02]"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-gray-300">
            No image
          </div>
        )}
      </div>

      <h3 className="mt-3 line-clamp-2 text-sm font-medium text-gray-900 md:text-base">
        {product.name}
      </h3>
      {product.type && (
        <p className="mt-0.5 text-xs text-gray-500">{formatType(product.type)}</p>
      )}

      {visibleSwatches.length > 0 && (
        <div
          className="mt-2 flex flex-wrap items-center justify-center gap-1"
          aria-label={`${product.swatches.length} colour${product.swatches.length === 1 ? '' : 's'} available`}
        >
          {visibleSwatches.map((s, i) => (
            <span
              key={`${s.hex ?? 'na'}-${i}`}
              className="block h-2.5 w-2.5 rounded-full border border-black/10"
              // eslint-disable-next-line react/forbid-dom-props -- dynamic hex from DB requires inline style
              style={{ backgroundColor: s.hex ?? '#e5e7eb' }}
              title={s.label ?? undefined}
            />
          ))}
          {extraSwatches > 0 && (
            <span className="ml-0.5 text-[10px] text-gray-400">+{extraSwatches}</span>
          )}
        </div>
      )}

      <span className="mt-3 inline-flex rounded-full bg-gray-100 px-3 py-1.5 text-xs text-gray-900 transition-colors group-hover:bg-gray-200">
        {product.price_status === 'missing' ? (
          'On request'
        ) : (
          <>
            From&nbsp;
            <Money nzd={product.from_unit_price} />
          </>
        )}
      </span>
    </article>
  )
}

function formatType(t: string | null): string {
  if (!t) return ''
  return t.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}
