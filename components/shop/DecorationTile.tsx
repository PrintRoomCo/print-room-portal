import type { DecorationOption } from '@/lib/shop/decorations'

interface DecorationTileProps {
  decorations: DecorationOption[]
  productName: string
}

/**
 * Display-only PDP surface for the decorations already filtered to the
 * selected colour by ProductDetailClient.
 */
export function DecorationTile({ decorations, productName }: DecorationTileProps) {
  if (decorations.length === 0) return null

  return (
    <div className="mt-4">
      <h2 className="mb-2 text-sm font-medium text-gray-700">Decoration</h2>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {decorations.map((decoration) => {
          const src = decoration.snapshotUrl ?? decoration.artworkUrl

          return (
            <li key={decoration.linkId} className="flex flex-col gap-1">
              <div className="relative aspect-square w-full overflow-hidden rounded-2xl border border-gray-100 bg-gray-50">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={src}
                  alt={`${productName} - ${decoration.name}`}
                  className="h-full w-full object-contain p-2"
                />
              </div>
              <div className="px-1">
                <p className="text-sm text-gray-900">{decoration.name}</p>
                {decoration.positionLabel ? (
                  <p className="text-xs text-gray-500">{decoration.positionLabel}</p>
                ) : null}
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
