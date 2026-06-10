import { describe, expect, it } from 'vitest'
import {
  pickCatalogueItemThumbnail,
  pickPreferredGalleryImageUrl,
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

  it('filters master base views once a colour-specific catalogue image exists', () => {
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

    expect(resolved.map((image) => image.url)).toEqual(['/catalogue-front-blue.png'])
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

    expect(resolved.map((image) => image.url)).toEqual(['/designer-front-blue.png'])
  })

  it('prefers a colour-matched staff upload over an all-colour designer snapshot', () => {
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

    expect(resolved.map((image) => image.url)).toEqual(['/staff-front-blue.png'])
  })

  it('prefers a colour-matched staff_pick over an all-colour designer snapshot (priority-2 gate)', () => {
    const resolved = resolveGalleryImagesForColour(
      [
        ...baseImages,
        {
          id: 'pick-front-blue',
          url: '/pick-front-blue.png',
          view: 'front',
          position: 0,
          color_swatch_id: 'blue',
          scope: 'catalogue',
          source: 'staff_pick',
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

    expect(resolved.map((image) => image.url)).toEqual(['/pick-front-blue.png'])
  })

  it('staff_pick is not dropped from the PDP — colour-matched staff_pick reaches priority 2', () => {
    // This test FAILS if the imagePriority gate only checks source === 'staff_upload'
    const resolved = resolveGalleryImagesForColour(
      [
        {
          id: 'pick-hero-blue',
          url: '/pick-hero-blue.png',
          view: 'hero',
          position: 0,
          color_swatch_id: 'blue',
          scope: 'catalogue',
          source: 'staff_pick',
        },
      ],
      'blue',
    )

    expect(resolved.length).toBeGreaterThan(0)
    expect(resolved.map((image) => image.url)).toContain('/pick-hero-blue.png')
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

    expect(resolved.map((image) => image.url)).toEqual(['/catalogue-back-all.png'])
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

  it('does not borrow a designer snapshot from another swatch', () => {
    const resolved = resolveGalleryImagesForColour(
      [
        {
          id: 'master-hero-bone',
          url: '/master-hero-bone.png',
          view: 'hero',
          position: 0,
          color_swatch_id: 'bone',
          scope: 'master',
        },
        {
          id: 'designer-hero-arctic',
          url: '/designer-hero-arctic.png',
          view: 'hero',
          position: 0,
          color_swatch_id: 'arctic',
          scope: 'catalogue',
          source: 'designer_snapshot',
        },
      ],
      'bone',
    )

    expect(resolved.map((image) => image.url)).toEqual(['/master-hero-bone.png'])
  })

  it('prefers a swatch-matched snapshot over a cross-swatch snapshot', () => {
    const resolved = resolveGalleryImagesForColour(
      [
        {
          id: 'designer-hero-arctic',
          url: '/designer-hero-arctic.png',
          view: 'hero',
          position: 0,
          color_swatch_id: 'arctic',
          scope: 'catalogue',
          source: 'designer_snapshot',
        },
        {
          id: 'designer-hero-bone',
          url: '/designer-hero-bone.png',
          view: 'hero',
          position: 1,
          color_swatch_id: 'bone',
          scope: 'catalogue',
          source: 'designer_snapshot',
        },
      ],
      'bone',
    )

    expect(resolved.map((image) => image.url)).toEqual(['/designer-hero-bone.png'])
  })

  it('still drops a non-snapshot catalogue image from a non-matching swatch', () => {
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
      ],
      'yellow',
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

    expect(resolved.map((image) => image.url)).toEqual(['/master-detail-blue.png'])
  })
})

describe('pickPreferredGalleryImageUrl', () => {
  it('uses a designer snapshot as the active image even when a blank hero sorts first', () => {
    expect(
      pickPreferredGalleryImageUrl(
        [
          {
            id: 'master-hero-blue',
            url: '/blank-hero-blue.png',
            view: 'hero',
            position: 0,
            color_swatch_id: 'blue',
            scope: 'master',
          },
          {
            id: 'designer-front-blue',
            url: '/designer-front-blue.png',
            view: 'front',
            position: 99,
            color_swatch_id: 'blue',
            scope: 'catalogue',
            source: 'designer_snapshot',
          },
        ],
        'blue',
        '/fallback.png',
      ),
    ).toBe('/designer-front-blue.png')
  })
})

describe('resolveGalleryImagesForColour blank-image filter', () => {
  const masterBase: CatalogueAwareGalleryImage = {
    id: 'm-base',
    url: 'https://cdn.example/blank-front.png',
    view: 'front',
    scope: 'master',
    color_swatch_id: null,
  }
  const catalogueColour: CatalogueAwareGalleryImage = {
    id: 'c-hero',
    url: 'https://cdn.example/red-hero.png',
    view: 'hero',
    scope: 'catalogue',
    source: 'staff_upload',
    color_swatch_id: 'sw-red',
  }
  const masterColourMatched: CatalogueAwareGalleryImage = {
    id: 'm-back',
    url: 'https://cdn.example/red-back.png',
    view: 'back',
    scope: 'master',
    color_swatch_id: 'sw-red',
  }

  it('drops the master color-null base when a colour-specific image exists', () => {
    const out = resolveGalleryImagesForColour([masterBase, catalogueColour], 'sw-red')
    const ids = out.map((image) => image.id)

    expect(ids).toContain('c-hero')
    expect(ids).not.toContain('m-base')
  })

  it('keeps the master base as last resort when no colour-specific image exists', () => {
    const out = resolveGalleryImagesForColour([masterBase], 'sw-red')

    expect(out.map((image) => image.id)).toEqual(['m-base'])
  })

  it('keeps a colour-matched master image but drops the generic base when a catalogue image exists', () => {
    // The colour's own master photo (e.g. its back) fills a view the catalogue
    // doesn't cover and MUST be surfaced; only the generic null-colour blank is
    // dropped. (Previously both were dropped, hiding the real colour-matched back.)
    const out = resolveGalleryImagesForColour(
      [masterColourMatched, masterBase, catalogueColour],
      'sw-red',
    )
    const ids = out.map((image) => image.id)

    expect(ids).toContain('c-hero') // catalogue pin wins its own view
    expect(ids).toContain('m-back') // the colour's REAL back is surfaced
    expect(ids).not.toContain('m-base') // generic null-colour blank still dropped
  })

  it('keeps colour-matched master images as the fallback when no catalogue image exists', () => {
    const out = resolveGalleryImagesForColour([masterColourMatched, masterBase], 'sw-red')
    const ids = out.map((image) => image.id)

    expect(ids).toContain('m-back')
  })

  it('surfaces the colour-matched master back beside a pinned catalogue front, never the generic back/side (Box Tee Forest Green)', () => {
    // Mirrors prod: Forest Green has a staff_pick front (catalogue scope) plus
    // its own master back, alongside generic null-colour back/side marketing
    // shots. The customer must see the real FG front + FG back and none of the
    // generic blanks.
    const out = resolveGalleryImagesForColour(
      [
        { id: 'cat-fg-front', url: '/fg-front.png', view: 'front', scope: 'catalogue', source: 'staff_pick', color_swatch_id: 'fg' },
        { id: 'm-fg-back', url: '/fg-back.png', view: 'back', scope: 'master', color_swatch_id: 'fg' },
        { id: 'm-null-back', url: '/generic-back.png', view: 'back', scope: 'master', color_swatch_id: null },
        { id: 'm-null-side', url: '/generic-side.png', view: 'side', scope: 'master', color_swatch_id: null },
      ],
      'fg',
    )
    const ids = out.map((image) => image.id)

    expect(ids).toEqual(['cat-fg-front', 'm-fg-back'])
    expect(ids).not.toContain('m-null-back')
    expect(ids).not.toContain('m-null-side')
  })
})

describe('pickCatalogueItemThumbnail', () => {
  it('excludes designer_snapshot from the fallback derive — falls back to master url', () => {
    // Snapshots are excluded from the card fallback; an explicit card_image_id pick
    // (handled by the caller) is the only way a snapshot becomes the card thumbnail.
    expect(
      pickCatalogueItemThumbnail('/blank.png', [
        {
          catalogue_item_id: 'item-1',
          view: 'hero',
          source: 'designer_snapshot',
          position: 0,
          image_url: '/designer-blue.png',
          color_swatch_id: 'blue',
        },
      ]),
    ).toBe('/blank.png')
  })

  it('staff_pick all-colours front wins over unknown-source row', () => {
    // staff_pick (all-colours, hero=front) goes into acFront, wins positionally first.
    expect(
      pickCatalogueItemThumbnail('/blank.png', [
        {
          catalogue_item_id: 'item-1',
          view: 'hero',
          source: 'staff_pick',
          position: 0,
          image_url: '/pick-hero.png',
          color_swatch_id: null,
        },
        {
          catalogue_item_id: 'item-1',
          view: 'hero',
          source: null,
          position: 0,
          image_url: '/unknown-hero.png',
          color_swatch_id: null,
        },
      ]),
    ).toBe('/pick-hero.png')
  })

  it('all-colours front beats lead-colour front', () => {
    expect(
      pickCatalogueItemThumbnail('/blank.png', [
        { catalogue_item_id: 'item-1', view: 'front', source: 'staff_upload', position: 0, image_url: '/ac-front.png', color_swatch_id: null },
        { catalogue_item_id: 'item-1', view: 'front', source: 'staff_upload', position: 0, image_url: '/lead-front.png', color_swatch_id: 'lead' },
      ], 'lead'),
    ).toBe('/ac-front.png')
  })

  it('lead-colour front beats all-colours non-front', () => {
    expect(
      pickCatalogueItemThumbnail('/blank.png', [
        { catalogue_item_id: 'item-1', view: 'back', source: 'staff_upload', position: 0, image_url: '/ac-back.png', color_swatch_id: null },
        { catalogue_item_id: 'item-1', view: 'front', source: 'staff_upload', position: 0, image_url: '/lead-front.png', color_swatch_id: 'lead' },
      ], 'lead'),
    ).toBe('/lead-front.png')
  })
})
