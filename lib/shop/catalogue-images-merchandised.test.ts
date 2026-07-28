import { describe, expect, it } from 'vitest'
import {
  pickPreferredGalleryImage,
  resolveGalleryImagesForColour,
  type CatalogueAwareGalleryImage,
} from './catalogue-images'

const image = (
  id: string,
  over: Partial<CatalogueAwareGalleryImage> = {},
): CatalogueAwareGalleryImage => ({
  id,
  url: `/${id}.png`,
  view: 'front',
  position: 0,
  gallery_position: null,
  color_swatch_id: null,
  scope: 'master',
  ...over,
})

const resolve = (
  images: CatalogueAwareGalleryImage[],
  colour: string | null = 'blue',
  hidden?: Set<string>,
) => resolveGalleryImagesForColour(
  images,
  colour,
  hidden,
  'merchandised_gallery',
)

describe('Merchandised gallery resolution', () => {
  it('keeps same-view multiples and cross-source union order', () => {
    const resolved = resolve([
      image('master-second', { gallery_position: 1 }),
      image('catalogue-first', {
        scope: 'catalogue',
        source: 'staff_upload',
        gallery_position: 0,
      }),
      image('catalogue-third', {
        scope: 'catalogue',
        source: 'designer_snapshot',
        gallery_position: 2,
      }),
    ])

    expect(resolved.map((row) => row.id)).toEqual([
      'catalogue-first',
      'master-second',
      'catalogue-third',
    ])
  })

  it('keeps view-less persisted media', () => {
    expect(resolve([image('lifestyle', { view: null })])[0]?.id).toBe('lifestyle')
  })

  it('includes selected-colour and neutral media but excludes another colour', () => {
    expect(resolve([
      image('own', { color_swatch_id: 'blue', position: 0 }),
      image('neutral', { position: 1 }),
      image('other', { color_swatch_id: 'red' }),
    ]).map((row) => row.id)).toEqual(['own', 'neutral'])
  })

  it('still suppresses hidden canonical views but not view-less media', () => {
    expect(resolve([
      image('back', { view: 'back' }),
      image('untagged', { view: null, position: 1 }),
    ], 'blue', new Set(['back'])).map((row) => row.id)).toEqual(['untagged'])
  })

  it('appends missing order rows deterministically by native position, scope, and id', () => {
    expect(resolve([
      image('catalogue-b', { scope: 'catalogue', position: 1 }),
      image('master-a', { position: 1 }),
      image('explicit', { gallery_position: 0, position: 99 }),
      image('catalogue-a', { scope: 'catalogue', position: 1 }),
    ]).map((row) => row.id)).toEqual([
      'explicit',
      'master-a',
      'catalogue-a',
      'catalogue-b',
    ])
  })

  it('uses a selected swatch synthetic only when no persisted image survives', () => {
    const synthetic = image('swatch:blue', {
      color_swatch_id: 'blue',
      synthetic: true,
    })
    expect(resolve([synthetic, image('persisted')]).map((row) => row.id)).toEqual([
      'persisted',
    ])
    expect(resolve([synthetic])[0]?.id).toBe('swatch:blue')
  })

  it('derives the hero from the first ordered row without snapshot preference', () => {
    const images = [
      image('staff-first', {
        scope: 'catalogue',
        source: 'staff_upload',
        gallery_position: 0,
      }),
      image('snapshot-second', {
        scope: 'catalogue',
        source: 'designer_snapshot',
        gallery_position: 1,
      }),
    ]

    expect(
      pickPreferredGalleryImage(
        images,
        'blue',
        undefined,
        'merchandised_gallery',
      )?.id,
    ).toBe('staff-first')
  })
})
