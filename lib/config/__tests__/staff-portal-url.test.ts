import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { staffPortalBaseUrl, staffOrderUrl } from '../staff-portal-url'

const ENV_KEYS = ['STAFF_PORTAL_URL', 'NEXT_PUBLIC_APP_URL'] as const

describe('staff-portal-url', () => {
  const saved: Record<string, string | undefined> = {}
  beforeEach(() => {
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k]
      delete process.env[k]
    }
  })
  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k]
      else process.env[k] = saved[k]
    }
  })

  it('staffPortalBaseUrl falls back to the production staff domain when nothing is set', () => {
    expect(staffPortalBaseUrl()).toBe('https://staff.theprintroom.nz')
  })

  it('staffPortalBaseUrl prefers STAFF_PORTAL_URL and strips trailing slashes', () => {
    process.env.STAFF_PORTAL_URL = 'https://staging-staff.example.com//'
    expect(staffPortalBaseUrl()).toBe('https://staging-staff.example.com')
  })

  it('staffPortalBaseUrl uses NEXT_PUBLIC_APP_URL as a secondary source', () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://staff.theprintroom.nz/'
    expect(staffPortalBaseUrl()).toBe('https://staff.theprintroom.nz')
  })

  it('staffOrderUrl deep-links to the staff order detail page — NOT the customer portal', () => {
    expect(staffOrderUrl('ord-123')).toBe('https://staff.theprintroom.nz/orders/ord-123')
  })
})
