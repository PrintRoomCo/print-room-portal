import { ImageWithFallback } from './ImageWithFallback'
import { Money } from './Money'

export interface ProductCardSwatch {
  hex: string | null
  label: string | null
}

interface ProductCardData {
  id: string
  /** Customer-facing catalogue-item name — the prominent card title. */
  title: string
  /** Underlying blank garment name, shown in the "Product" line with brand + SKU. */
  name: string
  /** Brand of the blank garment; null when unset. */
  brand: string | null
  sku: string | null
  image_url: string | null
  /** Garment family (preferred) or category. No longer shown on the card — */
  /** kept on the data shape so the page query can stay consistent. */
  type: string | null
  /**
   * All-in price range, decoration included. `price_high` = most expensive
   * (entry qty), `price_low` = cheapest (floor/volume qty). Equal ends render as
   * a single price (fixed-price items).
   */
  price_low: number
  price_high: number
  price_status: 'ok' | 'missing'
  /** Canonical authored list currency; absent preserves legacy visitor conversion. */
  price_currency?: string
  /**
   * Explicit ex-GST stock sell price (Stock-on-hand). When set, the card shows
   * this single price instead of the computed range, so the card and the PDP
   * agree ("one price to show").
   */
  stock_unit_price?: number | null
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

/** "[brand] [product name] – [SKU]", skipping any part that is absent. */
function formatProductLine({
  brand,
  name,
  sku,
}: Pick<ProductCardData, 'brand' | 'name' | 'sku'>): string {
  const base = [brand, name].filter(Boolean).join(' ')
  if (!sku) return base
  return base ? `${base} – ${sku}` : sku
}

export function ProductCard({ product }: ProductCardProps) {
  const visibleSwatches = product.swatches.slice(0, MAX_VISIBLE_SWATCHES)
  const extraSwatches = Math.max(0, product.swatches.length - MAX_VISIBLE_SWATCHES)
  const productLine = formatProductLine(product)

  return (
    <article className="group flex h-full flex-col rounded-3xl bg-white p-3 transition-shadow duration-300 ease-spring hover:shadow-md">
      <div className="relative aspect-square w-full overflow-hidden rounded-2xl bg-white">
        <ImageWithFallback
          src={product.image_url ?? ''}
          alt={product.title}
          fill
          sizes="(min-width:1024px) 25vw, (min-width:768px) 33vw, 50vw"
          className="object-contain transition-transform duration-500 ease-spring group-hover:scale-[1.02]"
          fallback={
            <div className="flex h-full items-center justify-center text-xs text-gray-300">
              No image
            </div>
          }
        />
      </div>

      <div className="mt-3 flex flex-col gap-1.5 px-2 pb-1">
        <h3 className="truncate text-sm font-semibold tracking-tight text-gray-900">
          {product.title}
        </h3>

        <div className="flex items-end justify-between gap-3">
          <dl className="grid min-w-0 grid-cols-[auto_auto] items-baseline gap-x-4 gap-y-0.5 text-[10px] leading-tight">
            <dt className="font-medium tracking-wider text-gray-400">Product</dt>
            <dt className="font-medium tracking-wider text-gray-400">Price</dt>
            <dd className="truncate font-medium tracking-wider text-gray-900">
              {productLine}
            </dd>
            <dd className="whitespace-nowrap font-medium tracking-wider text-gray-900">
              {product.stock_unit_price != null ? (
                <Money amount={product.stock_unit_price} sourceCurrency={product.price_currency} />
              ) : product.price_status === 'missing' ? (
                'On request'
              ) : product.price_high > product.price_low ? (
                <>
                  <Money amount={product.price_high} sourceCurrency={product.price_currency} /> –{' '}
                  <Money amount={product.price_low} sourceCurrency={product.price_currency} />
                </>
              ) : (
                <Money amount={product.price_low} sourceCurrency={product.price_currency} />
              )}
            </dd>
          </dl>

          {visibleSwatches.length > 0 && (
            <div
              className="flex shrink-0 items-center gap-1"
              aria-label={`${product.swatches.length} colour${product.swatches.length === 1 ? '' : 's'} available`}
            >
              {visibleSwatches.map((s, i) => (
                <span
                  key={`${s.hex ?? 'na'}-${i}`}
                  className="block h-2.5 w-2.5 rounded-full border border-black/10"
                  style={{ backgroundColor: s.hex ?? '#e5e7eb' }}
                  title={s.label ?? undefined}
                />
              ))}
              {extraSwatches > 0 && (
                <span className="ml-0.5 text-[9px] font-medium tracking-wider text-gray-400">
                  +{extraSwatches}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </article>
  )
}
