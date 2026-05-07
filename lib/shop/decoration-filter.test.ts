import { describe, expect, it } from 'vitest'
import { filterDecorationsBySwatch } from './decoration-filter'

interface MinimalDecoration {
  linkId: string
  decorationId: string
  snapshotColorSwatchId: string | null
}

const a: MinimalDecoration = {
  linkId: 'a',
  decorationId: 'dec-1',
  snapshotColorSwatchId: 'red',
}
const b: MinimalDecoration = {
  linkId: 'b',
  decorationId: 'dec-2',
  snapshotColorSwatchId: 'blue',
}
const legacy: MinimalDecoration = {
  linkId: 'legacy',
  decorationId: 'dec-3',
  snapshotColorSwatchId: null,
}

describe('filterDecorationsBySwatch', () => {
  it('keeps only decorations matching the selected swatch + legacy null rows', () => {
    const result = filterDecorationsBySwatch([a, b, legacy], 'red')
    expect(result.map((d) => d.linkId).sort()).toEqual(['a', 'legacy'])
  })

  it('shows all legacy null decorations when no swatch is selected', () => {
    const result = filterDecorationsBySwatch([a, b, legacy], null)
    expect(result.map((d) => d.linkId)).toEqual(['legacy'])
  })

  it('returns an empty list when no decoration matches the swatch and none are legacy', () => {
    expect(filterDecorationsBySwatch([a, b], 'green')).toEqual([])
  })

  it('prefers swatch-specific row over null-swatch row for the same decorationId', () => {
    // Same org_decoration_id with both an "All colours" (null) row and a
    // swatch-specific row for red. On the red swatch the customer must see
    // ONLY the specific row, not both — otherwise overlays double up.
    const allColours: MinimalDecoration = {
      linkId: 'all',
      decorationId: 'dec-shared',
      snapshotColorSwatchId: null,
    }
    const redSpecific: MinimalDecoration = {
      linkId: 'red-specific',
      decorationId: 'dec-shared',
      snapshotColorSwatchId: 'red',
    }
    const result = filterDecorationsBySwatch([allColours, redSpecific], 'red')
    expect(result.map((d) => d.linkId)).toEqual(['red-specific'])
  })

  it('falls back to the null-swatch row for swatches with no specific override', () => {
    const allColours: MinimalDecoration = {
      linkId: 'all',
      decorationId: 'dec-shared',
      snapshotColorSwatchId: null,
    }
    const redSpecific: MinimalDecoration = {
      linkId: 'red-specific',
      decorationId: 'dec-shared',
      snapshotColorSwatchId: 'red',
    }
    // Customer is on blue — no blue-specific row exists, so the "All
    // colours" row should still render.
    const result = filterDecorationsBySwatch([allColours, redSpecific], 'blue')
    expect(result.map((d) => d.linkId)).toEqual(['all'])
  })

  it('does not collapse independent decorations that happen to share a swatch', () => {
    const dec1Red: MinimalDecoration = {
      linkId: '1',
      decorationId: 'dec-1',
      snapshotColorSwatchId: 'red',
    }
    const dec2Red: MinimalDecoration = {
      linkId: '2',
      decorationId: 'dec-2',
      snapshotColorSwatchId: 'red',
    }
    const result = filterDecorationsBySwatch([dec1Red, dec2Red], 'red')
    expect(result.map((d) => d.linkId).sort()).toEqual(['1', '2'])
  })
})
