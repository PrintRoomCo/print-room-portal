'use client'

import { useCompany } from '@/contexts/CompanyContext'
import type { PricingContext } from './types'

/**
 * Reads tier metadata from the CompanyContext (populated by getCompanyAccess
 * via /api/company-access). Returns the tier label and pricing mode for the
 * active org. Pricing mode is always 'catalogue' after the global fallback
 * removal (2026-05-05).
 */
export function usePricingContext(): PricingContext {
  const { access } = useCompany()
  return {
    pricingMode: 'catalogue',
    tierLabel: access?.tierLabel ?? null,
    tierDiscount: access?.tierDiscount ?? 0,
  }
}
