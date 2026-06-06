import { describe, expect, it } from 'vitest'
import { normalizeCatalogueImageView } from './catalogue-image-view'

// PR5: `front` is the canonical catalogue image-view token across both repos.
// `hero` is the legacy alias and must read through to `front` (it used to map to
// itself here, while the staff portal already canonicalised on `front`).
describe('normalizeCatalogueImageView — canonical front', () => {
  it('canonicalises the legacy hero token to front', () => {
    expect(normalizeCatalogueImageView('hero')).toBe('front')
  })

  it('maps front and its chest/center variants to front', () => {
    expect(normalizeCatalogueImageView('front')).toBe('front')
    expect(normalizeCatalogueImageView('front_center')).toBe('front')
    expect(normalizeCatalogueImageView('front_chest')).toBe('front')
    expect(normalizeCatalogueImageView('Front Chest')).toBe('front')
  })

  it('maps back variants to back', () => {
    expect(normalizeCatalogueImageView('back')).toBe('back')
    expect(normalizeCatalogueImageView('back_center')).toBe('back')
    expect(normalizeCatalogueImageView('back_full')).toBe('back')
  })

  it('maps sleeve aliases to the canonical sleeve tokens', () => {
    expect(normalizeCatalogueImageView('sleeve_left')).toBe('left_sleeve')
    expect(normalizeCatalogueImageView('sleeve_right')).toBe('right_sleeve')
  })

  it('maps side_left/side_right to left/right (parity with staff normaliser)', () => {
    expect(normalizeCatalogueImageView('side_left')).toBe('left')
    expect(normalizeCatalogueImageView('side_right')).toBe('right')
  })
})

describe('normalizeCatalogueImageView — filename inference before detail-N', () => {
  it('resolves a detail-N row to back when the filename says BACK', () => {
    expect(
      normalizeCatalogueImageView('detail-31', 'https://cdn.example.com/5001_Staple_Tee_BACK_Ecru.jpg'),
    ).toBe('back')
  })

  it('keeps a bare detail-N row (no filename hint) as front', () => {
    expect(normalizeCatalogueImageView('detail-30')).toBe('front')
  })

  it('does not mis-key a colour word that merely contains "back" (Black)', () => {
    expect(
      normalizeCatalogueImageView('detail-30', 'https://cdn.example.com/5001_Staple_Tee_Black_XL.jpg'),
    ).not.toBe('back')
  })

  it('does not mis-key a colour word that merely contains "side" (Seaside)', () => {
    expect(
      normalizeCatalogueImageView('detail-30', 'https://cdn.example.com/5001_Staple_Tee_Seaside_Blue.jpg'),
    ).not.toBe('right')
  })
})

describe('normalizeCatalogueImageView — unknown input', () => {
  it('returns null for an unrecognised view with no filename hint', () => {
    expect(normalizeCatalogueImageView('mystery')).toBeNull()
    expect(normalizeCatalogueImageView(null)).toBeNull()
    expect(normalizeCatalogueImageView('')).toBeNull()
  })
})
