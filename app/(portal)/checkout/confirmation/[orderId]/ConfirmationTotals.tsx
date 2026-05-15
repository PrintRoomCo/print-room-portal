'use client'

import { useCurrency } from '@/contexts/CurrencyContext'

interface Props {
  subtotalExGst: number
  decorationCost: number
  gst: number
  totalIncGst: number
  gstRate: number
}

export function ConfirmationTotals({
  subtotalExGst,
  decorationCost,
  gst,
  totalIncGst,
  gstRate,
}: Props) {
  const { format } = useCurrency()
  return (
    <dl className="mt-3 space-y-1.5 text-sm">
      <div className="flex justify-between">
        <dt className="text-gray-600">Subtotal (ex-GST)</dt>
        <dd className="text-gray-900">{format(subtotalExGst)}</dd>
      </div>
      {decorationCost > 0 && (
        <div className="flex justify-between text-gray-500">
          <dt className="pl-3">Includes decoration</dt>
          <dd>{format(decorationCost)}</dd>
        </div>
      )}
      <div className="flex justify-between">
        <dt className="text-gray-600">GST ({Math.round(gstRate * 100)}%)</dt>
        <dd className="text-gray-900">{format(gst)}</dd>
      </div>
      <div className="mt-2 flex justify-between border-t border-gray-100 pt-2 text-base font-semibold">
        <dt>Total payable</dt>
        <dd>{format(totalIncGst)}</dd>
      </div>
    </dl>
  )
}
