import { describe, expect, it } from 'vitest'
import { pickCatalogueFrontImage, type CatalogueFrontImageRow } from './catalogue-front-image'

const row = (overrides: Partial<CatalogueFrontImageRow>): CatalogueFrontImageRow => ({
  catalogue_item_id: 'item-1',
  color_swatch_id: null,
  view: 'front',
  source: 'staff_upload',
  position: 0,
  image_url: '/front.png',
  ...overrides,
})

describe('pickCatalogueFrontImage', () => {
  it('prefers the selected swatch front image for the catalogue item', () => {
    expect(
      pickCatalogueFrontImage(
        [
          row({ color_swatch_id: 'other', image_url: '/other-front.png' }),
          row({ color_swatch_id: 'selected', image_url: '/selected-front.png' }),
          row({ color_swatch_id: null, image_url: '/all-front.png' }),
        ],
        'selected',
      ),
    ).toBe('/selected-front.png')
  })

  it('prefers staff catalogue fronts before designer snapshots', () => {
    expect(
      pickCatalogueFrontImage([
        row({ source: 'designer_snapshot', position: 0, image_url: '/snapshot.png' }),
        row({ source: 'staff_upload', position: 1, image_url: '/staff-front.png' }),
      ]),
    ).toBe('/staff-front.png')
  })

  it('ignores non-front images', () => {
    expect(
      pickCatalogueFrontImage([
        row({ view: 'back', image_url: '/back.png' }),
        row({ view: 'front', image_url: '/front.png' }),
      ]),
    ).toBe('/front.png')
  })
})
