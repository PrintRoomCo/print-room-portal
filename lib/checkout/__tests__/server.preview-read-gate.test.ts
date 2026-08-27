import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Regression: 2026-08-27 — every Anytime Fitness PDP rendered "not orderable
// to NZ yet" in staff preview. The PDP's price fetches hit read-only API
// routes guarded by requireB2BCustomerApi, which 403s preview sessions as if
// every API route were a write. A non-ok pricing response is indistinguishable
// from "this country has no price", so the whole ordering UI swapped out.
// Read-only price lookups opt in via allowPreview; writes keep rejecting.
// ---------------------------------------------------------------------------

const PREVIEW_CONTEXT = {
  userId: 'staff-preview',
  membershipId: 'm-preview',
  role: 'org_admin' as const,
  email: 'jordan@anytimefitness.co.nz',
  fullName: 'Preview Member',
  organizationId: '6c65151e-fbd8-49f3-9b66-5e7dd0e13436',
  organizationName: 'Anytime Fitness',
  customerCode: 'ANFI',
  isTest: false,
  b2bAccountId: 'b1',
  tierLevel: 1,
  paymentTerms: 'net30',
  contractNotes: null,
  pricingMode: null,
  defaultDepositPercent: null,
  storeIds: [],
  defaultStoreId: null,
  branchStoreIds: [],
  minOrderExempt: false,
  orderingPermission: 'both' as const,
  isPreview: true,
}

vi.mock('@/lib/preview/cookie', () => ({
  readPreviewSession: vi.fn().mockResolvedValue({ target: 'm-preview' }),
}))
vi.mock('@/lib/preview/context', () => ({
  buildPreviewContext: vi.fn(async () => ({
    admin: { from: vi.fn() },
    context: PREVIEW_CONTEXT,
  })),
}))
vi.mock('@/lib/supabase', () => ({
  getSupabaseServer: vi.fn(() => ({ from: vi.fn() })),
}))
vi.mock('@/lib/portal-data', () => ({
  getPortalUser: vi.fn().mockResolvedValue(null),
}))
vi.mock('@/lib/supabase-server-component', () => ({
  getSupabaseServerComponent: vi.fn(),
}))

import { requireB2BCustomerApi } from '../server'

beforeEach(() => vi.clearAllMocks())

describe('requireB2BCustomerApi — preview sessions on read-only routes', () => {
  it('still rejects a preview session by default (write routes)', async () => {
    const result = await requireB2BCustomerApi()
    expect('error' in result).toBe(true)
    if ('error' in result) expect(result.error.status).toBe(403)
  })

  it('allowPreview: true lets a preview session through (read-only price lookups)', async () => {
    const result = await requireB2BCustomerApi({ allowPreview: true })
    expect('error' in result).toBe(false)
    if (!('error' in result)) {
      expect(result.context.isPreview).toBe(true)
      expect(result.context.organizationId).toBe(PREVIEW_CONTEXT.organizationId)
    }
  })
})
