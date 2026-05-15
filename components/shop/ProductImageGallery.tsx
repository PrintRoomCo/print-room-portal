'use client'

import Image from 'next/image'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import {
  resolveGalleryImagesForColour,
  type CatalogueAwareGalleryImage,
} from '@/lib/shop/catalogue-images'

export type GalleryImage = CatalogueAwareGalleryImage

export interface GalleryOverlay {
  linkId: string
  // product_images.id this rect is anchored to. Matched against the
  // currently-displayed gallery image's id. Catalogue-item images live in
  // a different id space, so they never match — which is correct, since
  // those are already-baked snapshots that shouldn't be overlaid.
  imageId: string
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
  // Pick the colour-matched candidate up front so the initial mount lands on
  // a colour-specific image when one exists, instead of the generic hero.
  const pickHero = (
    list: CatalogueAwareGalleryImage[],
    colourId: string | null,
  ) => {
    if (colourId) {
      const match = list.find((img) => img.color_swatch_id === colourId)
      if (match) return match.url
    }
    return list[0]?.url ?? fallbackUrl ?? null
  }
  const [activeUrl, setActiveUrl] = useState<string | null>(() =>
    pickHero(ordered, selectedColorSwatchId),
  )
  const prevColorRef = useRef(selectedColorSwatchId)

  useEffect(() => {
    const colourChanged = prevColorRef.current !== selectedColorSwatchId
    prevColorRef.current = selectedColorSwatchId
    if (colourChanged) {
      // Swatch selection moved — jump the hero to the new colour's first
      // matched image. Falls back to ordered[0]/fallback when the new colour
      // has no per-colour images uploaded yet.
      setActiveUrl(pickHero(ordered, selectedColorSwatchId))
      return
    }
    // Same colour, ordered may have shifted because images prop changed —
    // keep current activeUrl if still valid, else reset.
    const urls = new Set(ordered.map((img) => img.url))
    setActiveUrl((current) => {
      if (current && urls.has(current)) return current
      return pickHero(ordered, selectedColorSwatchId)
    })
    // pickHero is locally defined and closes over fallbackUrl — deps below
    // capture the inputs that drive image resolution.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fallbackUrl, ordered, selectedColorSwatchId])

  const activeImage = useMemo(
    () => ordered.find((img) => img.url === activeUrl) ?? null,
    [ordered, activeUrl],
  )
  // A designer_snapshot already has decorations baked in by staff — overlaying
  // live artwork on top would double-render (and any CDN/browser cache lag on
  // the snapshot URL would offset the two copies). Trust the snapshot as-is.
  const activeOverlays = useMemo(
    () =>
      activeImage && activeImage.source !== 'designer_snapshot'
        ? overlays.filter((o) => o.imageId === activeImage.id)
        : [],
    [overlays, activeImage],
  )

  function handleThumbnailKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (
      event.key !== 'ArrowRight' &&
      event.key !== 'ArrowLeft' &&
      event.key !== 'Home' &&
      event.key !== 'End'
    ) {
      return
    }

    event.preventDefault()
    const buttons = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
    )
    if (buttons.length === 0) return

    const currentIndex = buttons.findIndex((button) => button === document.activeElement)
    const activeIndex = Math.max(currentIndex, 0)
    let nextIndex = activeIndex

    if (event.key === 'ArrowRight') nextIndex = (activeIndex + 1) % buttons.length
    if (event.key === 'ArrowLeft') nextIndex = (activeIndex - 1 + buttons.length) % buttons.length
    if (event.key === 'Home') nextIndex = 0
    if (event.key === 'End') nextIndex = buttons.length - 1

    const nextButton = buttons[nextIndex]
    nextButton?.focus()
    nextButton?.click()
  }

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
        <div
          className="flex flex-wrap gap-2"
          role="tablist"
          aria-label="Product views"
          onKeyDown={handleThumbnailKeyDown}
        >
          {ordered.map((img) => {
            const isActive = img.url === activeUrl
            return (
              <button
                key={img.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                aria-label={`View ${img.view ?? 'image'}`}
                tabIndex={isActive ? 0 : -1}
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
