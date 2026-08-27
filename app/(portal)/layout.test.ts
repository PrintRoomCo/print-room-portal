import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('PortalLayout navigation boundary', () => {
  it('always resolves complete country data below a layout-owned Suspense boundary', () => {
    const source = readFileSync(resolve(process.cwd(), 'app/(portal)/layout.tsx'), 'utf8')
    const layoutStart = source.indexOf('export default async function PortalLayout')
    const layoutReturn = source.indexOf('\n  return (', layoutStart)
    const blockingSetup = source.slice(layoutStart, layoutReturn)

    expect(blockingSetup).not.toContain('await getOrgDefaultBillingCountry')
    expect(source).toContain('<Suspense')
    expect(source).toContain('await getOrgDefaultBillingCountry')
    expect(source).toContain("await getPlatformBillingCountry(getSupabaseServer(), 'NZ')")
    expect(source).not.toContain('countryPartitionEnabled && initialAccess?.companyId')
    expect(source).toContain('defaultBillingCountry={defaultBillingCountry}')
  })

  it('threads the org base currency without pinning display selection', () => {
    const source = readFileSync(resolve(process.cwd(), 'app/(portal)/layout.tsx'), 'utf8')

    expect(source).toContain('resolveInitialCurrency(defaultBillingCountry.currency)')
    expect(source).toContain('baseCurrency={defaultBillingCountry.currency}')
    expect(source).not.toContain('billingCurrency={')
  })
})
