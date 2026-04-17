'use client'

import type { PricingResult, GarmentLine } from './QuoteBuilder'

interface Props {
  pricing: PricingResult
  garmentLines: GarmentLine[]
}

export function SummaryPanel({ pricing, garmentLines }: Props) {
  const formatPrice = (n: number) => `$${n.toFixed(2)}`

  return (
    <div className="card-elevated p-6 mt-6 border-2 border-[rgb(var(--color-brand-blue))]">
      <h3 className="text-lg font-bold text-[rgb(var(--color-brand-blue))] mb-4">Quote Summary</h3>

      {pricing.lines.map((line) => {
        if (!line.priceable) return null
        const gl = garmentLines[line.garmentLineIndex]
        return (
          <div key={line.garmentLineIndex} className="flex justify-between py-2 border-b border-gray-100 text-sm">
            <span>{gl?.productName || `Line ${line.garmentLineIndex + 1}`} x{gl?.quantity || 0}</span>
            <span className="font-medium">{formatPrice(line.lineSubtotalInclGst)}</span>
          </div>
        )
      })}

      <div className="flex justify-between pt-3 mt-2 border-t-2 border-[rgb(var(--color-brand-blue))]">
        <span className="text-lg font-bold">Total (incl. GST)</span>
        <span className="text-lg font-bold">{formatPrice(pricing.totalInclGst)}</span>
      </div>

      <div className="text-right text-xs text-muted-foreground mt-1">
        Total units: {pricing.totalUnits}
      </div>
    </div>
  )
}
