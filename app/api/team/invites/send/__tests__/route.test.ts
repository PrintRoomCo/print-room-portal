import { describe, it, expect, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireB2BCustomerApi: vi.fn(),
  recordAuditEvent: vi.fn(),
}))
vi.mock('@/lib/checkout/server', () => ({ requireB2BCustomerApi: mocks.requireB2BCustomerApi }))
vi.mock('@/lib/audit/recordEvent', () => ({ recordAuditEvent: mocks.recordAuditEvent }))

import { POST } from '../route'

/**
 * Fake matching the send route:
 *   from('user_organizations').select().eq().is()   -> uninvited members (default path)
 *   from('user_organizations').select().eq().in()   -> members ∩ explicit userIds (org-scoped)
 *   from('profiles').select().in()                  -> { data: [{ id, email }] }
 *   from('user_organizations').update().eq().eq()   -> { error: null } (records update)
 *   auth.signInWithOtp()                            -> { error }
 */
function makeAdmin(
  opts: {
    members?: Array<{ user_id: string; role?: 'staff' | 'org_admin'; invited_at?: string | null }>
    profiles?: Array<{ id: string; email: string | null; last_sign_in_at?: string | null }>
    otpError?: { message: string } | null
    updateError?: { message: string } | null
  } = {},
) {
  const updates: Array<Record<string, unknown>> = []
  const signInWithOtp = vi.fn().mockResolvedValue({ error: opts.otpError ?? null })
  const membershipFilters = new Map<string, unknown>()
  const filteredMemberships = () =>
    (opts.members ?? []).filter((member) =>
      [...membershipFilters].every(([column, value]) => {
        if (column === 'organization_id') return value === 'org-1'
        if (column === 'role') return (member.role ?? 'staff') === value
        return true
      }),
    )
  const membershipSelect = {
    eq(column: string, value: unknown) {
      membershipFilters.set(column, value)
      return membershipSelect
    },
    is(column: string, value: unknown) {
      const data = filteredMemberships().filter((member) => {
        if (column === 'invited_at') return (member.invited_at ?? null) === value
        return true
      })
      return Promise.resolve({ data, error: null })
    },
    in(_column: string, ids: string[]) {
      return Promise.resolve({
        data: filteredMemberships().filter((member) => ids.includes(member.user_id)),
        error: null,
      })
    },
  }
  const admin = {
    auth: { signInWithOtp },
    from(table: string) {
      if (table === 'profiles') {
        return {
          select: () => ({ in: () => Promise.resolve({ data: opts.profiles ?? [], error: null }) }),
        }
      }
      // user_organizations
      return {
        select: () => membershipSelect,
        update: (payload: Record<string, unknown>) => ({
          eq: () => ({
            eq: () => {
              if (opts.updateError) return Promise.resolve({ error: opts.updateError })
              updates.push(payload)
              return Promise.resolve({ error: null })
            },
          }),
        }),
      }
    },
  }
  return { admin, signInWithOtp, updates }
}

const req = (body?: unknown) =>
  new Request('http://t/api/team/invites/send', {
    method: 'POST',
    body: body === undefined ? null : JSON.stringify(body),
  })

function adminCtx(admin: unknown) {
  return {
    admin: admin as never,
    context: { role: 'org_admin', organizationId: 'org-1', userId: 'u-admin', tenantType: 'franchise' } as never,
  }
}

beforeEach(() => vi.clearAllMocks())

