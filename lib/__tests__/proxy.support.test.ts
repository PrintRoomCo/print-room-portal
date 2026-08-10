import { describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/supabase-middleware', () => ({
  createSupabaseMiddlewareClient: () => ({
    auth: {
      getUser: async () => ({ data: { user: null } }),
    },
  }),
}))

describe('customer proxy /support protection', () => {
  it('redirects an unauthenticated visitor to sign-in with the support return path', async () => {
    const { proxy } = await import('@/proxy')
    const response = await proxy(new NextRequest('https://portal.example.test/support'))

    expect(response.headers.get('location')).toBe(
      'https://portal.example.test/sign-in?returnTo=%2Fsupport',
    )
  })
})
