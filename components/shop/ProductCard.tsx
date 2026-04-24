import Image from 'next/image'

interface ProductCardData {
  id: string
  name: string
  sku: string | null
  image_url: string | null
  from_unit_price: number
  has_stock: boolean
}

export function ProductCard({ product }: { product: ProductCardData }) {
  return (
    <div className="group relative flex flex-col overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm transition-all duration-300 ease-spring hover:shadow-md">
      <div className="relative aspect-square w-full bg-gray-50">
        {product.image_url ? (
          <Image
            src={product.image_url}
            alt={product.name}
            fill
            sizes="(min-width:1024px) 25vw, (min-width:768px) 33vw, 50vw"
            className="object-contain p-4 transition-transform duration-500 ease-spring group-hover:scale-105"
            unoptimized
          />
        ) : (
          <div className="flex h-full items-center justify-center text-gray-300 text-sm">
            No image
          </div>
        )}
        {product.has_stock && (
          <span className="absolute right-3 top-3 rounded-full bg-lime-100 px-2.5 py-1 text-xs font-medium text-lime-800">
            In stock
          </span>
        )}
      </div>
      <div className="flex flex-col gap-1 p-4">
        <p className="text-xs uppercase tracking-wide text-gray-400">{product.sku}</p>
        <h3 className="text-sm font-medium text-gray-900 line-clamp-2">{product.name}</h3>
        {product.from_unit_price > 0 && (
          <p className="mt-1 text-sm text-gray-600">
            From <span className="font-semibold text-gray-900">${product.from_unit_price.toFixed(2)}</span>
          </p>
        )}
      </div>
    </div>
  )
}
