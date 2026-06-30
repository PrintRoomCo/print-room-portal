import { describe, it, expect } from 'vitest'
import {
  resolveGalleryImagesForColour,
  type CatalogueAwareGalleryImage,
} from '../catalogue-images'

const img = (over: Partial<CatalogueAwareGalleryImage>): CatalogueAwareGalleryImage => ({
  id: 'x', url: 'u', view: 'front', scope: 'catalogue', source: 'staff_upload',
  color_swatch_id: null, ...over,
})

describe('resolveGalleryImagesForColour — published catalogue image is never dropped', () => {
  it('keeps a coloured catalogue staff_upload image when NO colour is selected', () => {
    const out = resolveGalleryImagesForColour([img({ id: 'cat', color_swatch_id: 'navy' })], null)
    expect(out.map((i) => i.id)).toContain('cat')
  })

  it('still drops a wrong-colour catalogue image when a DIFFERENT colour is selected (unchanged)', () => {
    const out = resolveGalleryImagesForColour([img({ id: 'cat', color_swatch_id: 'navy' })], 'red')
    expect(out.map((i) => i.id)).not.toContain('cat')
  })
})
