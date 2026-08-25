import { describe, expect, it } from 'vitest'
import {
  applyResolvedRendition,
  InvalidDecorationRenditionAssignmentError,
  resolveDecorationRendition,
  type DecorationRendition,
} from './decoration-renditions'

const black: DecorationRendition = {
  id: 'rendition-black',
  artworkId: 'artwork-black',
  label: 'Black ink',
  artworkName: 'Print Room Logo — Black',
  artworkUrl: 'https://example.test/black.png',
  artworkStoragePath: 'org/black.png',
  artworkSha256: 'black-sha',
  overlayUrl: 'https://example.test/black-transparent.png',
  active: true,
}

const white: DecorationRendition = {
  id: 'rendition-white',
  artworkId: 'artwork-white',
  label: 'White ink',
  artworkName: 'Print Room Logo — White',
  artworkUrl: 'https://example.test/white.png',
  artworkStoragePath: 'org/white.png',
  artworkSha256: 'white-sha',
  overlayUrl: 'https://example.test/white-transparent.png',
  active: true,
}

describe('resolveDecorationRendition', () => {
  it('uses the exact colourway assignment when present', () => {
    expect(
      resolveDecorationRendition({
        variantId: 'navy-variant',
        defaultArtworkId: black.artworkId,
        renditions: [black, white],
        assignmentByVariantId: { 'navy-variant': white.id },
      }),
    ).toMatchObject({ rendition: white, source: 'exact_variant' })
  })

  it('uses the default rendition when the colourway has no assignment', () => {
    expect(
      resolveDecorationRendition({
        variantId: 'white-variant',
        defaultArtworkId: black.artworkId,
        renditions: [black, white],
        assignmentByVariantId: { 'navy-variant': white.id },
      }),
    ).toMatchObject({ rendition: black, source: 'decoration_default' })
  })

  it('fails closed when an explicit assignment points at an inactive rendition', () => {
    expect(() =>
      resolveDecorationRendition({
        variantId: 'navy-variant',
        defaultArtworkId: black.artworkId,
        renditions: [black, { ...white, active: false }],
        assignmentByVariantId: { 'navy-variant': white.id },
      }),
    ).toThrow(InvalidDecorationRenditionAssignmentError)
  })
})

describe('applyResolvedRendition', () => {
  it('swaps the overlay, thumbnail, snapshot and physical link together', () => {
    const option = {
      linkId: 'link-white',
      artworkUrl: 'black.png',
      artworkName: 'Logo — Black',
      snapshotUrl: 'white-garment.png',
      overlay: { artworkUrl: 'black-transparent.png', imageId: 'image', rect: {}, placement: {} },
    }

    expect(
      applyResolvedRendition(option, 'navy', {
        navy: {
          linkId: 'link-navy',
          renditionId: 'rendition-white',
          renditionLabel: 'White ink',
          artworkId: 'art-white',
          artworkName: 'Logo — White',
          artworkUrl: 'white.png',
          overlayUrl: 'white-transparent.png',
          snapshotUrl: 'navy-garment.png',
          resolutionSource: 'exact_variant',
        },
      }),
    ).toMatchObject({
      linkId: 'link-navy',
      artworkUrl: 'white.png',
      artworkName: 'Logo — White',
      snapshotUrl: 'navy-garment.png',
      renditionId: 'rendition-white',
      renditionLabel: 'White ink',
      overlay: { artworkUrl: 'white-transparent.png' },
    })
  })
})
