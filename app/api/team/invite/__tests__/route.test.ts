import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/checkout/server', () => ({ requireB2BCustomerApi: vi.fn() }))

import { POST } from '../route'
import { requireB2BCustomerApi } from '@/lib/checkout/server'

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
