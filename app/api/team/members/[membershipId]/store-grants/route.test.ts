import { describe, expect, it, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireB2BCustomerApi: vi.fn(),
  recordAuditEvent: vi.fn(),
}))

vi.mock('@/lib/checkout/server', () => ({
  requireB2BCustomerApi: mocks.requireB2BCustomerApi,
}))
vi.mock('@/lib/audit/recordEvent', () => ({
  recordAuditEvent: mocks.recordAuditEvent,
}))

import { PUT as PUTRaw } from './route'

const PUT = PUTRaw as unknown as (
  req: Request,
  ctx: { params: Promise<{ membershipId: string }> },
) => Promise<Response>

/**
 * Table-keyed Supabase stub (mirrors the staff store-grants route test): the
 * builder is thenable so an awaited select().eq() resolves to the table's rows;
 * delete().eq().in() and insert() record their args.
 */
function makeAdmin(cfg: {
  membershipInOrg?: boolean
  orgStoreIds?: string[]
  existingGrants?: string[]
}) {
  const membershipInOrg = cfg.membershipInOrg ?? true
  const orgStoreIds = cfg.orgStoreIds ?? []
  const existingGrants = cfg.existingGrants ?? []
  const calls = { inserts: [] as unknown[][], deletes: [] as string[][] }
  let table: string | null = null

  const resultForTable = () => {
    if (table === 'stores') return { data: orgStoreIds.map((id) => ({ id, name: id })), error: null }
    if (table === 'b2b_member_store_grants')
      return { data: existingGrants.map((store_id) => ({ store_id })), error: null }
    return { data: [], error: null }
  }

  const api: Record<string, unknown> = {}
  Object.assign(api, {
    from: vi.fn((t: string) => {
      table = t
      return api
    }),
    select: vi.fn(() => api),
    eq: vi.fn(() => api),
    order: vi.fn(async () => resultForTable()),
    maybeSingle: vi.fn(async () => ({ data: membershipInOrg ? { id: 'm-1' } : null, error: null })),
    delete: vi.fn(() => ({
      eq: () => ({
        in: async (_c: string, ids: string[]) => {
          calls.deletes.push(ids)
          return { error: null }
        },
      }),
    })),
    insert: vi.fn(async (rows: unknown[]) => {
      calls.inserts.push(rows)
      return { error: null }
    }),
    then: (resolve: (v: unknown) => void) => resolve(resultForTable()),
  })
  return { api, calls }
}

function req(body: unknown) {
  return new Request('http://localhost/x', { method: 'PUT', body: JSON.stringify(body) })
}
const params = { params: Promise.resolve({ membershipId: 'm-1' }) }

beforeEach(() => {
  mocks.requireB2BCustomerApi.mockReset()
  mocks.recordAuditEvent.mockReset()
  mocks.recordAuditEvent.mockResolvedValue(undefined)
})

function authOk(admin: unknown, role: 'org_admin' | 'staff' = 'org_admin') {
  mocks.requireB2BCustomerApi.mockResolvedValue({
    admin,
    context: { role, organizationId: 'org-1', userId: 'u-1' },
  })
}

describe('PUT team store-grants (customer mirror)', () => {
  it('403 when the caller is not an org_admin', async () => {
    const { api } = makeAdmin({ orgStoreIds: ['s-1'] })
    authOk(api, 'staff')
    const res = await PUT(req({ storeIds: ['s-1'] }), params)
    expect(res.status).toBe(403)
  })

  it('404 when the target membership is not in the admin’s org', async () => {
    const { api } = makeAdmin({ membershipInOrg: false, orgStoreIds: ['s-1'] })
    authOk(api)
    const res = await PUT(req({ storeIds: ['s-1'] }), params)
    expect(res.status).toBe(404)
  })

  it('422 when a store belongs to another org', async () => {
    const { api } = makeAdmin({ orgStoreIds: ['s-1'] })
    authOk(api)
    const res = await PUT(req({ storeIds: ['s-1', 's-OTHER'] }), params)
    expect(res.status).toBe(422)
  })

  it('happy path: applies the diff and records one audit event', async () => {
    const { api, calls } = makeAdmin({ orgStoreIds: ['s-1', 's-2', 's-3'], existingGrants: ['s-1', 's-2'] })
    authOk(api)
    const res = await PUT(req({ storeIds: ['s-2', 's-3'] }), params)
    expect(res.status).toBe(200)
    expect(calls.deletes).toEqual([['s-1']])
    expect(calls.inserts).toEqual([[{ membership_id: 'm-1', store_id: 's-3', granted_by: 'u-1' }]])
    expect(mocks.recordAuditEvent).toHaveBeenCalledTimes(1)
    expect(mocks.recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'b2b_member_store_grants.change', targetId: 'm-1' }),
    )
  })
})