describe('POST /api/team/invites/send', () => {
  it('403s a staff member', async () => {
    const f = makeAdmin()
    mocks.requireB2BCustomerApi.mockResolvedValue({
      admin: f.admin as never,
      context: { role: 'staff', organizationId: 'org-1', userId: 'u-staff' } as never,
    })
    const res = await POST(req({}))
    expect(res.status).toBe(403)
    expect(f.signInWithOtp).not.toHaveBeenCalled()
  })

  it('emails every not-yet-invited member, stamps invited_at, audits each send', async () => {
    const f = makeAdmin({
      members: [{ user_id: 'u1' }, { user_id: 'u2' }],
      profiles: [
        { id: 'u1', email: 'a@x.nz' },
        { id: 'u2', email: 'b@x.nz' },
      ],
    })
    mocks.requireB2BCustomerApi.mockResolvedValue(adminCtx(f.admin))

    const res = await POST(req({}))
    expect(res.status).toBe(200)
    const json = (await res.json()) as { sent: number; failed: number }

    expect(f.signInWithOtp).toHaveBeenCalledTimes(2)
    expect(f.updates).toHaveLength(2)
    expect(f.updates[0]).toHaveProperty('invited_at')
    expect(json).toMatchObject({ sent: 2, failed: 0 })
    expect(mocks.recordAuditEvent).toHaveBeenCalledTimes(2)
  })

  it('never emails an org admin whose legacy membership has invited_at NULL', async () => {
    const f = makeAdmin({
      members: [
        { user_id: 'u-staff', role: 'staff', invited_at: null },
        { user_id: 'u-admin', role: 'org_admin', invited_at: null },
      ],
      profiles: [
        { id: 'u-staff', email: 'staff@x.nz' },
        { id: 'u-admin', email: 'admin@x.nz' },
      ],
    })
    mocks.requireB2BCustomerApi.mockResolvedValue(adminCtx(f.admin))

    const res = await POST(req({}))
    const json = (await res.json()) as { sent: number; failed: number }

    expect(json).toMatchObject({ sent: 1, failed: 0 })
    expect(f.signInWithOtp).toHaveBeenCalledTimes(1)
    expect(f.signInWithOtp).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'staff@x.nz' }),
    )
  })

  it('never emails active staff whose legacy membership has invited_at NULL', async () => {
    const f = makeAdmin({
      members: [{ user_id: 'u-active', role: 'staff', invited_at: null }],
      profiles: [
        {
          id: 'u-active',
          email: 'active@x.nz',
          last_sign_in_at: '2026-07-01T00:00:00Z',
        },
      ],
    })
    mocks.requireB2BCustomerApi.mockResolvedValue(adminCtx(f.admin))

    const res = await POST(req({}))
    const json = (await res.json()) as { sent: number; failed: number }

    expect(json).toMatchObject({ sent: 0, failed: 0 })
    expect(f.signInWithOtp).not.toHaveBeenCalled()
  })

  it('counts an OTP failure as failed and does not stamp invited_at for it', async () => {
    const f = makeAdmin({
      members: [{ user_id: 'u1' }],
      profiles: [{ id: 'u1', email: 'a@x.nz' }],
      otpError: { message: 'rate limited' },
    })
    mocks.requireB2BCustomerApi.mockResolvedValue(adminCtx(f.admin))

    const res = await POST(req({}))
    const json = (await res.json()) as { sent: number; failed: number }
    expect(json).toMatchObject({ sent: 0, failed: 1 })
    expect(f.updates).toHaveLength(0)
  })

  it('counts a failed invited_at stamp as failed (prevents silent duplicate re-sends)', async () => {
    const f = makeAdmin({
      members: [{ user_id: 'u1' }],
      profiles: [{ id: 'u1', email: 'a@x.nz' }],
      updateError: { message: 'connection reset' },
    })
    mocks.requireB2BCustomerApi.mockResolvedValue(adminCtx(f.admin))

    const res = await POST(req({}))
    const json = (await res.json()) as {
      sent: number
      failed: number
      rows: Array<{ status: string; reason?: string }>
    }
    expect(json).toMatchObject({ sent: 0, failed: 1 })
    expect(json.rows[0].reason).toMatch(/stamp/i)
    expect(mocks.recordAuditEvent).not.toHaveBeenCalled()
  })

  it('ignores explicit userIds outside the org (no OTP fires for foreign users)', async () => {
    const f = makeAdmin({
      members: [{ user_id: 'u1' }],
      profiles: [{ id: 'u1', email: 'a@x.nz' }],
    })
    mocks.requireB2BCustomerApi.mockResolvedValue(adminCtx(f.admin))

    const res = await POST(req({ userIds: ['u-foreign'] }))
    expect(res.status).toBe(200)
    const json = (await res.json()) as { sent: number; failed: number }
    expect(json).toMatchObject({ sent: 0, failed: 0 })
    expect(f.signInWithOtp).not.toHaveBeenCalled()
  })
})
