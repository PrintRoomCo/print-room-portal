'use client'

import { useCurrency } from '@/contexts/CurrencyContext'
import { formatCurrency } from '@/lib/currency/format'

interface Props {
  /** NZD amount stored in DB. */
  nzd: number
  /** Authored canonical currency. When present, visitor FX conversion is bypassed. */
  currency?: string
  /** Class on the wrapping span. */
  className?: string
}

export function Money({ nzd, currency, className }: Props) {
  const { format, loading } = useCurrency()
  if (currency) {
    return <span className={className}>{formatCurrency(nzd, currency)}</span>
  }
  if (loading) {
    return <span className={className}>{formatCurrency(nzd, 'NZD')}</span>
  }
  return <span className={className}>{format(nzd)}</span>
}
