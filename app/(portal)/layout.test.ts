import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('PortalLayout navigation boundary', () => {
  it('keeps the uncached country lookup below a layout-owned Suspense boundary', () => {
    const source = readFileSync(resolve(process.cwd(), 'app/(portal)/layout.tsx'), 'utf8')
    const layoutStart = source.indexOf('export default async function PortalLayout')
    const layoutReturn = source.indexOf('\n  return (', layoutStart)
    const blockingSetup = source.slice(layoutStart, layoutReturn)

    expect(blockingSetup).not.toContain('await getOrgDefaultBillingCountry')
    expect(source).toContain('<Suspense')
    expect(source).toContain('await getOrgDefaultBillingCountry')
  })
})
