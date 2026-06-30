'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { ProductCard } from './ProductCard'
import { explodeVariants, type CatalogueProductForGrid } from '@/lib/shop/explode-variants'
import { readShowAllVariants, writeShowAllVariants } from '@/lib/shop/show-all-variants'

interface Props {
  products: CatalogueProductForGrid[]
}

export function CatalogueGrid({ products }: Props) {
  // SSR + first paint render the default (ON); reconcile to the stored
  // preference after mount. setState in an effect = no hydration mismatch.
  const [showAll, setShowAll] = useState(true)
  useEffect(() => {
    setShowAll(readShowAllVariants(window.localStorage))
  }, [])

  function toggle() {
    setShowAll((prev) => {
      const next = !prev
      writeShowAllVariants(window.localStorage, next)
      return next
    })
  }

  const tiles = products.flatMap((p) => explodeVariants(p, showAll))

  return (
    <div>
      <div className="mb-3 flex items-center justify-end">
        <button
          type="button"
          role="switch"
          aria-checked={showAll}
          aria-label="Show all variants"
          onClick={toggle}
          className="inline-flex items-center gap-2 rounded-full bg-gray-100 px-3 py-1.5 text-[12px] font-medium text-gray-700 transition-colors hover:bg-gray-200"
        >
          <span
            aria-hidden
            className={`inline-block h-3.5 w-6 rounded-full transition-colors ${showAll ? 'bg-gray-900' : 'bg-gray-300'}`}
          >
            <span
              className={`block h-3.5 w-3.5 rounded-full bg-white transition-transform ${showAll ? 'translate-x-2.5' : 'translate-x-0'}`}
            />
          </span>
          Show all variants
        </button>
      </div>
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
    </div>
  )
}
