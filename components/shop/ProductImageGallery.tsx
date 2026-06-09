'use client'

import Image from 'next/image'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import {
  pickPreferredGalleryImageUrl,
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

export interface GalleryDecorationImage {
  id: string
  url: string
  label: string
  alt: string
}

interface Props {
  images: GalleryImage[]
  fallbackUrl: string | null
  productName: string
  selectedColorSwatchId: string | null
  overlays?: GalleryOverlay[]
  decorationImages?: GalleryDecorationImage[]
}

type GalleryItem =
  | {
      kind: 'product'
      key: string
      url: string
      label: string
      alt: string
      image: GalleryImage
    }
  | {
      kind: 'fallback'
      key: string
      url: string
      label: string
      alt: string
    }
  | {
      kind: 'decoration'
      key: string
      url: string
      label: string
      alt: string
    }

export function ProductImageGallery({
  images,
  fallbackUrl,
  productName,
  selectedColorSwatchId,
  overlays = [],
  decorationImages = [],
}: Props) {
  const ordered = useMemo(
    () => resolveGalleryImagesForColour(images, selectedColorSwatchId),
    [images, selectedColorSwatchId],
  )
  const galleryItems = useMemo<GalleryItem[]>(
    () => [
      ...ordered.map((image) => ({
        kind: 'product' as const,
        key: `product:${image.id}`,
        url: image.url,
        label: image.view ?? 'image',
        alt: productName,
        image,
      })),
      ...(ordered.length === 0 && fallbackUrl
        ? [
            {
              kind: 'fallback' as const,
              key: 'fallback',
              url: fallbackUrl,
              label: 'image',
              alt: productName,
            },
          ]
        : []),
      ...decorationImages
        .filter((image) => image.url)
        .map((image) => ({
          kind: 'decoration' as const,
          key: `decoration:${image.id}`,
          url: image.url,
          label: `artwork: ${image.label}`,
          alt: image.alt,
        })),
    ],
    [decorationImages, fallbackUrl, ordered, productName],
  )
  const preferredKey = useMemo(() => {
    const preferredUrl = pickPreferredGalleryImageUrl(
      images,
      selectedColorSwatchId,
      fallbackUrl,
    )
    return (
      galleryItems.find((item) => item.url === preferredUrl)?.key ??
      galleryItems[0]?.key ??
      null
    )
  }, [fallbackUrl, galleryItems, images, selectedColorSwatchId])
  const [activeKey, setActiveKey] = useState<string | null>(() => preferredKey)
  // A gallery image can point at a now-deleted upstream (e.g. a discontinued
  // garment pruned from the old BigCommerce store). Degrade a dead URL to the
  // "No image" placeholder instead of rendering a broken image.
  const [failedKeys, setFailedKeys] = useState<Set<string>>(new Set())
  const markFailed = (key: string) =>
    setFailedKeys((prev) => {
      const next = new Set(prev)
      next.add(key)
      return next
    })
  const activeItem = useMemo(
    () => galleryItems.find((item) => item.key === activeKey) ?? galleryItems[0] ?? null,
    [activeKey, galleryItems],
  )
  const prevColorRef = useRef(selectedColorSwatchId)

  useEffect(() => {
    const colourChanged = prevColorRef.current !== selectedColorSwatchId
    prevColorRef.current = selectedColorSwatchId
    setActiveKey((current) => {
      if (!colourChanged && current && galleryItems.some((item) => item.key === current)) {
        return current
      }
      return preferredKey
    })
  }, [galleryItems, preferredKey, selectedColorSwatchId])

  const activeImage = activeItem?.kind === 'product' ? activeItem.image : null
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

  if (!activeItem) {
    return (
      <div className="relative aspect-square w-full overflow-hidden rounded-2xl border border-gray-100 bg-gray-50">
        <div className="flex h-full items-center justify-center text-gray-300">No image</div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="relative aspect-square w-full overflow-hidden rounded-2xl border border-gray-100 bg-gray-50">
        {failedKeys.has(activeItem.key) ? (
          <div className="flex h-full items-center justify-center text-gray-300">No image</div>
        ) : (
          <Image
            key={activeItem.key}
            src={activeItem.url}
            alt={activeItem.alt}
            fill
            sizes="(min-width:1024px) 40vw, 100vw"
            className="object-contain p-6"
            priority
            onError={() => markFailed(activeItem.key)}
          />
        )}
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
      {galleryItems.length > 1 && (
        <div
          className="flex flex-wrap gap-2"
          role="tablist"
          aria-label="Product views"
          tabIndex={-1}
          onKeyDown={handleThumbnailKeyDown}
        >
          {galleryItems.map((item) => {
            const isActive = item.key === activeKey
            return (
              <button
                key={item.key}
                type="button"
                role="tab"
                aria-selected={isActive}
                aria-label={`View ${item.label}`}
                tabIndex={isActive ? 0 : -1}
                onClick={() => setActiveKey(item.key)}
                className={
                  'relative h-16 w-16 overflow-hidden rounded-lg border bg-white transition ' +
                  (isActive
                    ? 'border-pr-blue ring-2 ring-pr-blue/30'
                    : 'border-gray-200 hover:border-gray-300')
                }
              >
                {failedKeys.has(item.key) ? (
                  <span className="flex h-full w-full items-center justify-center text-[8px] text-gray-300">
                    —
                  </span>
                ) : (
                  <Image
                    src={item.url}
                    alt=""
                    fill
                    sizes="64px"
                    className="object-contain p-1"
                    onError={() => markFailed(item.key)}
                  />
                )}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
