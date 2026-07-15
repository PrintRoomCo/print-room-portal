import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  access: vi.fn(),
  trackerData: vi.fn(async () => ({
    trackers: [],
    isCompanyWide: false,
    ownerKey: null,
    preOrders: [],
  })),
}))

vi.mock('@/lib/portal-data', () => ({
  getPortalCompanyAccess: mocks.access,
  getPortalOrderTrackerData: mocks.trackerData,
}))

import { GET } from '../route'

beforeEach(() => vi.clearAllMocks())

describe('GET /api/order-tracker admin guard (Item 5)', () => {
  it('401s unauthenticated requests without loading tracker data', async () => {
    mocks.access.mockResolvedValueOnce(null)

    const response = await GET()

    expect(response.status).toBe(401)
    expect(mocks.trackerData).not.toHaveBeenCalled()
  })

  it('403s staff requests without loading tracker data', async () => {
    mocks.access.mockResolvedValueOnce({ isOrgAdmin: false })

    const response = await GET()

    expect(response.status).toBe(403)
    expect(mocks.trackerData).not.toHaveBeenCalled()
  })

  it('returns tracker data to org admins', async () => {
    mocks.access.mockResolvedValueOnce({ isOrgAdmin: true })

    const response = await GET()

    expect(response.status).toBe(200)
    expect(mocks.trackerData).toHaveBeenCalledOnce()
  })
})
