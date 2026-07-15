import { describe, it, expect } from 'vitest'
// @ts-expect-error — next.config.mjs is an untyped ESM config module; we only read redirects()
import nextConfig from '../../next.config.mjs'

type Redirect = { source: string; destination: string; permanent: boolean }

async function getRedirects(): Promise<Redirect[]> {
  // @ts-expect-error — redirects() is defined on the Next config object
  return (await nextConfig.redirects()) as Redirect[]
}

describe('next.config redirects', () => {
  it('does NOT redirect /inventory — it is a distinct org-admin Inventory page again (2026-06-02)', async () => {
    const redirects = await getRedirects()
    // A leftover `/inventory -> /catalogue` permanent redirect from the
    // 2026-05-14 catalogue merge would shadow the reinstated Inventory page on
    // every environment (a 308, browser-cached). It must not be present.
    expect(redirects.find((r) => r.source === '/inventory')).toBeUndefined()
  })

  it('still folds /shop into /catalogue (that surface stays merged)', async () => {
    const redirects = await getRedirects()
    expect(redirects.find((r) => r.source === '/shop')?.destination).toBe('/catalogue')
  })
})
