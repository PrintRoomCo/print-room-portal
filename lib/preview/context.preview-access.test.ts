import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// buildPreviewAccess pulls its admin client from @/lib/supabase and resolves
// the viewer's Access via @/lib/company.getCompanyAccess. Stub both so the
// function runs against an in-memory membership row.
// ---------------------------------------------------------------------------

const adminHolder: { admin: unknown } = { admin: null }
vi.mock('@/lib/supabase', () => ({
  getSupabaseServer: vi.fn(() => adminHolder.admin),
}))

const accessHolder: { access: unknown } = { access: null }
vi.mock('@/lib/company', () => ({
  getCompanyAccess: vi.fn(async () => accessHolder.access),
}))

import { buildPreviewAccess } from './context'

type AnyRow = Record<string, unknown>
type TableResp = { data: unknown; error: { message: string } | null }

const ORG_ID = '6c65151e-fbd8-49f3-9b66-5e7dd0e13436'

/** Per-table Supabase stub supporting select/eq/single/maybeSingle/await. */
function makeAdmin(selects: Record<string, TableResp>) {
  function builder(table: string) {
    const resp = selects[table] ?? { data: [], error: null }
    const b: AnyRow = {
      select: () => b,
      eq: () => b,
      single: async () => resp,
      maybeSingle: async () => resp,
      then: (res: (v: unknown) => unknown) => Promise.resolve(resp).then(res),
    }
    return b
  }
  return { from: vi.fn((t: string) => builder(t)) }
}

const PAYLOAD = { org: ORG_ID, target: { membershipId: 'm1' } } as never

function setup(membershipRow: AnyRow) {
  adminHolder.admin = makeAdmin({
    user_organizations: { data: membershipRow, error: null },
    profiles: { data: { full_name: 'Jamie' }, error: null },
  })
  accessHolder.access = { companyId: ORG_ID, email: 'jamie@example.com' }
}

beforeEach(() => vi.clearAllMocks())

describe('buildPreviewAccess — previewAs.orderingPermission is the EFFECTIVE permission', () => {
  it('elevates an org_admin previewed with stored stock_only to both (banner must not say "stock only")', async () => {
    setup({
      user_id: 'u1', organization_id: ORG_ID,
      role: 'org_admin', ordering_permission: 'stock_only',
    })

    const access = await buildPreviewAccess(PAYLOAD)
    if (!access) throw new Error('expected access, got null')

    expect(access.previewAs?.role).toBe('org_admin')
    expect(access.previewAs?.orderingPermission).toBe('both')
  })

  it('keeps a previewed staff member on their stored stock_only', async () => {
    setup({
      user_id: 'u1', organization_id: ORG_ID,
      role: 'staff', ordering_permission: 'stock_only',
    })

    const access = await buildPreviewAccess(PAYLOAD)
    if (!access) throw new Error('expected access, got null')

    expect(access.previewAs?.orderingPermission).toBe('stock_only')
  })
})
