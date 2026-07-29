import { describe, it, expect } from 'vitest'
import { RegionQuotaError, parseRegionQuotaError } from '../submit'

describe('RegionQuotaError mapping', () => {
  it('parses the RPC detail payload into a typed error', () => {
    const detail = JSON.stringify({
      code: 'region_quota_exceeded', store_id: 's1', catalogue_item_id: 'c1',
      region_quota: 22, already_ordered: 20, requested: 5, remaining: 2,
    })
    const err = parseRegionQuotaError({ message: 'REGION_QUOTA_EXCEEDED', details: detail })
    expect(err).toBeInstanceOf(RegionQuotaError)
    expect(err?.details.remaining).toBe(2)
    expect(err?.details.region_quota).toBe(22)
  })

  it('returns null for unrelated errors', () => {
    expect(parseRegionQuotaError({ message: 'INSUFFICIENT_STOCK', details: null })).toBeNull()
  })
})
