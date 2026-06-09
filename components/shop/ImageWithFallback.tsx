'use client'

import Image from 'next/image'
import { useState, type ComponentProps, type ReactNode } from 'react'

type ImageProps = ComponentProps<typeof Image>

/**
 * next/image that degrades to `fallback` when the source fails to load.
 *
 * Used for product imagery that can point at a now-deleted upstream (e.g. a
 * discontinued garment pruned from the old BigCommerce store) — a dead URL
 * should show the "No image" placeholder, never a broken image icon. Lets
 * server components (e.g. ProductCard) get onError fallback without becoming
 * client components themselves.
 */
export function ImageWithFallback({
  src,
  alt,
  fallback,
  ...rest
}: Omit<ImageProps, 'onError'> & { fallback: ReactNode }) {
  const [failed, setFailed] = useState(false)
  if (!src || failed) return <>{fallback}</>
  return <Image src={src} alt={alt} onError={() => setFailed(true)} {...rest} />
}
