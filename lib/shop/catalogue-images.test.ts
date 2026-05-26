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

  it('prefers a colour-matched designer snapshot over a plain staff upload', () => {
    const resolved = resolveGalleryImagesForColour(
      [
        ...baseImages,
        {
          id: 'aaa-staff-front-blue',
          url: '/staff-front-blue.png',
          view: 'front',
          position: 0,
          color_swatch_id: 'blue',
          scope: 'catalogue',
          source: 'staff_upload',
        },
        {
          id: 'zzz-designer-front-blue',
          url: '/designer-front-blue.png',
          view: 'front',
          position: 99,
          color_swatch_id: 'blue',
          scope: 'catalogue',
          source: 'designer_snapshot',
        },
      ],
      'blue',
    )

    expect(resolved.map((image) => image.url)).toEqual([
      '/designer-front-blue.png',
      '/master-back.png',
    ])
  })

  it('prefers an all-colour designer snapshot over a colour-matched staff upload', () => {
    const resolved = resolveGalleryImagesForColour(
      [
        ...baseImages,
        {
          id: 'staff-front-blue',
          url: '/staff-front-blue.png',
          view: 'front',
          position: 0,
          color_swatch_id: 'blue',
          scope: 'catalogue',
          source: 'staff_upload',
        },
        {
          id: 'designer-front-all',
          url: '/designer-front-all.png',
          view: 'front',
          position: 99,
          color_swatch_id: null,
          scope: 'catalogue',
          source: 'designer_snapshot',
        },
      ],
      'blue',
    )

    expect(resolved.map((image) => image.url)).toEqual([
      '/designer-front-all.png',
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

  it('drops master+null images whose view is not a primary view', () => {
    const resolved = resolveGalleryImagesForColour(
      [
        ...baseImages,
        {
          id: 'master-detail-1',
          url: '/master-detail-1.png',
          view: 'detail-1',
          position: 2,
          color_swatch_id: null,
          scope: 'master',
        },
        {
          id: 'master-detail-99',
          url: '/master-detail-99.png',
          view: 'detail-99',
          position: 99,
          color_swatch_id: null,
          scope: 'master',
        },
      ],
      'blue',
    )

    expect(resolved.map((image) => image.url)).toEqual([
      '/master-front.png',
      '/master-back.png',
    ])
  })

  it('keeps master+match detail images even when view is not a primary view', () => {
    const resolved = resolveGalleryImagesForColour(
      [
        ...baseImages,
        {
          id: 'master-detail-blue',
          url: '/master-detail-blue.png',
          view: 'detail-3',
          position: 3,
          color_swatch_id: 'blue',
          scope: 'master',
        },
      ],
      'blue',
    )

    expect(resolved.map((image) => image.url)).toEqual([
      '/master-front.png',
      '/master-back.png',
      '/master-detail-blue.png',
    ])
  })
})
