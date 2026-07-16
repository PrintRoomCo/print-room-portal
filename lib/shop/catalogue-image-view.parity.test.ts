import { describe, it, expect } from 'vitest'
import { normalizeCatalogueImageView } from './catalogue-image-view'

// SHARED cross-portal vector — an EXACT mirror of the staff table in
// src/lib/catalogues/image-view-normalize.parity.test.ts. Keep the two identical.
const SHARED: Array<[string, string]> = [
  ['front', 'front'], ['hero', 'front'], ['front_center', 'front'], ['front_chest', 'front'],
  ['back', 'back'], ['back_center', 'back'], ['back_full', 'back'],
  ['left', 'left'], ['side_left', 'left'],
  ['right', 'right'], ['side_right', 'right'],
  ['left_sleeve', 'left_sleeve'], ['sleeve_left', 'left_sleeve'],
  ['right_sleeve', 'right_sleeve'], ['sleeve_right', 'right_sleeve'],
]

describe('customer normalizer — cross-portal parity', () => {
  it('maps every shared token to the shared canonical', () => {
    for (const [input, expected] of SHARED) {
      expect(normalizeCatalogueImageView(input)).toBe(expected)
    }
  })

  it('pins the KNOWN divergence: customer maps side/top/bottom to themselves', () => {
    // Customer recognises these as canonical; staff returns null (raw-token
    // fallback on the store path bridges the gap). Mirror any change staff-side.
    expect(normalizeCatalogueImageView('side')).toBe('side')
    expect(normalizeCatalogueImageView('top')).toBe('top')
    expect(normalizeCatalogueImageView('bottom')).toBe('bottom')
  })
})
