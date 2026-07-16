import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/checkout/server', () => ({ requireB2BCustomerApi: vi.fn() }))
vi.mock('@/lib/audit/recordEvent', () => ({ recordAuditEvent: vi.fn() }))

import { POST } from '../route'
import { requireB2BCustomerApi } from '@/lib/checkout/server'

/**
 * Fake admin for the membership-invariant test: store lookup succeeds,
 * createUser reports the email already registered, the profile lookup
 * resolves the existing user, and user_organizations holds their current
 * membership row (possibly in ANOTHER org).
 */
function makeAdmin(existingMembership: { user_id: string; organization_id: string } | null) {
  return {
    auth: {
      admin: {
        createUser: vi.fn().mockResolvedValue({
          data: { user: null },
          error: { message: 'A user with this email address has already been registered' },
        }),
        listUsers: vi.fn().mockResolvedValue({ data: { users: [] } }),
      },
    },
    from(table: string) {
      if (table === 'stores') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({ maybeSingle: () => Promise.resolve({ data: { id: 's1' } }) }),
            }),
          }),
        }
      }
      if (table === 'profiles') {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: () => Promise.resolve({ data: { id: 'u-existing' } }) }),
          }),
        }
      }
      // user_organizations — membership lookup keyed on user_id ONLY
      return {
        select: () => ({
          eq: () => ({ maybeSingle: () => Promise.resolve({ data: existingMembership }) }),
        }),
        insert: vi.fn().mockResolvedValue({ error: null }),
      }
    },
  }
}

function req(body: unknown): Request {
  return new Request('http://t/api/team/invite', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

const ADMIN_CTX = {
  admin: {} as never,
  context: { role: 'org_admin', organizationId: 'org-1', userId: 'u-admin', tenantType: 'franchise' } as never,
}

beforeEach(() => vi.clearAllMocks())

describe('POST /api/team/invite — guards', () => {
  it('403s a staff member trying to invite', async () => {
    vi.mocked(requireB2BCustomerApi).mockResolvedValue({
      admin: {} as never,
      context: { role: 'staff', organizationId: 'org-1', userId: 'u-staff', tenantType: 'franchise' } as never,
    })
    const res = await POST(req({ email: 'x@y.co', first_name: 'X', default_store_id: 's1' }))
    expect(res.status).toBe(403)
  })

  it('403s an org_admin trying to mint another org_admin (hard guard)', async () => {
    vi.mocked(requireB2BCustomerApi).mockResolvedValue(ADMIN_CTX)
    const res = await POST(
      req({ email: 'x@y.co', first_name: 'X', default_store_id: 's1', role: 'org_admin' }),
    )
    expect(res.status).toBe(403)
    expect((await res.json()).error).toMatch(/only invite staff/i)
  })

  it('400s when no default ship-to store is supplied', async () => {
    vi.mocked(requireB2BCustomerApi).mockResolvedValue(ADMIN_CTX)
    const res = await POST(req({ email: 'x@y.co', first_name: 'X' }))
    expect(res.status).toBe(400)
  })

  it('409s when the email already belongs to a user in a DIFFERENT organisation (single-membership invariant)', async () => {
    const admin = makeAdmin({ user_id: 'u-existing', organization_id: 'org-OTHER' })
    vi.mocked(requireB2BCustomerApi).mockResolvedValue({ ...ADMIN_CTX, admin: admin as never })
    const res = await POST(req({ email: 'x@y.co', first_name: 'X', default_store_id: 's1' }))
    expect(res.status).toBe(409)
    expect((await res.json()).error).toMatch(/different organisation/i)
  })

  it('409s when the email is already a member of THIS organisation', async () => {
    const admin = makeAdmin({ user_id: 'u-existing', organization_id: 'org-1' })
    vi.mocked(requireB2BCustomerApi).mockResolvedValue({ ...ADMIN_CTX, admin: admin as never })
    const res = await POST(req({ email: 'x@y.co', first_name: 'X', default_store_id: 's1' }))
    expect(res.status).toBe(409)
    expect((await res.json()).error).toMatch(/already a member/i)
  })

  it('400s a studio tenant given a stock_only permission (tenant-scoped)', async () => {
    vi.mocked(requireB2BCustomerApi).mockResolvedValue({
      admin: {} as never,
      context: { role: 'org_admin', organizationId: 'org-1', userId: 'u-admin', tenantType: 'studio' } as never,
    })
    const res = await POST(
      req({ email: 'x@y.co', first_name: 'X', default_store_id: 's1', ordering_permission: 'stock_only' }),
    )
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/ordering permission/i)
  })
})
