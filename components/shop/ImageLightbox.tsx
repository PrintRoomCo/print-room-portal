'use client'

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { hasMultiple, nextIndex, prevIndex } from './image-lightbox-helpers'

export interface LightboxImage {
  url: string
  alt: string
  label: string
}

const CONTROL =
  'flex items-center justify-center rounded-full bg-white/90 text-gray-700 shadow-sm transition hover:bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white'

export function ImageLightbox({
  images,
  initialIndex = 0,
  onClose,
}: {
  images: LightboxImage[]
  initialIndex?: number
  onClose: () => void
}) {
  const [index, setIndex] = useState(initialIndex)
  const dialogRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<Element | null>(null)
  const showArrows = hasMultiple(images.length)
  const current = images[index] ?? images[0]

  const goPrev = useCallback(() => setIndex((i) => prevIndex(i, images.length)), [images.length])
  const goNext = useCallback(() => setIndex((i) => nextIndex(i, images.length)), [images.length])

  // On open: remember the trigger, focus the dialog, lock body scroll. On close
  // (unmount): restore scroll and return focus to whatever opened us.
  useEffect(() => {
    triggerRef.current = document.activeElement
    dialogRef.current?.focus()
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prevOverflow
      if (triggerRef.current instanceof HTMLElement) triggerRef.current.focus()
    }
  }, [])

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
      return
    }
    if (event.key === 'Tab') {
      const focusables = dialogRef.current?.querySelectorAll<HTMLElement>('button')
      if (!focusables || focusables.length === 0) return
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
      return
    }
    if (!showArrows) return
    if (event.key === 'ArrowRight') {
      event.preventDefault()
      goNext()
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault()
      goPrev()
    }
  }

  if (!current) return null

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label="Enlarged product image"
      tabIndex={-1}
      onKeyDown={onKeyDown}
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 outline-none"
    >
      <button
        type="button"
        aria-label="Close"
        onClick={(e) => {
          e.stopPropagation()
          onClose()
        }}
        className={`absolute right-4 top-4 h-10 w-10 ${CONTROL}`}
      >
        <span aria-hidden className="text-xl leading-none">×</span>
      </button>

      {showArrows && (
        <button
          type="button"
          aria-label="Previous image"
          onClick={(e) => {
            e.stopPropagation()
            goPrev()
          }}
          className={`absolute left-4 top-1/2 h-11 w-11 -translate-y-1/2 ${CONTROL}`}
        >
          <span aria-hidden className="text-2xl leading-none">‹</span>
        </button>
      )}

      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={current.url}
        alt={current.alt}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[90vh] max-w-[90vw] object-contain"
      />

      {showArrows && (
        <button
          type="button"
          aria-label="Next image"
          onClick={(e) => {
            e.stopPropagation()
            goNext()
          }}
          className={`absolute right-4 top-1/2 h-11 w-11 -translate-y-1/2 ${CONTROL}`}
        >
          <span aria-hidden className="text-2xl leading-none">›</span>
        </button>
      )}
    </div>
  )
}
