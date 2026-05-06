import { describe, expect, it } from 'vitest'
import {
  resolveGalleryImagesForColour,
  type CatalogueAwareGalleryImage,
} from './catalogue-images'

const baseImages: CatalogueAwareGalleryImage[] = [
  {
    id: 'master-front',
    url: '/master-front.png',
    view: 'front',
    position: 0,
    color_swatch_id: null,
    scope: 'master',
  },
  {
    id: 'master-back',
    url: '/master-back.png',
    view: 'back',
    position: 1,
    color_swatch_id: null,
    scope: 'master',
  },
]

describe('resolveGalleryImagesForColour', () => {
  it('keeps master fallback images when no catalogue images exist', () => {
    expect(resolveGalleryImagesForColour(baseImages, 'blue')).toEqual(baseImages)
  })

  it('allows partial catalogue overrides by view', () => {
    const resolved = resolveGalleryImagesForColour(
      [
        ...baseImages,
        {
          id: 'catalogue-front-blue',
          url: '/catalogue-front-blue.png',
          view: 'front',
          position: 0,
          color_swatch_id: 'blue',
          scope: 'catalogue',
        },
      ],
      'blue',
    )

    expect(resolved.map((image) => image.url)).toEqual([
      '/catalogue-front-blue.png',
      '/master-back.png',
    ])
  })

  it('prefers all-colour catalogue images before master images', () => {
    const resolved = resolveGalleryImagesForColour(
      [
        ...baseImages,
        {
          id: 'catalogue-back-all',
          url: '/catalogue-back-all.png',
          view: 'back',
          position: 1,
          color_swatch_id: null,
          scope: 'catalogue',
        },
      ],
      'yellow',
    )

    expect(resolved.map((image) => image.url)).toEqual([
      '/master-front.png',
      '/catalogue-back-all.png',
    ])
  })

  it('ignores images for a different selected colour', () => {
    const resolved = resolveGalleryImagesForColour(
      [
        ...baseImages,
        {
          id: 'catalogue-front-blue',
          url: '/catalogue-front-blue.png',
          view: 'front',
          position: 0,
          color_swatch_id: 'blue',
          scope: 'catalogue',
        },
      ],
      'yellow',
    )

    expect(resolved.map((image) => image.url)).toEqual([
      '/master-front.png',
      '/master-back.png',
    ])
  })
})
