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

  // Mirrors the PDP's `pickPreferredGalleryImage`, which resolves the decorated
  // designer render first. The cart, checkout, confirmation and reorder surfaces
  // all read through here, so ranking staff stock photos above the snapshot made
  // them contradict the PDP the customer just bought from.
  it('prefers the designer snapshot before staff catalogue fronts', () => {
    expect(
      pickCatalogueFrontImage([
        row({ source: 'staff_pick', position: 0, image_url: '/staff-pick.png' }),
        row({ source: 'staff_upload', position: 1, image_url: '/staff-front.png' }),
        row({ source: 'designer_snapshot', position: 2, image_url: '/snapshot.png' }),
      ]),
    ).toBe('/snapshot.png')
  })

  it('still prefers a staff front for the selected colour over an off-colour snapshot', () => {
    expect(
      pickCatalogueFrontImage(
        [
          row({
            color_swatch_id: 'other',
            source: 'designer_snapshot',
            image_url: '/other-snapshot.png',
          }),
          row({
            color_swatch_id: 'selected',
            source: 'staff_pick',
            image_url: '/selected-staff.png',
          }),
        ],
        'selected',
      ),
    ).toBe('/selected-staff.png')
  })

  it('keeps the swatchless snapshot ahead of a swatchless staff front', () => {
    expect(
      pickCatalogueFrontImage(
        [
          row({ color_swatch_id: null, source: 'staff_pick', image_url: '/staff.png' }),
          row({ color_swatch_id: null, source: 'designer_snapshot', image_url: '/snapshot.png' }),
        ],
        'selected',
      ),
    ).toBe('/snapshot.png')
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
