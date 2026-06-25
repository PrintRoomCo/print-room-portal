import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks (hoisted). requireB2BCustomer pulls its clients from these modules;
// we stub them so the function runs against an in-memory membership row.
// ---------------------------------------------------------------------------

vi.mock('@/lib/preview/cookie', () => ({
  readPreviewSession: vi.fn().mockResolvedValue(null),
}))
// buildPreviewContext is never reached (no preview cookie); stub to avoid
// loading its dependency cascade.
vi.mock('@/lib/preview/context', () => ({
  buildPreviewContext: vi.fn(),
}))

const adminHolder: { admin: unknown } = { admin: null }
vi.mock('@/lib/supabase', () => ({
  getSupabaseServer: vi.fn(() => adminHolder.admin),
}))
vi.mock('@/lib/supabase-server-component', () => ({
  getSupabaseServerComponent: vi.fn(async () => ({
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: 'user-1', email: 'jamie@example.com' } },
      }),
    },
  })),
}))

import { requireB2BCustomer } from '../server'

type AnyRow = Record<string, unknown>
type TableResp = { data: unknown; error: { message: string } | null }

const ORG_ID = '6c65151e-fbd8-49f3-9b66-5e7dd0e13436'

/** Per-table Supabase stub supporting select/eq/in/single/maybeSingle/await. */
function makeAdmin(selects: Record<string, TableResp>) {
  function builder(table: string) {
    const resp = selects[table] ?? { data: [], error: null }
    const b: AnyRow = {
      select: () => b,
      eq: () => b,
      in: () => b,
      single: async () => resp,
      maybeSingle: async () => resp,
      then: (res: (v: unknown) => unknown) => Promise.resolve(resp).then(res),
    }
    return b
  }
  return { from: vi.fn((t: string) => builder(t)) }
}

function adminFor(membershipRow: AnyRow) {
  return makeAdmin({
    user_organizations: { data: membershipRow, error: null },
    organizations: { data: { id: ORG_ID, name: 'Anytime Fitness', customer_code: 'ANFI' }, error: null },
    b2b_accounts: {
      data: { id: 'b1', tier_level: 1, payment_terms: 'net30', tenant_type: 'franchise' },
      error: null,
    },
    stores: { data: [], error: null },
    profiles: { data: { email: 'jamie@example.com', full_name: 'Jamie' }, error: null },
  })
}

beforeEach(() => vi.clearAllMocks())

describe('requireB2BCustomer — orderingPermission is the EFFECTIVE permission', () => {
  it('elevates an org_admin with stored stock_only to both (role overrides stored value)', async () => {
    adminHolder.admin = adminFor({
      id: 'm1', organization_id: ORG_ID, default_store_id: null,
      role: 'org_admin', ordering_permission: 'stock_only',
    })

    const result = await requireB2BCustomer()
    if ('kind' in result) throw new Error(`expected context, got failure ${result.kind}`)

    expect(result.context.role).toBe('org_admin')
    expect(result.context.orderingPermission).toBe('both')
  })

  it('keeps a staff member on their stored stock_only permission', async () => {
    adminHolder.admin = adminFor({
      id: 'm1', organization_id: ORG_ID, default_store_id: null,
      role: 'staff', ordering_permission: 'stock_only',
    })

    const result = await requireB2BCustomer()
    if ('kind' in result) throw new Error(`expected context, got failure ${result.kind}`)

    expect(result.context.role).toBe('staff')
    expect(result.context.orderingPermission).toBe('stock_only')
  })

  it('defaults a staff member with no stored permission to least-privilege stock_only', async () => {
    adminHolder.admin = adminFor({
      id: 'm1', organization_id: ORG_ID, default_store_id: null,
      role: 'staff', ordering_permission: null,
    })

    const result = await requireB2BCustomer()
    if ('kind' in result) throw new Error(`expected context, got failure ${result.kind}`)

    expect(result.context.orderingPermission).toBe('stock_only')
  })
})
