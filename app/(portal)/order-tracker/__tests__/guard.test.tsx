import { describe, it, expect, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  access: vi.fn(),
  trackerData: vi.fn(async () => ({ trackers: [], isCompanyWide: false, ownerKey: null, preOrders: [] })),
}))

vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`)
  },
}))

vi.mock('@/lib/portal-data', () => ({
  getPortalCompanyAccess: mocks.access,
  getPortalOrderTrackerData: mocks.trackerData,
}))

// The client is a heavy 'use client' component — stub it so the page module imports cleanly.
vi.mock('../OrderTrackerClient', () => ({ OrderTrackerClient: () => null }))

describe('OrderTrackerPage guard (Item 5)', () => {
  beforeEach(() => {
    mocks.trackerData.mockClear()
  })

  it('redirects a staff (non-admin) user to /my-collections and never loads tracker data', async () => {
    mocks.access.mockResolvedValueOnce({ isOrgAdmin: false } as never)
    const { default: OrderTrackerPage } = await import('../page')
    await expect(OrderTrackerPage()).rejects.toThrow('REDIRECT:/my-collections')
    expect(mocks.trackerData).not.toHaveBeenCalled()
  })

  it('redirects an unauthenticated user to /sign-in', async () => {
    mocks.access.mockResolvedValueOnce(null)
    const { default: OrderTrackerPage } = await import('../page')
    await expect(OrderTrackerPage()).rejects.toThrow('REDIRECT:/sign-in')
  })

  it('lets an org_admin through (loads tracker data)', async () => {
    mocks.access.mockResolvedValueOnce({ isOrgAdmin: true } as never)
    const { default: OrderTrackerPage } = await import('../page')
    await OrderTrackerPage()
    expect(mocks.trackerData).toHaveBeenCalledOnce()
  })
})
