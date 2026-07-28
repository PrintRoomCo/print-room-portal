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
