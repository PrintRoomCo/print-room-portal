/**
 * AU Stage 1 region→money mapping (spec 2026-08-14 §5). The org's region is the
 * single source of truth for billing currency and GST rate. Anything that is not
 * exactly 'AU' — including null/unknown — is NZ, so every existing org and every
 * caller that has no region in scope keeps today's behavior bit-for-bit.
 */
export function normalizeOrgRegion(value: unknown): 'NZ' | 'AU' {
  return value === 'AU' ? 'AU' : 'NZ'
}

export function gstRateForRegion(region: string | null | undefined): number {
  return normalizeOrgRegion(region) === 'AU' ? 0.1 : 0.15
}

export function currencyForRegion(region: string | null | undefined): 'NZD' | 'AUD' {
  return normalizeOrgRegion(region) === 'AU' ? 'AUD' : 'NZD'
}
