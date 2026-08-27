'use client'

import { useCurrency } from '@/contexts/CurrencyContext'

interface Props {
  /** Amount denominated in `sourceCurrency`, or in the org's base currency when omitted. */
  amount: number
  /**
   * Denomination of `amount` (e.g. a country price list's currency). Converted
   * into the viewer's display currency; billing surfaces that must render the
   * authored figure verbatim do not use Money.
   */
  sourceCurrency?: string
  /** Class on the wrapping span. */
  className?: string
}

export function Money({ amount, sourceCurrency, className }: Props) {
  const { format, formatFrom } = useCurrency()
  return (
    <span className={className}>
      {sourceCurrency ? formatFrom(amount, sourceCurrency) : format(amount)}
    </span>
  )
}
