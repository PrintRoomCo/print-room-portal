import { describe, it, expect, vi } from 'vitest'

const mondayApiCall = vi.fn()
vi.mock('@/lib/monday/client', () => ({
  mondayApiCall: (...a: unknown[]) => mondayApiCall(...(a as [])),
}))

import { extractUrlFromLinkColumn, fetchCustomerTrackingUrl } from '../tracking-link'

describe('extractUrlFromLinkColumn', () => {
  it('reads url from the link column value JSON', () => {
    const col = { value: JSON.stringify({ url: 'https://nzpost.co.nz/track/XYZ', text: 'Track' }), text: 'Track' }
    expect(extractUrlFromLinkColumn(col)).toBe('https://nzpost.co.nz/track/XYZ')
  })

  it('falls back to text when it looks like a URL and value has no url', () => {
    const col = { value: JSON.stringify({ text: '' }), text: 'https://courierpost.co.nz/track/AB1' }
    expect(extractUrlFromLinkColumn(col)).toBe('https://courierpost.co.nz/track/AB1')
  })

  it('returns null when text is a non-URL label and value has no url', () => {
    expect(extractUrlFromLinkColumn({ value: 'null', text: 'Track here' })).toBeNull()
  })

  it('returns null for a null column', () => {
    expect(extractUrlFromLinkColumn(null)).toBeNull()
  })

  it('tolerates malformed value JSON and uses URL-looking text', () => {
    expect(extractUrlFromLinkColumn({ value: '{not json', text: 'https://x.test/1' })).toBe('https://x.test/1')
  })
})

describe('fetchCustomerTrackingUrl', () => {
  it('returns the customer tracking url for the item', async () => {
    mondayApiCall.mockResolvedValue({
      items: [{ column_values: [{ id: 'link_mky1w9w', text: 'Track', value: JSON.stringify({ url: 'https://nzpost.co.nz/track/XYZ' }) }] }],
    })
    expect(await fetchCustomerTrackingUrl('555')).toBe('https://nzpost.co.nz/track/XYZ')
    // queried the customer tracker link column only
    const vars = mondayApiCall.mock.calls[0][1] as { columnIds: string[]; itemIds: string[] }
    expect(vars.columnIds).toEqual(['link_mky1w9w'])
    expect(vars.itemIds).toEqual(['555'])
  })

  it('returns null when the item has no link', async () => {
    mondayApiCall.mockResolvedValue({ items: [{ column_values: [{ id: 'link_mky1w9w', text: '', value: 'null' }] }] })
    expect(await fetchCustomerTrackingUrl('555')).toBeNull()
  })

  it('returns null (never throws) when the Monday call fails', async () => {
    mondayApiCall.mockRejectedValue(new Error('Monday 500'))
    expect(await fetchCustomerTrackingUrl('555')).toBeNull()
  })
})
