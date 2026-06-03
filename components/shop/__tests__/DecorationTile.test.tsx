import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { DecorationTile } from '../DecorationTile'
import type { DecorationOption } from '@/lib/shop/decorations'

function deco(overrides: Partial<DecorationOption> = {}): DecorationOption {
  return {
    linkId: 'link-1',
    decorationId: 'dec-1',
    name: 'Left chest logo',
    method: 'embroidery',
    positionLabel: 'Left chest',
    unitPrice: 0,
    artworkUrl: 'https://cdn.example/artwork.png',
    artworkName: 'logo.png',
    snapshotUrl: null,
    snapshotColorSwatchId: null,
    isDefault: false,
    sortOrder: 0,
    recalcInputs: null,
    overlay: null,
    ...overrides,
  }
}

describe('DecorationTile', () => {
  it('renders nothing for an empty decoration list', () => {
    const { container } = render(<DecorationTile decorations={[]} productName="Tee" />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders one card per decoration with name and position caption', () => {
    render(
      <DecorationTile
        decorations={[
          deco({ linkId: 'a', name: 'Left chest logo', positionLabel: 'Left chest' }),
          deco({ linkId: 'b', name: 'Back print', positionLabel: 'Back' }),
        ]}
        productName="Tee"
      />,
    )

    expect(screen.getAllByRole('listitem')).toHaveLength(2)
    expect(screen.getByText('Left chest logo')).toBeInTheDocument()
    expect(screen.getByText('Left chest')).toBeInTheDocument()
    expect(screen.getByText('Back print')).toBeInTheDocument()
  })

  it('prefers the snapshot image over the artwork image', () => {
    render(
      <DecorationTile
        decorations={[
          deco({
            snapshotUrl: 'https://cdn.example/snap.png',
            artworkUrl: 'https://cdn.example/art.png',
          }),
        ]}
        productName="Tee"
      />,
    )

    expect(screen.getByRole('img')).toHaveAttribute('src', 'https://cdn.example/snap.png')
  })

  it('falls back to the artwork image when there is no snapshot', () => {
    render(
      <DecorationTile
        decorations={[deco({ snapshotUrl: null, artworkUrl: 'https://cdn.example/art.png' })]}
        productName="Tee"
      />,
    )

    expect(screen.getByRole('img')).toHaveAttribute('src', 'https://cdn.example/art.png')
  })

  it('omits the position line when positionLabel is null', () => {
    render(
      <DecorationTile
        decorations={[deco({ name: 'All-over', positionLabel: null })]}
        productName="Tee"
      />,
    )

    expect(screen.getByText('All-over')).toBeInTheDocument()
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
    expect(screen.queryByText('Left chest')).not.toBeInTheDocument()
  })
})
