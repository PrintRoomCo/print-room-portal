import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('next/cache', () => ({ revalidateTag: vi.fn() }))
vi.mock('@/lib/supabase-server-component', () => ({ getSupabaseServerComponent: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ getSupabaseServer: vi.fn() }))
// actions.ts imports changePassword at module scope; stub so import resolves.
vi.mock('@/lib/supabase-auth', () => ({ changePassword: vi.fn() }))
// Preview guard reads cookies(); stub it to the non-preview path for these tests.
vi.mock('@/lib/preview/guard', () => ({ isPreviewRequest: vi.fn(async () => false) }))

import {
  createLocationAction,
  updateLocationAction,
  updateOrgLogoAction,
  removeOrgLogoAction,
} from '../actions'
import { getSupabaseServerComponent } from '@/lib/supabase-server-component'
import { getSupabaseServer } from '@/lib/supabase'

type AnyRow = Record<string, unknown>

/**
 * Minimal chainable Supabase admin stub.
 * - user_organizations: `.select().eq().single()` → the configured membership.
 * - stores: `.insert()` records the call and resolves `{ error }`.
 * - stores: `.update().eq().eq()` records `{ payload, filters }` (the two eq
 *   filters that scope the write) and resolves `{ error }`.
 */
function makeAdmin(opts: {
  membership: { data: unknown; error: unknown }
  insertResult?: { error: unknown }
  updateResult?: { error: unknown }
  storesInsert?: ReturnType<typeof vi.fn>
  storesUpdate?: ReturnType<typeof vi.fn>
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
      update: (payload: unknown) => {
        const filters: Record<string, unknown> = {}
        const chain: AnyRow = {
          eq: (col: string, val: unknown) => {
            filters[col] = val
            return chain
          },
          then: (
            resolve: (v: { error: unknown }) => unknown,
            reject: (e: unknown) => unknown,
          ) => {
            if (table === 'stores') opts.storesUpdate?.({ payload, filters })
            return Promise.resolve(opts.updateResult ?? { error: null }).then(resolve, reject)
          },
        }
        return chain
      },
    }
    return b
  }
  return { from: vi.fn((t: string) => builder(t)) }
}

/**
 * Admin stub for the org-logo actions. Adds a `.storage` surface and an
 * `organizations.update().eq()` chain on top of the membership lookup.
 * `__upload` / `__orgUpdate` record calls so tests can assert side effects.
 */
function makeLogoAdmin(opts: {
  membership: { data: unknown; error: unknown }
  uploadResult?: { error: unknown }
}) {
  const upload = vi.fn()
  const orgUpdate = vi.fn()

  function from(table: string): AnyRow {
    const b: AnyRow = {
      select: () => b,
      eq: () => b,
      single: async () =>
        table === 'user_organizations' ? opts.membership : { data: null, error: null },
      update: (payload: unknown) => {
        if (table === 'organizations') orgUpdate(payload)
        return { eq: async () => ({ error: null }) }
      },
    }
    return b
  }

  const bucket = {
    upload: (...args: unknown[]) => {
      upload(...args)
      return Promise.resolve(opts.uploadResult ?? { error: null })
    },
    getPublicUrl: (path: string) => ({ data: { publicUrl: `https://cdn.example/${path}` } }),
    list: async () => ({ data: [], error: null }),
    remove: async () => ({ error: null }),
  }

  return {
    from: vi.fn(from),
    storage: { from: vi.fn(() => bucket) },
    __upload: upload,
    __orgUpdate: orgUpdate,
  }
}

function makeFile(type: string, size: number): File {
  return new File([new Uint8Array(size)], 'logo', { type })
}

