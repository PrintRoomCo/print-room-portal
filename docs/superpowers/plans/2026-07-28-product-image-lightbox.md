# Product-image Lightbox Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a click-to-enlarge, never-crop lightbox to the customer PDP product image and to the staff catalogue item preview, reusing the images each host already renders.

**Architecture:** Two small, independent `ImageLightbox` components — one per repo, **not shared** (customer uses the `pr-blue` design system; staff follows OEM rules). Both honour the same behaviour contract: a fixed `inset-0` overlay marked `role="dialog" aria-modal="true"`, image shown `object-contain` (never cropped), dismiss via Esc / backdrop / close button, focus moved in on open and returned to the trigger on close, body scroll locked, and prev/next controls only when there is more than one image. No DB, no Monday, no `submit.ts`, no schema change. Each repo ships independently.

**Tech Stack:** TypeScript, React (client components), Next (customer = Next 16; staff = custom Next), Tailwind, vitest. Customer tests use jsdom + `@testing-library/react` + `@testing-library/user-event` + `vitest-axe`. Staff tests use node-env vitest with `renderToStaticMarkup` (no jsdom, no testing-library, no axe).

## Global Constraints

- **No native modals.** Never use `<dialog>`, `alert()`, `confirm()`, or `prompt()`. The overlay is a plain `<div role="dialog" aria-modal="true">`. (These block the browser-automation session and can wedge the page.)
- **Never crop.** Enlarged image is always `object-contain` with `max-h-[90vh] max-w-[90vw]`. Landscape letterboxes; portrait pillarboxes.
- **No portal.** Render the overlay inline as `fixed inset-0 z-50`. (Deviation from the spec's "portal" wording — equivalent for these top-level page surfaces and it keeps the staff open-state renderable under `renderToStaticMarkup`.)
- **Pure client UI only.** No changes to caching, data-fetching, or view-transition APIs, so the `node_modules/next/dist/docs/` pre-read in either repo's AGENTS.md does not apply here.
- **Staff repo OEM rules** (`print-room-staff-portal/docs/ui/oem-rules.md`): zero `bg-gray-*` / `border-gray-*` / `text-gray-*`; backgrounds `bg-black/[0.0X]` or `bg-white`; pills/icon-buttons `rounded-full`; motion `transition-colors duration-300 ease-oem`; a visible `focus-visible:ring-2 focus-visible:ring-black/40` on every interactive element.
- **Customer repo** keeps the existing `pr-blue` / `gray-*` palette already used throughout `components/shop/`.
- **Independently deployable.** The customer half and the staff half touch no shared file and can ship in either order.
- Run each repo's command **from that repo's root**. Customer commands assume `cwd = print-room-portal`; staff commands assume `cwd = print-room-staff-portal`.

---

## Customer repo — `print-room-portal`

### File structure

- Create `components/shop/image-lightbox-helpers.ts` — pure index math (`nextIndex`, `prevIndex`, `hasMultiple`). One responsibility: cycling logic, unit-testable without a DOM.
- Create `components/shop/ImageLightbox.tsx` — the client overlay component.
- Modify `components/shop/ProductImageGallery.tsx` — turn the main image into a trigger button and mount the lightbox.
- Create tests under `components/shop/__tests__/`.

> **Test glob note:** `vitest.config.ts` includes `components/**/*.test.tsx` (not `.test.ts`). Every new customer test file below therefore ends in **`.test.tsx`**, even the pure-helper one.

---

### Task C1: Lightbox index helpers

**Files:**
- Create: `components/shop/image-lightbox-helpers.ts`
- Test: `components/shop/__tests__/image-lightbox-helpers.test.tsx`

**Interfaces:**
- Produces: `nextIndex(current: number, length: number): number`, `prevIndex(current: number, length: number): number`, `hasMultiple(length: number): boolean`.

- [ ] **Step 1: Write the failing test**

```tsx
// components/shop/__tests__/image-lightbox-helpers.test.tsx
import { describe, expect, it } from 'vitest'
import { hasMultiple, nextIndex, prevIndex } from '../image-lightbox-helpers'

describe('lightbox index helpers', () => {
  it('nextIndex wraps from last back to first', () => {
    expect(nextIndex(0, 3)).toBe(1)
    expect(nextIndex(2, 3)).toBe(0)
  })

  it('prevIndex wraps from first to last', () => {
    expect(prevIndex(0, 3)).toBe(2)
    expect(prevIndex(2, 3)).toBe(1)
  })

  it('helpers stay at 0 for an empty list', () => {
    expect(nextIndex(0, 0)).toBe(0)
    expect(prevIndex(0, 0)).toBe(0)
  })

  it('hasMultiple is true only when length > 1', () => {
    expect(hasMultiple(1)).toBe(false)
    expect(hasMultiple(2)).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run components/shop/__tests__/image-lightbox-helpers.test.tsx`
Expected: FAIL — cannot resolve `../image-lightbox-helpers`.

- [ ] **Step 3: Write minimal implementation**

```ts
// components/shop/image-lightbox-helpers.ts

/** Advance to the next image, wrapping past the end back to the start. */
export function nextIndex(current: number, length: number): number {
  if (length <= 0) return 0
  return (current + 1) % length
}

/** Step to the previous image, wrapping before the start round to the end. */
export function prevIndex(current: number, length: number): number {
  if (length <= 0) return 0
  return (current - 1 + length) % length
}

/** Whether prev/next controls should show at all. */
export function hasMultiple(length: number): boolean {
  return length > 1
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run components/shop/__tests__/image-lightbox-helpers.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add components/shop/image-lightbox-helpers.ts components/shop/__tests__/image-lightbox-helpers.test.tsx
git commit -m "feat(shop): add lightbox index helpers"
```

---

### Task C2: `ImageLightbox` component

**Files:**
- Create: `components/shop/ImageLightbox.tsx`
- Test: `components/shop/__tests__/ImageLightbox.test.tsx`

**Interfaces:**
- Consumes: `nextIndex`, `prevIndex`, `hasMultiple` from `./image-lightbox-helpers`.
- Produces: `LightboxImage = { url: string; alt: string; label: string }` and
  `ImageLightbox(props: { images: LightboxImage[]; initialIndex?: number; onClose: () => void }): JSX.Element | null`.
  The host mounts it **only while open** (no `open` prop); `onClose` fires on Esc, backdrop click, or the close button.

- [ ] **Step 1: Write the failing test**

```tsx
// components/shop/__tests__/ImageLightbox.test.tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'vitest-axe'
import { describe, expect, it, vi } from 'vitest'
import { ImageLightbox, type LightboxImage } from '../ImageLightbox'

const three: LightboxImage[] = [
  { url: '/front.png', alt: 'Tee front', label: 'front' },
  { url: '/back.png', alt: 'Tee back', label: 'back' },
  { url: '/side.png', alt: 'Tee side', label: 'side' },
]

describe('ImageLightbox', () => {
  it('renders an accessible modal dialog with the initial image', () => {
    render(<ImageLightbox images={three} initialIndex={1} onClose={() => {}} />)
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(screen.getByRole('img')).toHaveAttribute('src', '/back.png')
  })

  it('cycles images with the next/prev controls', async () => {
    const user = userEvent.setup()
    render(<ImageLightbox images={three} initialIndex={0} onClose={() => {}} />)
    await user.click(screen.getByRole('button', { name: 'Next image' }))
    expect(screen.getByRole('img')).toHaveAttribute('src', '/back.png')
    await user.click(screen.getByRole('button', { name: 'Previous image' }))
    expect(screen.getByRole('img')).toHaveAttribute('src', '/front.png')
  })

  it('hides prev/next for a single image', () => {
    render(<ImageLightbox images={[three[0]]} onClose={() => {}} />)
    expect(screen.queryByRole('button', { name: 'Next image' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Previous image' })).not.toBeInTheDocument()
  })

  it('closes on Escape, backdrop click, and the close button', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const { rerender } = render(<ImageLightbox images={three} onClose={onClose} />)

    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)

    rerender(<ImageLightbox images={three} onClose={onClose} />)
    await user.click(screen.getByRole('dialog'))
    expect(onClose).toHaveBeenCalledTimes(2)

    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(3)
  })

  it('moves focus into the dialog on open and traps Tab', async () => {
    const user = userEvent.setup()
    render(<ImageLightbox images={three} onClose={() => {}} />)
    const dialog = screen.getByRole('dialog')
    expect(dialog.contains(document.activeElement) || document.activeElement === dialog).toBe(true)
    // Shift+Tab from the first control wraps to the last.
    const buttons = screen.getAllByRole('button')
    buttons[0].focus()
    await user.keyboard('{Shift>}{Tab}{/Shift}')
    expect(buttons[buttons.length - 1]).toHaveFocus()
  })

  it('has no axe violations', async () => {
    const { container } = render(<ImageLightbox images={three} onClose={() => {}} />)
    expect(await axe(container)).toHaveNoViolations()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run components/shop/__tests__/ImageLightbox.test.tsx`
Expected: FAIL — cannot resolve `../ImageLightbox`.

- [ ] **Step 3: Write minimal implementation**

```tsx
// components/shop/ImageLightbox.tsx
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
        onClick={onClose}
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run components/shop/__tests__/ImageLightbox.test.tsx`
Expected: PASS (6 tests).

> If the axe test flags a contrast rule on the decorative glyph buttons, it will not — the glyphs are `aria-hidden` and every control carries an `aria-label`. If any violation appears, fix the markup, do not disable the rule.

- [ ] **Step 5: Commit**

```bash
git add components/shop/ImageLightbox.tsx components/shop/__tests__/ImageLightbox.test.tsx
git commit -m "feat(shop): add ImageLightbox overlay component"
```

---

### Task C3: Wire the lightbox into `ProductImageGallery`

**Files:**
- Modify: `components/shop/ProductImageGallery.tsx`
- Test: `components/shop/__tests__/ProductImageGallery.lightbox.test.tsx`

**Interfaces:**
- Consumes: `ImageLightbox`, `LightboxImage` from `./ImageLightbox`. Reuses the existing `galleryItems`, `activeItem`, `failedKeys` locals already in the file.
- Produces: no new export. The main image becomes a `<button aria-label={`Enlarge ${activeItem.alt}`}>` that opens the overlay at the active view.

- [ ] **Step 1: Write the failing test**

```tsx
// components/shop/__tests__/ProductImageGallery.lightbox.test.tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ProductImageGallery, type GalleryImage } from '../ProductImageGallery'

vi.mock('next/image', () => ({
  default: ({ alt = '', fill, priority, sizes, ...props }: Record<string, unknown>) => {
    void fill
    void priority
    void sizes
    // eslint-disable-next-line @next/next/no-img-element
    return <img alt={alt as string} {...props} />
  },
}))

const images: GalleryImage[] = [
  { id: 'front', url: '/front.png', view: 'front', position: 0 },
  { id: 'back', url: '/back.png', view: 'back', position: 1 },
]

function renderGallery() {
  render(
    <ProductImageGallery
      images={images}
      fallbackUrl={null}
      productName="Test product"
      selectedColorSwatchId={null}
    />,
  )
}

describe('ProductImageGallery lightbox', () => {
  it('opens the lightbox from the main image and returns focus on close', async () => {
    const user = userEvent.setup()
    renderGallery()

    const trigger = screen.getByRole('button', { name: 'Enlarge Test product' })
    await user.click(trigger)

    expect(screen.getByRole('dialog')).toBeInTheDocument()

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('keeps the thumbnail tablist working alongside the enlarge trigger', () => {
    renderGallery()
    expect(screen.getAllByRole('tab')).toHaveLength(2)
    expect(screen.getByRole('button', { name: 'Enlarge Test product' })).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run components/shop/__tests__/ProductImageGallery.lightbox.test.tsx`
Expected: FAIL — no button named "Enlarge Test product" (the main image is a bare `<Image>` today).

- [ ] **Step 3: Add the import**

At the top of `components/shop/ProductImageGallery.tsx`, below the existing `@/lib/shop/catalogue-images` import (around line 9), add:

```tsx
import { ImageLightbox } from './ImageLightbox'
```

- [ ] **Step 4: Add lightbox state**

Immediately after the `markFailed` helper (the block ending at line 137, just before `const activeItem = useMemo(`), insert:

```tsx
  const [lightboxOpen, setLightboxOpen] = useState(false)
```

- [ ] **Step 5: Add the lightbox image list**

Immediately after the `activeItem` `useMemo` (ends line 141), insert:

```tsx
  const lightboxImages = useMemo(
    () =>
      galleryItems
        .filter((item) => !failedKeys.has(item.key))
        .map((item) => ({ url: item.url, alt: item.alt, label: item.label })),
    [galleryItems, failedKeys],
  )
  const lightboxIndex = Math.max(
    0,
    lightboxImages.findIndex((image) => image.url === activeItem?.url),
  )
```

- [ ] **Step 6: Turn the main image into a trigger button**

Replace the main-image `else` branch (lines 210-221, the `<Image … />` rendered when the active image has **not** failed):

```tsx
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
```

with:

```tsx
        ) : (
          <button
            type="button"
            onClick={() => setLightboxOpen(true)}
            aria-label={`Enlarge ${activeItem.alt}`}
            className="absolute inset-0 h-full w-full cursor-zoom-in focus:outline-none focus-visible:ring-2 focus-visible:ring-pr-blue"
          >
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
          </button>
        )}
```

- [ ] **Step 7: Mount the lightbox**

Right after the main-image container `</div>` (line 248) and before `{galleryItems.length > 1 && (`, insert:

```tsx
      {lightboxOpen && lightboxImages.length > 0 && (
        <ImageLightbox
          images={lightboxImages}
          initialIndex={lightboxIndex}
          onClose={() => setLightboxOpen(false)}
        />
      )}
```

- [ ] **Step 8: Run the new test + the existing gallery test**

Run: `npx vitest run components/shop/__tests__/ProductImageGallery.lightbox.test.tsx components/shop/__tests__/ProductImageGallery.keyboard.test.tsx`
Expected: PASS (both files — the keyboard/thumbnail behaviour is unchanged).

- [ ] **Step 9: Typecheck**

Run: `npx tsc --noEmit`
Expected: no **new** errors from these files. (Compare against the repo's known baseline; do not chase pre-existing errors.)

- [ ] **Step 10: Commit**

```bash
git add components/shop/ProductImageGallery.tsx components/shop/__tests__/ProductImageGallery.lightbox.test.tsx
git commit -m "feat(shop): open image lightbox from the PDP main image"
```

---

## Staff repo — `print-room-staff-portal`

### File structure

- Create `src/components/catalogues/ImageLightbox.tsx` — OEM-styled client overlay, same behaviour contract, plus exported pure index helpers for node tests.
- Modify `src/components/catalogues/VariantCard.tsx` — add an optional `onEnlarge` seam so an image cell can open the overlay.
- Modify `src/components/catalogues/VariantsHero.tsx` — own the lightbox state, pass `onEnlarge`, mount the overlay.
- Create tests colocated in `src/components/catalogues/`.

> **Testing reality:** the staff vitest run is **node-env** (`renderToStaticMarkup`, no jsdom/testing-library/axe). Interactive open/close is therefore verified structurally (SSR markup asserts `role`/`aria`/controls) and via the customer repo's identical behaviour contract; the pure index math is unit-tested directly. `VariantsHero`'s state plumbing is trivial and, like the rest of that component today, is covered by manual smoke rather than a node test.

---

### Task S1: Staff `ImageLightbox` + index helpers

**Files:**
- Create: `src/components/catalogues/ImageLightbox.tsx`
- Test: `src/components/catalogues/ImageLightbox.test.tsx`

**Interfaces:**
- Produces: `LightboxImage = { url: string; alt: string }`;
  `ImageLightbox(props: { images: LightboxImage[]; initialIndex?: number; onClose: () => void }): JSX.Element | null`;
  and pure helpers `nextLightboxIndex(current: number, length: number): number`, `prevLightboxIndex(current: number, length: number): number` (exported from the same module, mirroring how `VariantCard` exports `wrapIndex`).

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/catalogues/ImageLightbox.test.tsx
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ImageLightbox, nextLightboxIndex, prevLightboxIndex } from './ImageLightbox'

// Icons render to nothing in this node-env structural test.
vi.mock('lucide-react', () => ({
  __esModule: true,
  X: () => null,
  ChevronLeft: () => null,
  ChevronRight: () => null,
}))

describe('staff lightbox index helpers', () => {
  it('wraps forward and backward', () => {
    expect(nextLightboxIndex(2, 3)).toBe(0)
    expect(prevLightboxIndex(0, 3)).toBe(2)
  })
  it('stays at 0 for an empty list', () => {
    expect(nextLightboxIndex(0, 0)).toBe(0)
    expect(prevLightboxIndex(0, 0)).toBe(0)
  })
})

describe('staff ImageLightbox structure', () => {
  it('renders a modal dialog with the image and a close control', () => {
    const html = renderToStaticMarkup(
      <ImageLightbox images={[{ url: '/a.png', alt: 'Black — Front' }]} onClose={() => {}} />,
    )
    expect(html).toContain('role="dialog"')
    expect(html).toContain('aria-modal="true"')
    expect(html).toContain('src="/a.png"')
    expect(html).toContain('alt="Black — Front"')
    expect(html).toContain('aria-label="Close"')
  })

  it('omits prev/next for a single image', () => {
    const html = renderToStaticMarkup(
      <ImageLightbox images={[{ url: '/a.png', alt: 'A' }]} onClose={() => {}} />,
    )
    expect(html).not.toContain('aria-label="Previous image"')
    expect(html).not.toContain('aria-label="Next image"')
  })

  it('shows prev/next for multiple images', () => {
    const html = renderToStaticMarkup(
      <ImageLightbox
        images={[
          { url: '/a.png', alt: 'A' },
          { url: '/b.png', alt: 'B' },
        ]}
        onClose={() => {}}
      />,
    )
    expect(html).toContain('aria-label="Previous image"')
    expect(html).toContain('aria-label="Next image"')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/catalogues/ImageLightbox.test.tsx`
Expected: FAIL — cannot resolve `./ImageLightbox`.

- [ ] **Step 3: Write minimal implementation**

```tsx
// src/components/catalogues/ImageLightbox.tsx
'use client'

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { ChevronLeft, ChevronRight, X } from 'lucide-react'

export interface LightboxImage {
  url: string
  alt: string
}

/** Advance to the next image, wrapping at the end. Exported for unit tests. */
export function nextLightboxIndex(current: number, length: number): number {
  if (length <= 0) return 0
  return (current + 1) % length
}

/** Step to the previous image, wrapping at the start. Exported for unit tests. */
export function prevLightboxIndex(current: number, length: number): number {
  if (length <= 0) return 0
  return (current - 1 + length) % length
}

const CONTROL =
  'flex items-center justify-center rounded-full border border-black/10 bg-white/90 text-black/70 shadow-sm transition-colors duration-300 ease-oem hover:bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-black/40'

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
  const multi = images.length > 1
  const current = images[index] ?? images[0]

  const goPrev = useCallback(() => setIndex((i) => prevLightboxIndex(i, images.length)), [images.length])
  const goNext = useCallback(() => setIndex((i) => nextLightboxIndex(i, images.length)), [images.length])

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
    if (!multi) return
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 outline-none"
    >
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className={`absolute right-4 top-4 h-10 w-10 ${CONTROL}`}
      >
        <X className="h-5 w-5" aria-hidden />
      </button>

      {multi && (
        <button
          type="button"
          aria-label="Previous image"
          onClick={(e) => {
            e.stopPropagation()
            goPrev()
          }}
          className={`absolute left-4 top-1/2 h-11 w-11 -translate-y-1/2 ${CONTROL}`}
        >
          <ChevronLeft className="h-5 w-5" aria-hidden />
        </button>
      )}

      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={current.url}
        alt={current.alt}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[90vh] max-w-[90vw] object-contain"
      />

      {multi && (
        <button
          type="button"
          aria-label="Next image"
          onClick={(e) => {
            e.stopPropagation()
            goNext()
          }}
          className={`absolute right-4 top-1/2 h-11 w-11 -translate-y-1/2 ${CONTROL}`}
        >
          <ChevronRight className="h-5 w-5" aria-hidden />
        </button>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/catalogues/ImageLightbox.test.tsx`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/catalogues/ImageLightbox.tsx src/components/catalogues/ImageLightbox.test.tsx
git commit -m "feat(catalogues): add OEM ImageLightbox overlay"
```

---

### Task S2: `onEnlarge` seam on `VariantCard`

**Files:**
- Modify: `src/components/catalogues/VariantCard.tsx`
- Test: `src/components/catalogues/VariantCard.enlarge.test.tsx`

**Interfaces:**
- Produces: a new optional prop on `VariantCardProps` —
  `onEnlarge?: (image: { url: string; alt: string }) => void`.
  When provided **and** the active cell has an `imageUrl`, the image is wrapped in a
  `<button aria-label={`Enlarge ${swatch.label} — ${viewLabel(cell.view)}`}>` that calls
  `onEnlarge({ url: cell.imageUrl, alt: `${swatch.label} — ${viewLabel(cell.view)}` })`.
  Omitting the prop leaves the current markup unchanged (existing `VariantCard.test.tsx` stays green).

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/catalogues/VariantCard.enlarge.test.tsx
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { VariantCard, type ViewCell } from './VariantCard'

// VariantCard imports next/image at module scope; stub it for this node render.
vi.mock('next/image', () => ({ __esModule: true, default: () => null }))

const views: ViewCell[] = [
  { view: 'front', imageUrl: '/f.png', isSnapshot: false, isPublished: true },
]

describe('VariantCard enlarge seam', () => {
  it('wraps the image in an enlarge button when onEnlarge is provided', () => {
    const html = renderToStaticMarkup(
      <VariantCard swatch={{ label: 'Black', hex: '#000000' }} views={views} onEnlarge={() => {}} />,
    )
    expect(html).toContain('aria-label="Enlarge Black — Front"')
  })

  it('renders no enlarge button when onEnlarge is omitted', () => {
    const html = renderToStaticMarkup(
      <VariantCard swatch={{ label: 'Black', hex: '#000000' }} views={views} />,
    )
    expect(html).not.toContain('aria-label="Enlarge')
  })

  it('renders no enlarge button when the cell has no image', () => {
    const html = renderToStaticMarkup(
      <VariantCard
        swatch={{ label: 'Black', hex: '#000000' }}
        views={[{ view: 'front', imageUrl: null, isSnapshot: false, isPublished: null }]}
        onEnlarge={() => {}}
      />,
    )
    expect(html).not.toContain('aria-label="Enlarge')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/catalogues/VariantCard.enlarge.test.tsx`
Expected: FAIL — no "Enlarge Black — Front" label (the image is a bare `<Image>` today).

- [ ] **Step 3: Add the prop to the interface**

In `VariantCardProps` (ends at line 38, after `renderHeaderAction`), add:

```tsx
  /** When set, an image cell becomes click-to-enlarge; the host opens the
   *  lightbox with the given image. Omitted → image is non-interactive. */
  onEnlarge?: (image: { url: string; alt: string }) => void
```

- [ ] **Step 4: Destructure the prop**

Change the component signature (line 51) from:

```tsx
export function VariantCard({ swatch, views, badge, renderAction, renderCorner, renderFooter, renderHeaderAction }: VariantCardProps) {
```

to:

```tsx
export function VariantCard({ swatch, views, badge, renderAction, renderCorner, renderFooter, renderHeaderAction, onEnlarge }: VariantCardProps) {
```

- [ ] **Step 5: Wrap the active image when `onEnlarge` is set**

Replace the image branch (lines 68-83, the `cell.imageUrl && !failed.has(...)` `<Image>` block) with a version that conditionally wraps the image in an enlarge button. The `<Image>` markup itself is unchanged — only the optional wrapper is added:

```tsx
        {cell.imageUrl && !failed.has(`${cell.view}:${cell.imageUrl}`) ? (
          (() => {
            const img = (
              <Image
                src={cell.imageUrl}
                alt={`${swatch.label} — ${viewLabel(cell.view)}`}
                width={480}
                height={480}
                className={`h-full w-full object-contain transition-opacity duration-300 ease-oem ${cell.hidden ? 'opacity-40' : ''}`}
                unoptimized
                onError={() =>
                  setFailed((prev) => {
                    const next = new Set(prev)
                    next.add(`${cell.view}:${cell.imageUrl}`)
                    return next
                  })
                }
              />
            )
            const label = `${swatch.label} — ${viewLabel(cell.view)}`
            return onEnlarge ? (
              <button
                type="button"
                aria-label={`Enlarge ${label}`}
                onClick={() => onEnlarge({ url: cell.imageUrl!, alt: label })}
                className="absolute inset-0 h-full w-full cursor-zoom-in focus:outline-none focus-visible:ring-2 focus-visible:ring-black/40"
              >
                {img}
              </button>
            ) : (
              img
            )
          })()
        ) : (
          <div className="flex h-full w-full items-center justify-center text-xs text-black/40">
            No image for this view
          </div>
        )}
```

- [ ] **Step 6: Run the new test + the existing VariantCard test**

Run: `npx vitest run src/components/catalogues/VariantCard.enlarge.test.tsx src/components/catalogues/VariantCard.test.tsx`
Expected: PASS (both files — the existing suite is unaffected since `onEnlarge` defaults to undefined).

- [ ] **Step 7: Commit**

```bash
git add src/components/catalogues/VariantCard.tsx src/components/catalogues/VariantCard.enlarge.test.tsx
git commit -m "feat(catalogues): add onEnlarge seam to VariantCard image cell"
```

---

### Task S3: Mount the lightbox in `VariantsHero`

**Files:**
- Modify: `src/components/catalogues/VariantsHero.tsx`

**Interfaces:**
- Consumes: `ImageLightbox` from `./ImageLightbox`; the `onEnlarge` prop added to `VariantCard` in Task S2.
- Produces: no new export. `VariantsHero` holds `lightbox` state (`{ url; alt } | null`), passes `onEnlarge` to every `VariantCard`, and mounts a single-image `ImageLightbox` while open.

- [ ] **Step 1: Add the import**

Below the existing `import { VariantCard, type ViewCell } from './VariantCard'` (line 6), add:

```tsx
import { ImageLightbox } from './ImageLightbox'
```

- [ ] **Step 2: Add lightbox state**

After `const [cardError, setCardError] = useState<string | null>(null)` (line 78), add:

```tsx
  const [lightbox, setLightbox] = useState<{ url: string; alt: string } | null>(null)
```

- [ ] **Step 3: Pass `onEnlarge` to each card**

On the `<VariantCard` element (opening at line 217), add the prop alongside the existing ones (e.g. directly after `views={variant.views}`):

```tsx
              onEnlarge={(image) => setLightbox(image)}
```

- [ ] **Step 4: Mount the overlay**

Immediately before the closing `</section>` (line 447), add:

```tsx
      {lightbox && (
        <ImageLightbox images={[lightbox]} onClose={() => setLightbox(null)} />
      )}
```

- [ ] **Step 5: Typecheck + full staff suite**

Run: `npx tsc --noEmit`
Expected: no **new** errors (compare to baseline).

Run: `npx vitest run src/components/catalogues/`
Expected: PASS — the new lightbox/enlarge tests plus the pre-existing `VariantCard`/`VariantsHero` tests.

- [ ] **Step 6: Commit**

```bash
git add src/components/catalogues/VariantsHero.tsx
git commit -m "feat(catalogues): enlarge item preview images via lightbox"
```

---

## Manual smoke (after both halves deploy — do in either order)

1. **Customer PDP:** open a product with a landscape image → the main image shows letterboxed (not cropped). Click it → overlay opens, image fits the viewport uncropped. Esc, backdrop click, and × all close it; focus returns to the image. For a multi-view product, ‹ / › and arrow keys cycle views; a single-view product shows no arrows.
2. **Staff catalogue item:** open an item with variant images → click a variant image cell → the same overlay opens with that image; Esc/backdrop/× close it. Navigate the card's own ‹ / › to change view, then enlarge the new view.
3. Confirm no console errors and that body scroll is locked while the overlay is open in both surfaces.

---

## Self-review notes (done at plan-writing time)

- **Spec coverage:** PDP click-to-enlarge → C2+C3; staff preview enlarge → S1+S2+S3; landscape "not cropped" → `object-contain` in every render path (host galleries already `object-contain`; overlay adds `max-h/max-w object-contain`). The spec's "display audit" is a confirmed non-event (both host galleries already `object-contain`; `ProofArchiveCard`'s `object-cover` is out of scope and untouched).
- **Deliberate spec deviations:** (a) no portal — inline `fixed inset-0` overlay, rationale in Global Constraints; (b) staff surface is per-view image cells, not one hero image, so the enlarge trigger lives on `VariantCard` via the `onEnlarge` seam rather than on a single hero element.
- **Out of scope, unchanged:** Monday-proof loop, `submit.ts`, proof pipeline, any DB/schema, pinch/pan zoom.
- **Type consistency:** customer `LightboxImage = { url; alt; label }` (label carried for future captioning, currently unused by the overlay body — kept to match `galleryItems` shape); staff `LightboxImage = { url; alt }`. Helper names differ by repo (`nextIndex`/`prevIndex` customer; `nextLightboxIndex`/`prevLightboxIndex` staff) because they live in different modules — intentional, not a mismatch.
