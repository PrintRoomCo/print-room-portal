import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ProductImageGallery, type GalleryImage } from '../ProductImageGallery'

vi.mock('next/image', () => ({
  default: ({
    alt = '',
    fill: _fill,
    priority: _priority,
    sizes: _sizes,
    ...props
  }: {
    alt?: string
    fill?: boolean
    priority?: boolean
    sizes?: string
  }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img alt={alt} {...props} />
  ),
}))

const images: GalleryImage[] = [
  { id: 'hero', url: '/hero.png', view: 'hero', position: 0 },
  { id: 'front', url: '/front.png', view: 'front', position: 1 },
  { id: 'back', url: '/back.png', view: 'back', position: 2 },
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

describe('ProductImageGallery keyboard navigation', () => {
  it('moves focus between thumbnails with arrow keys', async () => {
    const user = userEvent.setup()
    renderGallery()

    const tabs = screen.getAllByRole('tab')
    tabs[0].focus()

    await user.keyboard('{ArrowRight}')
    expect(tabs[1]).toHaveFocus()

    await user.keyboard('{Home}')
    expect(tabs[0]).toHaveFocus()

    await user.keyboard('{End}')
    expect(tabs[2]).toHaveFocus()

    await user.keyboard('{ArrowLeft}')
    expect(tabs[1]).toHaveFocus()
  })
})
