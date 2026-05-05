'use client'

import { useCurrency } from '@/contexts/CurrencyContext'
import { formatCurrency } from '@/lib/currency/format'

interface Props {
  /** NZD amount stored in DB. */
  nzd: number
  /** Class on the wrapping span. */
  className?: string
}

export function Money({ nzd, className }: Props) {
  const { format, loading } = useCurrency()
  if (loading) {
    return <span className={className}>{formatCurrency(nzd, 'NZD')}</span>
  }
  return <span className={className}>{format(nzd)}</span>
}
