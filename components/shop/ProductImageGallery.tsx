'use client'

import Image from 'next/image'
import { useEffect, useMemo, useState } from 'react'
import {
  resolveGalleryImagesForColour,
  type CatalogueAwareGalleryImage,
} from '@/lib/shop/catalogue-images'

export type GalleryImage = CatalogueAwareGalleryImage

export interface GalleryOverlay {
  linkId: string
  printAreaView: string
  rect: { x: number; y: number; w: number; h: number }
  placement: { x: number; y: number; w: number; h: number; rotation_deg: number }
  artworkUrl: string
}

interface Props {
  images: GalleryImage[]
  fallbackUrl: string | null
  productName: string
  selectedColorSwatchId: string | null
  overlays?: GalleryOverlay[]
}

export function ProductImageGallery({
  images,
  fallbackUrl,
  productName,
  selectedColorSwatchId,
  overlays = [],
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

  const activeImage = useMemo(
    () => ordered.find((img) => img.url === activeUrl) ?? null,
    [ordered, activeUrl],
  )
  const activeView = activeImage?.view?.toLowerCase() ?? null

  // A designer_snapshot already has decorations baked in by staff — overlaying
  // live artwork on top would double-render (and any CDN/browser cache lag on
  // the snapshot URL would offset the two copies). Trust the snapshot as-is.
  const activeOverlays = useMemo(
    () =>
      activeView && activeImage?.source !== 'designer_snapshot'
        ? overlays.filter((o) => o.printAreaView.toLowerCase() === activeView)
        : [],
    [overlays, activeView, activeImage],
  )

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
        {activeOverlays.map((o) => {
          const left = (o.rect.x + o.placement.x * o.rect.w) * 100
          const top = (o.rect.y + o.placement.y * o.rect.h) * 100
          const width = o.placement.w * o.rect.w * 100
          const height = o.placement.h * o.rect.h * 100
          return (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={o.linkId}
              src={o.artworkUrl}
              alt=""
              aria-hidden="true"
              style={{
                position: 'absolute',
                left: `${left}%`,
                top: `${top}%`,
                width: `${width}%`,
                height: `${height}%`,
                transform: `rotate(${o.placement.rotation_deg}deg)`,
                transformOrigin: 'top left',
                objectFit: 'contain',
                pointerEvents: 'none',
              }}
            />
          )
        })}
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
