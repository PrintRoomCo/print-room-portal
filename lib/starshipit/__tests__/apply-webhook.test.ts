import { describe, it, expect } from 'vitest'
import { applyStarshipitWebhook } from '../apply-webhook'

describe('applyStarshipitWebhook', () => {
  it('folds tracking number/url/carrier into tracking_info and emits a tracking update', () => {
    const { trackingInfo, productionUpdate } = applyStarshipitWebhook(
      { carrier: 'NZ Post' },
      {
        order_number: 'PR-1001',
        tracking_number: '00794210392709818080',
        tracking_url: 'https://www.nzpost.co.nz/tools/tracking/item/00794210392709818080',
        carrier_name: 'CourierPost',
        tracking_status: 'Dispatched',
        last_updated_date: '2026-07-15T02:00:00.000Z',
      },
    )
    expect(trackingInfo.trackingNumber).toBe('00794210392709818080')
    expect(trackingInfo.number).toBe('00794210392709818080')
    expect(trackingInfo.url).toContain('nzpost.co.nz')
    expect(trackingInfo.carrier).toBe('CourierPost')
    expect(trackingInfo.updated_at).toBe('2026-07-15T02:00:00.000Z')
    expect(productionUpdate.type).toBe('tracking')
    expect(productionUpdate.title).toBe('Dispatched')
    expect(productionUpdate.metadata?.source).toBe('starshipit')
  })

  it('preserves existing fields when the payload omits them', () => {
    const { trackingInfo } = applyStarshipitWebhook(
      { number: 'X', trackingNumber: 'X', url: 'u', carrier: 'NZ Post' },
      { tracking_status: 'InTransit' },
    )
    expect(trackingInfo.carrier).toBe('NZ Post')
    expect(trackingInfo.trackingNumber).toBe('X')
    expect(trackingInfo.url).toBe('u')
  })
})
