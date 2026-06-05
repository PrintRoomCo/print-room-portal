import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ProductImageGallery, type GalleryImage } from '../ProductImageGallery'

vi.mock('next/image', () => ({
  default: ({
    alt = '',
    fill,
    priority,
    sizes,
    ...props
  }: {
    alt?: string
    fill?: boolean
    priority?: boolean
    sizes?: string
  }) => {
    void fill
    void priority
    void sizes
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img alt={alt} {...props} />
    )
  },
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

  it('shows applied artwork as a gallery thumbnail and omits blank master product thumbnails', () => {
    render(
      <ProductImageGallery
        images={[
          {
            id: 'catalogue-hero',
            url: '/decorated-product.png',
            view: 'hero',
            position: -100,
            color_swatch_id: 'bone',
            scope: 'catalogue',
            source: 'designer_snapshot',
          },
          {
            id: 'master-back',
            url: '/blank-back.png',
            view: 'back',
            position: 1,
            color_swatch_id: 'bone',
            scope: 'master',
          },
        ]}
        fallbackUrl={null}
        productName="Staple Tee"
        selectedColorSwatchId="bone"
        decorationImages={[
          {
            id: 'link-1',
            url: '/actual-artwork.png',
            label: 'Screen print - Left Chest',
            alt: 'Screen print artwork',
          },
        ]}
      />,
    )

    expect(screen.getByRole('tab', { name: 'View hero' })).toBeInTheDocument()
    expect(
      screen.getByRole('tab', { name: 'View artwork: Screen print - Left Chest' }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'View back' })).not.toBeInTheDocument()
  })

  it('still renders the product fallback image when no gallery images exist', () => {
    render(
      <ProductImageGallery
        images={[]}
        fallbackUrl="/fallback.png"
        productName="Fallback Tee"
        selectedColorSwatchId={null}
      />,
    )

    expect(screen.getByRole('img', { name: 'Fallback Tee' })).toHaveAttribute(
      'src',
      '/fallback.png',
    )
  })
})
