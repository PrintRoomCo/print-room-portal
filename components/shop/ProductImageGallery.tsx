'use client'

import Image from 'next/image'
import { useEffect, useMemo, useState } from 'react'
import {
  resolveGalleryImagesForColour,
  type CatalogueAwareGalleryImage,
} from '@/lib/shop/catalogue-images'

export type GalleryImage = CatalogueAwareGalleryImage

interface Props {
  images: GalleryImage[]
  fallbackUrl: string | null
  productName: string
  selectedColorSwatchId: string | null
}

export function ProductImageGallery({
  images,
  fallbackUrl,
  productName,
  selectedColorSwatchId,
}: Props) {
  const ordered = useMemo(
    () => resolveGalleryImagesForColour(images, selectedColorSwatchId),
    [images, selectedColorSwatchId],
  )
  const initial = ordered[0]?.url ?? fallbackUrl ?? null
  const [activeUrl, setActiveUrl] = useState<string | null>(initial)

  useEffect(() => {
    const urls = new Set(ordered.map((img) => img.url))
    setActiveUrl((current) => {
      if (current && urls.has(current)) return current
      return ordered[0]?.url ?? fallbackUrl ?? null
    })
  }, [fallbackUrl, ordered])

  if (!activeUrl) {
    return (
      <div className="relative aspect-square w-full overflow-hidden rounded-2xl border border-gray-100 bg-gray-50">
        <div className="flex h-full items-center justify-center text-gray-300">No image</div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="relative aspect-square w-full overflow-hidden rounded-2xl border border-gray-100 bg-gray-50">
        <Image
          key={activeUrl}
          src={activeUrl}
          alt={productName}
          fill
          sizes="(min-width:1024px) 40vw, 100vw"
          className="object-contain p-6"
          priority
        />
      </div>
      {ordered.length > 1 && (
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Product views">
          {ordered.map((img) => {
            const isActive = img.url === activeUrl
            return (
              <button
                key={img.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                aria-label={`View ${img.view ?? 'image'}`}
                onClick={() => setActiveUrl(img.url)}
                className={
                  'relative h-16 w-16 overflow-hidden rounded-lg border bg-white transition ' +
                  (isActive
                    ? 'border-pr-blue ring-2 ring-pr-blue/30'
                    : 'border-gray-200 hover:border-gray-300')
                }
              >
                <Image
                  src={img.url}
                  alt=""
                  fill
                  sizes="64px"
                  className="object-contain p-1"
                />
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
