/**
 * The min_order_exempt read must survive the column being absent — the staff-repo
 * migration lands separately, and a failing select on the shared `organizations`
 * row would blank the whole checkout context (org_not_found for every customer).
 * So it is its own tolerant query, exactly like b2b_member_store_grants.
 */
import { describe, expect, it } from 'vitest'
import { readMinOrderExempt } from '../server'

function stubAdmin(result: { data: unknown; error: unknown }) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => result,
        }),
      }),
    }),
  } as unknown as Parameters<typeof readMinOrderExempt>[0]
}

describe('readMinOrderExempt', () => {
  it('returns true when the flag is set', async () => {
    const admin = stubAdmin({ data: { min_order_exempt: true }, error: null })
    await expect(readMinOrderExempt(admin, 'org-1')).resolves.toBe(true)
  })

  it('returns false when the flag is unset', async () => {
    const admin = stubAdmin({ data: { min_order_exempt: false }, error: null })
    await expect(readMinOrderExempt(admin, 'org-1')).resolves.toBe(false)
  })

  it('returns false when the column does not exist yet', async () => {
    const admin = stubAdmin({
      data: null,
      error: { message: 'column organizations.min_order_exempt does not exist' },
    })
    await expect(readMinOrderExempt(admin, 'org-1')).resolves.toBe(false)
  })

  it('returns false when the query throws outright', async () => {
    const admin = {
      from: () => {
        throw new Error('network down')
      },
    } as unknown as Parameters<typeof readMinOrderExempt>[0]
    await expect(readMinOrderExempt(admin, 'org-1')).resolves.toBe(false)
  })
})
