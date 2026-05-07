import { describe, expect, it } from 'vitest'
import { filterDecorationsBySwatch } from './decoration-filter'

interface MinimalDecoration {
  linkId: string
  snapshotColorSwatchId: string | null
}

const a: MinimalDecoration = { linkId: 'a', snapshotColorSwatchId: 'red' }
const b: MinimalDecoration = { linkId: 'b', snapshotColorSwatchId: 'blue' }
const legacy: MinimalDecoration = { linkId: 'legacy', snapshotColorSwatchId: null }

describe('filterDecorationsBySwatch', () => {
  it('keeps only decorations matching the selected swatch + legacy null rows', () => {
    const result = filterDecorationsBySwatch([a, b, legacy], 'red')
    expect(result.map((d) => d.linkId)).toEqual(['a', 'legacy'])
  })

  it('shows all legacy null decorations when no swatch is selected', () => {
    const result = filterDecorationsBySwatch([a, b, legacy], null)
    expect(result.map((d) => d.linkId)).toEqual(['legacy'])
  })

  it('returns an empty list when no decoration matches the swatch and none are legacy', () => {
    expect(filterDecorationsBySwatch([a, b], 'green')).toEqual([])
  })
})
