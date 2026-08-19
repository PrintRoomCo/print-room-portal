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

const custom = (
  id: string,
  over: Partial<CatalogueAwareGalleryImage> = {},
): CatalogueAwareGalleryImage =>
  image(id, { scope: 'catalogue', source: 'staff_upload', ...over })

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
  it('keeps same-view multiples and explicit union order for a colour without customs', () => {
    const resolved = resolve([
      image('master-second', { gallery_position: 1 }),
      image('master-first', { gallery_position: 0 }),
      image('master-appended', { position: 2 }),
    ])

    expect(resolved.map((row) => row.id)).toEqual([
      'master-first',
      'master-second',
      'master-appended',
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

  it('appends missing order rows deterministically by native position and id', () => {
    expect(resolve([
      image('master-b', { position: 1 }),
      image('master-a', { position: 1 }),
      image('explicit', { gallery_position: 0, position: 99 }),
    ]).map((row) => row.id)).toEqual([
      'explicit',
      'master-a',
      'master-b',
    ])
  })

  it('hides every master photo when the colour has a custom image, colour-tagged ones included', () => {
    expect(resolve([
      image('master-neutral', { gallery_position: 0 }),
      image('master-own', { color_swatch_id: 'blue', gallery_position: 1 }),
      custom('custom-own', { color_swatch_id: 'blue', gallery_position: 2 }),
    ]).map((row) => row.id)).toEqual(['custom-own'])
  })

  it('keeps masters for a colour without customs even when another colour has them', () => {
    expect(resolve([
      image('master-neutral', { gallery_position: 0 }),
      custom('custom-red', { color_swatch_id: 'red', gallery_position: 1 }),
    ]).map((row) => row.id)).toEqual(['master-neutral'])
  })

  it('lets an all-colours custom hide masters for every colour and the neutral selection', () => {
    const rows = [
      image('master-neutral', { gallery_position: 0 }),
      custom('custom-neutral', { gallery_position: 1 }),
    ]

    expect(resolve(rows, 'blue').map((row) => row.id)).toEqual(['custom-neutral'])
    expect(resolve(rows, null).map((row) => row.id)).toEqual(['custom-neutral'])
  })

  it('keeps curated relative order among the surviving customs', () => {
    expect(resolve([
      custom('custom-late', { gallery_position: 3 }),
      image('master-a', { gallery_position: 0 }),
      custom('custom-early', { gallery_position: 1 }),
      image('master-b', { gallery_position: 2 }),
    ]).map((row) => row.id)).toEqual(['custom-early', 'custom-late'])
  })

  it('restores masters in curated order when the customs are removed', () => {
    const masters = [
      image('master-second', { gallery_position: 1 }),
      image('master-first', { gallery_position: 0 }),
    ]

    expect(
      resolve([...masters, custom('custom-own', { gallery_position: 2 })])
        .map((row) => row.id),
    ).toEqual(['custom-own'])
    expect(resolve(masters).map((row) => row.id)).toEqual([
      'master-first',
      'master-second',
    ])
  })

  it('ignores hidden-view customs when deciding whether to hide masters', () => {
    expect(resolve([
      image('master-front', { view: 'front', gallery_position: 0 }),
      custom('custom-back', { view: 'back', gallery_position: 1 }),
    ], 'blue', new Set(['back'])).map((row) => row.id)).toEqual(['master-front'])
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
      custom('staff-first', { gallery_position: 0 }),
      custom('snapshot-second', {
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

  it('picks the hero from the customs once masters are hidden', () => {
    expect(
      pickPreferredGalleryImage(
        [
          image('master-first', { gallery_position: 0 }),
          custom('custom-second', { gallery_position: 1 }),
        ],
        'blue',
        undefined,
        'merchandised_gallery',
      )?.id,
    ).toBe('custom-second')
  })
})
