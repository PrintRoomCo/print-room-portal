import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('next/cache', () => ({ revalidateTag: vi.fn() }))
vi.mock('@/lib/supabase-server-component', () => ({ getSupabaseServerComponent: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ getSupabaseServer: vi.fn() }))
// actions.ts imports changePassword at module scope; stub so import resolves.
vi.mock('@/lib/supabase-auth', () => ({ changePassword: vi.fn() }))
// Preview guard reads cookies(); stub it to the non-preview path for these tests.
vi.mock('@/lib/preview/guard', () => ({ isPreviewRequest: vi.fn(async () => false) }))

import { createLocationAction } from '../actions'
import { getSupabaseServerComponent } from '@/lib/supabase-server-component'
import { getSupabaseServer } from '@/lib/supabase'

type AnyRow = Record<string, unknown>

/**
 * Minimal chainable Supabase admin stub.
 * - user_organizations: `.select().eq().single()` → the configured membership.
 * - stores: `.insert()` records the call and resolves `{ error }`.
 */
function makeAdmin(opts: {
  membership: { data: unknown; error: unknown }
  insertResult?: { error: unknown }
  storesInsert?: ReturnType<typeof vi.fn>
}) {
  function builder(table: string): AnyRow {
    const b: AnyRow = {
      select: () => b,
      eq: () => b,
      single: async () =>
        table === 'user_organizations' ? opts.membership : { data: null, error: null },
      insert: (payload: unknown) => {
        if (table === 'stores') opts.storesInsert?.(payload)
        return Promise.resolve(opts.insertResult ?? { error: null })
      },
    }
    return b
  }
  return { from: vi.fn((t: string) => builder(t)) }
}

function mockAuth(user: { id: string } | null) {
  vi.mocked(getSupabaseServerComponent).mockResolvedValue({
    auth: { getUser: async () => ({ data: { user }, error: null }) },
  } as never)
}

function formData(fields: Record<string, string>): FormData {
  const fd = new FormData()
  for (const [k, v] of Object.entries(fields)) fd.set(k, v)
  return fd
}

beforeEach(() => vi.clearAllMocks())

describe('createLocationAction — org_admin guard', () => {
  it('rejects a non-admin member and never inserts a store', async () => {
    mockAuth({ id: 'u-1' })
    const storesInsert = vi.fn()
    vi.mocked(getSupabaseServer).mockReturnValue(
      makeAdmin({
        membership: { data: { organization_id: 'org-1', role: 'buyer' }, error: null },
        storesInsert,
      }) as never,
    )

    const result = await createLocationAction(formData({ storeName: 'Auckland Downtown' }))

    expect(result.success).toBe(false)
    expect(storesInsert).not.toHaveBeenCalled()
  })

  it('allows an org_admin to create a store', async () => {
    mockAuth({ id: 'u-1' })
    const storesInsert = vi.fn()
    vi.mocked(getSupabaseServer).mockReturnValue(
      makeAdmin({
        membership: { data: { organization_id: 'org-1', role: 'org_admin' }, error: null },
        storesInsert,
      }) as never,
    )

    const result = await createLocationAction(formData({ storeName: 'Auckland Downtown' }))

    expect(result.success).toBe(true)
    expect(storesInsert).toHaveBeenCalledTimes(1)
  })
})
