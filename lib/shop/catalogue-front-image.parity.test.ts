import { describe, expect, it } from 'vitest'
import {
  pickCatalogueFrontImage,
  type CatalogueFrontImageRow,
} from './catalogue-front-image'
import {
  pickPreferredGalleryImageUrl,
  type CatalogueAwareGalleryImage,
} from './catalogue-images'

/**
 * PARITY GUARD — the cart, checkout, confirmation, reorder and collections
 * surfaces resolve a line's picture through `pickCatalogueFrontImage`, while the
 * PDP the customer bought from resolves it through `pickPreferredGalleryImage`.
 * When the two disagree the customer sees one garment on the PDP and a different
 * one in the cart (regression 2026-08-25: "Faded Wash Trucker Cap" showed the
 * decorated designer render on the PDP and the undecorated BigCommerce stock
 * photo in the cart, because sourceRank put staff_pick above designer_snapshot).
 *
 * Keep both pickers in step. If a divergence is ever deliberate, pin it here
 * with a comment saying why — do not simply delete the case.
 */

const asGalleryImages = (
  rows: CatalogueFrontImageRow[],
): CatalogueAwareGalleryImage[] =>
  rows.map((row, i) => ({
    id: `img-${i}`,
    url: row.image_url as string,
    view: row.view,
    source: row.source as CatalogueAwareGalleryImage['source'],
    color_swatch_id: row.color_swatch_id,
    position: row.position,
    // b2b_catalogue_item_images rows always reach the PDP gallery as
    // catalogue-scoped; without this they score as master images and the
    // fixture stops mirroring production.
    scope: 'catalogue',
  }))

const front = (
  overrides: Partial<CatalogueFrontImageRow>,
): CatalogueFrontImageRow => ({
  catalogue_item_id: 'item-1',
  color_swatch_id: null,
  view: 'front',
  source: 'staff_pick',
  position: 0,
  image_url: '/front.png',
  ...overrides,
})

// Published rows as they exist for b2b_catalogue_items 67994b78 ("Faded Wash
// Trucker Cap"), swatch eac293e2 ("Faded black", variant 980dc82d).
const FADED_BLACK = 'eac293e2-7da5-45c9-a4ad-9194d64338a6'
const DESIGNER_RENDER =
  'https://bthsxgmcnbvwwgvdveek.supabase.co/storage/v1/object/public/org-artworks/catalogue-item-images/2b8efaa2/67994b78/eac293e2/front-designer.png'
const STOCK_PHOTO =
  'https://cdn11.bigcommerce.com/s-nw7gte6txe/products/1122/images/20892/1134_ACCESS_FADED_CAP_FADED_BLACK_FRONT__38553.jpg'

const CASES: Array<{
  name: string
  rows: CatalogueFrontImageRow[]
  selectedSwatchId: string | null
  expected: string
}> = [
  {
    name: 'decorated render beats the stock photo for the same colour',
    rows: [
      front({
        color_swatch_id: FADED_BLACK,
        source: 'designer_snapshot',
        position: 0,
        image_url: DESIGNER_RENDER,
      }),
      front({
        color_swatch_id: FADED_BLACK,
        source: 'staff_pick',
        position: 1,
        image_url: STOCK_PHOTO,
      }),
    ],
    selectedSwatchId: FADED_BLACK,
    expected: DESIGNER_RENDER,
  },
  {
    name: 'the selected colour beats an off-colour render',
    rows: [
      front({
        color_swatch_id: 'other-swatch',
        source: 'designer_snapshot',
        image_url: '/other-colour-render.png',
      }),
      front({
        color_swatch_id: FADED_BLACK,
        source: 'staff_pick',
        image_url: '/selected-colour-staff.png',
      }),
    ],
    selectedSwatchId: FADED_BLACK,
    expected: '/selected-colour-staff.png',
  },
]

describe('front image — cart/PDP parity', () => {
  for (const { name, rows, selectedSwatchId, expected } of CASES) {
    it(`${name} — PDP`, () => {
      expect(
        pickPreferredGalleryImageUrl(asGalleryImages(rows), selectedSwatchId, null),
      ).toBe(expected)
    })

    it(`${name} — cart/checkout/confirmation`, () => {
      expect(pickCatalogueFrontImage(rows, selectedSwatchId)).toBe(expected)
    })
  }

  // PINNED KNOWN DIVERGENCE — two fronts for the SAME view with no colour on
  // either. The PDP collapses a view to one slot in
  // `resolveGalleryImagesForColour` before `pickPreferredGalleryImage` ever
  // applies its designer-first preference, so the render is already gone and
  // position decides; the cart has no such dedupe and prefers the render.
  //
  // Left as-is deliberately: it predates the 2026-08-25 fix, needs no colour to
  // reproduce (so no real catalogue item hits it — the swatch tier separates
  // them first), and closing it means changing PDP gallery dedupe, which is a
  // much wider blast radius. Revisit together if swatchless snapshots ship.
  it('pins the swatchless-front divergence between the two pickers', () => {
    const rows = [
      front({ color_swatch_id: null, source: 'staff_pick', position: 0, image_url: '/staff.png' }),
      front({
        color_swatch_id: null,
        source: 'designer_snapshot',
        position: 1,
        image_url: '/render.png',
      }),
    ]

    expect(pickPreferredGalleryImageUrl(asGalleryImages(rows), FADED_BLACK, null)).toBe(
      '/staff.png',
    )
    expect(pickCatalogueFrontImage(rows, FADED_BLACK)).toBe('/render.png')
  })
})
