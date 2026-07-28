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

  it('opens the lightbox at the first Merchandised image and preserves union order', async () => {
    const user = userEvent.setup()
    render(
      <ProductImageGallery
        images={[
          {
            id: 'second',
            url: '/second.png',
            view: 'front',
            position: 0,
            gallery_position: 1,
          },
          {
            id: 'first',
            url: '/first.png',
            view: 'front',
            position: 9,
            gallery_position: 0,
          },
        ]}
        fallbackUrl={null}
        productName="Merch product"
        selectedColorSwatchId={null}
        imageLayout="merchandised_gallery"
      />,
    )

    await user.click(
      screen.getByRole('button', { name: 'Enlarge Merch product' }),
    )
    expect(screen.getByRole('dialog').querySelector('img')).toHaveAttribute(
      'src',
      '/first.png',
    )
    await user.click(screen.getByRole('button', { name: 'Next image' }))
    expect(screen.getByRole('dialog').querySelector('img')).toHaveAttribute(
      'src',
      '/second.png',
    )
  })

  it('matches live overlays against the raw master image id and never overlays a snapshot', () => {
    const { container, rerender } = render(
      <ProductImageGallery
        images={[
          {
            id: 'master:image-1',
            source_id: 'image-1',
            url: '/master.png',
            view: 'front',
            scope: 'master',
          },
        ]}
        fallbackUrl={null}
        productName="Overlay product"
        selectedColorSwatchId={null}
        overlays={[
          {
            linkId: 'link-1',
            imageId: 'image-1',
            rect: { x: 0, y: 0, w: 1, h: 1 },
            placement: { x: 0, y: 0, w: 0.5, h: 0.5, rotation_deg: 0 },
            artworkUrl: '/artwork.png',
          },
        ]}
      />,
    )
    expect(container.querySelector('img[src="/artwork.png"]')).toBeInTheDocument()

    rerender(
      <ProductImageGallery
        images={[
          {
            id: 'catalogue:snapshot-1',
            source_id: 'snapshot-1',
            url: '/snapshot.png',
            view: null,
            scope: 'catalogue',
            source: 'designer_snapshot',
          },
        ]}
        fallbackUrl={null}
        productName="Overlay product"
        selectedColorSwatchId={null}
        imageLayout="merchandised_gallery"
        overlays={[
          {
            linkId: 'link-1',
            imageId: 'snapshot-1',
            rect: { x: 0, y: 0, w: 1, h: 1 },
            placement: { x: 0, y: 0, w: 0.5, h: 0.5, rotation_deg: 0 },
            artworkUrl: '/artwork.png',
          },
        ]}
      />,
    )
    expect(container.querySelector('img[src="/artwork.png"]')).not.toBeInTheDocument()
  })
})
