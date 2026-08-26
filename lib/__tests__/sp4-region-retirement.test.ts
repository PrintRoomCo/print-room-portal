import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// SP4 static guard: the legacy organisation-region seam must never re-enter
// runtime source. Address `region` fields, Xero contact `Region`, ARIA
// role="region", and `region_quota` are unrelated and deliberately not matched.
const RUNTIME_ROOTS = ['app', 'components', 'contexts', 'lib', 'types']
const SKIP_DIRS = new Set(['node_modules', '__tests__'])

function runtimeFiles(dir: string): string[] {
  const collected: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      collected.push(...runtimeFiles(join(dir, entry.name)))
      continue
    }
    if (!/\.(ts|tsx)$/.test(entry.name)) continue
    if (/\.test\.(ts|tsx)$/.test(entry.name)) continue
    collected.push(join(dir, entry.name))
  }
  return collected
}

const forbidden = [
  /organizations[^\n]*\.select\([^\n]*region/i,
  /\.from\(['"]organizations['"]\)[\s\S]{0,180}\.select\(['"][^'"]*\bregion\b/i,
  /\b(orgRegion|OrgRegion|ORG_REGIONS|isOrgRegion|changeOrgRegion)\b/,
  /\b(xeroRegionForBillCountry|tenantIdForRegion|connectionForRegion|xeroTenantIdForRegion|isXeroConnectedForRegion)\b/,
  /access\?*\.region\b/,
  /\b(gstRateForRegion|currencyForRegion|normalizeOrgRegion)\b/,
]

describe('SP4 customer region retirement guard', () => {
  it('keeps legacy organisation-region identifiers and queries out of runtime source', () => {
    const offenders: string[] = []
    for (const root of RUNTIME_ROOTS) {
      for (const file of runtimeFiles(root)) {
        const source = readFileSync(file, 'utf8')
        for (const pattern of forbidden) {
          if (pattern.test(source)) offenders.push(`${file} :: ${pattern}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('has no legacy GST helper module to import', () => {
    expect(runtimeFiles('lib').some((file) => file.endsWith('lib/pricing/gst.ts'))).toBe(
      false,
    )
  })
})
