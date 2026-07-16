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
    members?: Array<{ user_id: string }>
    profiles?: Array<{ id: string; email: string | null }>
    otpError?: { message: string } | null
  } = {},
) {
  const updates: Array<Record<string, unknown>> = []
  const signInWithOtp = vi.fn().mockResolvedValue({ error: opts.otpError ?? null })
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
        select: () => ({
          eq: () => ({
            is: () => Promise.resolve({ data: opts.members ?? [], error: null }),
            in: (_col: string, ids: string[]) =>
              Promise.resolve({
                data: (opts.members ?? []).filter((m) => ids.includes(m.user_id)),
                error: null,
              }),
          }),
        }),
        update: (payload: Record<string, unknown>) => ({
          eq: () => ({
            eq: () => {
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
