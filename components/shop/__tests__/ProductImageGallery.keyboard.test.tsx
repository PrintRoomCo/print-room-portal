import { render, screen, waitFor } from '@testing-library/react'
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

// Three distinct canonical views — `hero` and `front` would now collapse into the
// one `front` slot (PR5 canonicalisation), so keyboard nav is exercised with
// genuinely separate views instead.
const images: GalleryImage[] = [
  { id: 'front', url: '/front.png', view: 'front', position: 0 },
  { id: 'back', url: '/back.png', view: 'back', position: 1 },
  { id: 'side', url: '/side.png', view: 'side', position: 2 },
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

    let tabs = screen.getAllByRole('tab')
    expect(tabs).toHaveLength(3)
    tabs[0].focus()

    await user.keyboard('{ArrowRight}')
    tabs = screen.getAllByRole('tab')
    expect(tabs[1]).toHaveFocus()

    await user.keyboard('{Home}')
    tabs = screen.getAllByRole('tab')
    expect(tabs[0]).toHaveFocus()

    await user.keyboard('{End}')
    tabs = screen.getAllByRole('tab')
    expect(tabs[2]).toHaveFocus()

    await user.keyboard('{ArrowLeft}')
    tabs = screen.getAllByRole('tab')
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
            // A blank, null-colour master back — the generic fallback that must be
            // dropped once a catalogue image exists. (A colour-MATCHED master back
            // is instead kept, per the Forest Green fix; that path is covered in
            // catalogue-images.test.ts.)
            id: 'master-back',
            url: '/blank-back.png',
            view: 'back',
            position: 1,
            color_swatch_id: null,
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

  it('keeps same-view images in Merchandised order and resets to the first image on colour change', async () => {
    const galleryImages: GalleryImage[] = [
      {
        id: 'red-second',
        url: '/red-second.png',
        view: 'front',
        position: 0,
        gallery_position: 2,
        color_swatch_id: 'red',
        scope: 'catalogue',
      },
      {
        id: 'neutral-first',
        url: '/neutral-first.png',
        view: 'front',
        position: 5,
        gallery_position: 0,
        color_swatch_id: null,
        scope: 'master',
      },
      {
        id: 'blue-first',
        url: '/blue-first.png',
        view: 'front',
        position: 1,
        gallery_position: 1,
        color_swatch_id: 'blue',
        scope: 'catalogue',
      },
    ]
    const { rerender } = render(
      <ProductImageGallery
        images={galleryImages}
        fallbackUrl={null}
        productName="Merch tee"
        selectedColorSwatchId="red"
        imageLayout="merchandised_gallery"
      />,
    )

    expect(screen.getAllByRole('tab')).toHaveLength(2)
    expect(
      screen.getByRole('button', { name: 'Enlarge Merch tee' })
        .querySelector('img'),
    ).toHaveAttribute('src', '/neutral-first.png')

    await userEvent.click(screen.getAllByRole('tab')[1])
    expect(
      screen.getByRole('button', { name: 'Enlarge Merch tee' })
        .querySelector('img'),
    ).toHaveAttribute('src', '/red-second.png')

    rerender(
      <ProductImageGallery
        images={galleryImages}
        fallbackUrl={null}
        productName="Merch tee"
        selectedColorSwatchId="blue"
        imageLayout="merchandised_gallery"
      />,
    )

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'Enlarge Merch tee' })
          .querySelector('img'),
      ).toHaveAttribute('src', '/neutral-first.png')
    })
  })
})