function logoFormData(file: File): FormData {
  const fd = new FormData()
  fd.set('logo', file)
  return fd
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

describe('updateLocationAction — org_admin guard + org scoping', () => {
  it('rejects a non-admin member and never updates', async () => {
    mockAuth({ id: 'u-1' })
    const storesUpdate = vi.fn()
    vi.mocked(getSupabaseServer).mockReturnValue(
      makeAdmin({
        membership: { data: { organization_id: 'org-1', role: 'buyer' }, error: null },
        storesUpdate,
      }) as never,
    )

    const result = await updateLocationAction(
      formData({ storeId: 's-1', storeName: 'Auckland Downtown' }),
    )

    expect(result.success).toBe(false)
    expect(storesUpdate).not.toHaveBeenCalled()
  })

  it('rejects a missing storeId and never updates', async () => {
    mockAuth({ id: 'u-1' })
    const storesUpdate = vi.fn()
    vi.mocked(getSupabaseServer).mockReturnValue(
      makeAdmin({
        membership: { data: { organization_id: 'org-1', role: 'org_admin' }, error: null },
        storesUpdate,
      }) as never,
    )

    const result = await updateLocationAction(formData({ storeName: 'Auckland Downtown' }))

    expect(result.success).toBe(false)
    expect(storesUpdate).not.toHaveBeenCalled()
  })

  it('scopes the update to both the store id and the caller org', async () => {
    mockAuth({ id: 'u-1' })
    const storesUpdate = vi.fn()
    vi.mocked(getSupabaseServer).mockReturnValue(
      makeAdmin({
        membership: { data: { organization_id: 'org-1', role: 'org_admin' }, error: null },
        storesUpdate,
      }) as never,
    )

    const result = await updateLocationAction(
      formData({ storeId: 's-1', storeName: 'Warehouse', city: 'Auckland', regionCode: 'AUK' }),
    )

    expect(result.success).toBe(true)
    expect(storesUpdate).toHaveBeenCalledTimes(1)
    const { payload, filters } = storesUpdate.mock.calls[0][0]
    // The two .eq() filters are the security boundary against cross-org edits.
    expect(filters).toEqual({ id: 's-1', organization_id: 'org-1' })
    expect(payload).toMatchObject({ name: 'Warehouse', city: 'Auckland', state: 'Auckland' })
  })
})

describe('updateOrgLogoAction — org_admin guard + validation', () => {
  it('rejects a non-admin member and never uploads', async () => {
    mockAuth({ id: 'u-1' })
    const admin = makeLogoAdmin({
      membership: { data: { organization_id: 'org-1', role: 'buyer' }, error: null },
    })
    vi.mocked(getSupabaseServer).mockReturnValue(admin as never)

    const result = await updateOrgLogoAction(logoFormData(makeFile('image/png', 10)))

    expect(result.success).toBe(false)
    expect(admin.__upload).not.toHaveBeenCalled()
    expect(admin.__orgUpdate).not.toHaveBeenCalled()
  })

  it('rejects an unsupported file type', async () => {
    mockAuth({ id: 'u-1' })
    const admin = makeLogoAdmin({
      membership: { data: { organization_id: 'org-1', role: 'org_admin' }, error: null },
    })
    vi.mocked(getSupabaseServer).mockReturnValue(admin as never)

    const result = await updateOrgLogoAction(logoFormData(makeFile('image/gif', 10)))

    expect(result.success).toBe(false)
    expect(admin.__upload).not.toHaveBeenCalled()
  })

  it('rejects a file larger than 2 MB', async () => {
    mockAuth({ id: 'u-1' })
    const admin = makeLogoAdmin({
      membership: { data: { organization_id: 'org-1', role: 'org_admin' }, error: null },
    })
    vi.mocked(getSupabaseServer).mockReturnValue(admin as never)

    const result = await updateOrgLogoAction(logoFormData(makeFile('image/png', 2 * 1024 * 1024 + 1)))

    expect(result.success).toBe(false)
    expect(admin.__upload).not.toHaveBeenCalled()
  })

  it('uploads a valid logo and writes logo_url', async () => {
    mockAuth({ id: 'u-1' })
    const admin = makeLogoAdmin({
      membership: { data: { organization_id: 'org-1', role: 'org_admin' }, error: null },
    })
    vi.mocked(getSupabaseServer).mockReturnValue(admin as never)

    const result = await updateOrgLogoAction(logoFormData(makeFile('image/png', 50)))

    expect(result.success).toBe(true)
    expect(admin.__upload).toHaveBeenCalledTimes(1)
    expect(admin.__orgUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ logo_url: expect.stringContaining('org-logos/org-1/') }),
    )
  })
})

describe('removeOrgLogoAction — org_admin guard', () => {
  it('rejects a non-admin member', async () => {
    mockAuth({ id: 'u-1' })
    const admin = makeLogoAdmin({
      membership: { data: { organization_id: 'org-1', role: 'buyer' }, error: null },
    })
    vi.mocked(getSupabaseServer).mockReturnValue(admin as never)

    const result = await removeOrgLogoAction()

    expect(result.success).toBe(false)
    expect(admin.__orgUpdate).not.toHaveBeenCalled()
  })

  it('clears logo_url for an org_admin', async () => {
    mockAuth({ id: 'u-1' })
    const admin = makeLogoAdmin({
      membership: { data: { organization_id: 'org-1', role: 'org_admin' }, error: null },
    })
    vi.mocked(getSupabaseServer).mockReturnValue(admin as never)

    const result = await removeOrgLogoAction()

    expect(result.success).toBe(true)
    expect(admin.__orgUpdate).toHaveBeenCalledWith({ logo_url: null })
  })
})
