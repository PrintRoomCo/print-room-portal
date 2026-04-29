'use client'

import { useCompany } from '@/contexts/CompanyContext'
import type { PricingContext } from './types'

/**
 * Reads tier metadata from the CompanyContext (populated by getCompanyAccess
 * via /api/company-access). Returns the tier label, fractional discount, and
 * pricing mode for the active org. Defaults to 'standard' when no access.
 */
export function usePricingContext(): PricingContext {
  const { access } = useCompany()
  if (!access) {
    return { pricingMode: 'standard', tierLabel: null, tierDiscount: 0 }
  }
  return {
    pricingMode: access.pricingMode ?? 'standard',
    tierLabel: access.tierLabel ?? null,
    tierDiscount: access.tierDiscount ?? 0,
  }
}
