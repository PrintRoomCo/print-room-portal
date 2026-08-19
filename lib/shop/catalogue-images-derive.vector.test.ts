// SHARED VECTOR — keep byte-identical with print-room-staff-portal's card-image derive vector.
// If you change a case here, change it there.

import { describe, it, expect } from 'vitest'
import { deriveCardImageUrl } from './catalogue-images'
import { normalizeCatalogueImageView } from './catalogue-image-view'

const nv = (v: string | null) => normalizeCatalogueImageView(v)

describe('deriveCardImageUrl — shared vector', () => {
  it('A: all-colours front present — returns AC_FRONT', () => {
    const images = [
      { color_swatch_id: null, view: 'front', source: 'staff_upload', position: 0, image_url: 'AC_FRONT' },
      { color_swatch_id: 'lead', view: 'front', source: 'staff_upload', position: 0, image_url: 'LEAD_FRONT' },
    ]
    expect(deriveCardImageUrl({ images, leadColorSwatchId: 'lead', masterImageUrl: 'MASTER', normalizeView: nv })).toBe('AC_FRONT')
  })

  it('B: only per-colour fronts (lead wins) — returns LEAD_FRONT', () => {
    const images = [
      { color_swatch_id: 'lead', view: 'front', source: 'staff_upload', position: 0, image_url: 'LEAD_FRONT' },
      { color_swatch_id: 'other', view: 'front', source: 'staff_upload', position: 0, image_url: 'OTHER_FRONT' },
    ]
    expect(deriveCardImageUrl({ images, leadColorSwatchId: 'lead', masterImageUrl: 'MASTER', normalizeView: nv })).toBe('LEAD_FRONT')
  })

  it('C: snapshot excluded — returns MASTER', () => {
    const images = [
      { color_swatch_id: null, view: 'front', source: 'designer_snapshot', position: 0, image_url: 'SNAP' },
    ]
    expect(deriveCardImageUrl({ images, leadColorSwatchId: null, masterImageUrl: 'MASTER', normalizeView: nv })).toBe('MASTER')
  })

  it('D: master only — returns MASTER', () => {
    expect(deriveCardImageUrl({ images: [], leadColorSwatchId: null, masterImageUrl: 'MASTER', normalizeView: nv })).toBe('MASTER')
  })

  it('E: first all-colours by position when no front — returns AC_LEFT1', () => {
    const images = [
      { color_swatch_id: null, view: 'back', source: 'staff_upload', position: 2, image_url: 'AC_BACK2' },
      { color_swatch_id: null, view: 'left', source: 'staff_upload', position: 1, image_url: 'AC_LEFT1' },
    ]
    expect(deriveCardImageUrl({ images, leadColorSwatchId: null, masterImageUrl: 'MASTER', normalizeView: nv })).toBe('AC_LEFT1')
  })

  it('F: Merchandised uses first union-order image, including a snapshot', () => {
    const images = [
      { id: 'master-second', scope: 'master' as const, color_swatch_id: 'lead', view: 'front', source: 'staff_upload', position: 0, gallery_position: 1, image_url: 'MASTER_SECOND' },
      { id: 'catalogue-first', scope: 'catalogue' as const, color_swatch_id: 'lead', view: null, source: 'designer_snapshot', position: 9, gallery_position: 0, image_url: 'CATALOGUE_FIRST' },
    ]
    expect(deriveCardImageUrl({ images, leadColorSwatchId: 'lead', masterImageUrl: 'MASTER', normalizeView: nv, layout: 'merchandised_gallery' })).toBe('CATALOGUE_FIRST')
  })

  it('G: Merchandised excludes another colour and keeps neutral media', () => {
    const images = [
      { id: 'other-first', scope: 'catalogue' as const, color_swatch_id: 'other', view: null, source: 'staff_upload', position: 0, gallery_position: 0, image_url: 'OTHER' },
      { id: 'neutral-second', scope: 'master' as const, color_swatch_id: null, view: null, source: 'staff_upload', position: 1, gallery_position: 1, image_url: 'NEUTRAL' },
    ]
    expect(deriveCardImageUrl({ images, leadColorSwatchId: 'lead', masterImageUrl: 'MASTER', normalizeView: nv, layout: 'merchandised_gallery' })).toBe('NEUTRAL')
  })

  it('H: Merchandised hides master photos when the lead colour has a catalogue image', () => {
    const images = [
      { id: 'master-first', scope: 'master' as const, color_swatch_id: null, view: 'front', source: null, position: 0, gallery_position: 0, image_url: 'MASTER_FIRST' },
      { id: 'catalogue-second', scope: 'catalogue' as const, color_swatch_id: 'lead', view: 'front', source: 'staff_upload', position: 0, gallery_position: 1, image_url: 'CATALOGUE_SECOND' },
    ]
    expect(deriveCardImageUrl({ images, leadColorSwatchId: 'lead', masterImageUrl: 'MASTER', normalizeView: nv, layout: 'merchandised_gallery' })).toBe('CATALOGUE_SECOND')
  })

  it('I: Merchandised keeps master photos when only another colour has catalogue images', () => {
    const images = [
      { id: 'master-own', scope: 'master' as const, color_swatch_id: 'lead', view: 'front', source: null, position: 0, gallery_position: 0, image_url: 'MASTER_OWN' },
      { id: 'catalogue-other', scope: 'catalogue' as const, color_swatch_id: 'other', view: 'front', source: 'staff_upload', position: 0, gallery_position: 1, image_url: 'CATALOGUE_OTHER' },
    ]
    expect(deriveCardImageUrl({ images, leadColorSwatchId: 'lead', masterImageUrl: 'MASTER', normalizeView: nv, layout: 'merchandised_gallery' })).toBe('MASTER_OWN')
  })
})
