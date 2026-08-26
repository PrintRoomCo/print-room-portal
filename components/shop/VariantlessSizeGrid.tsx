'use client'

import { useMemo } from 'react'

interface Props {
  sizes: string[]
  quantities: Record<string, number>
  onChange: (next: Record<string, number>) => void
}

export function VariantlessSizeGrid({ sizes, quantities, onChange }: Props) {
  const total = useMemo(
    () => Object.values(quantities).reduce((s, n) => s + n, 0),
    [quantities],
  )

  function setSize(size: string, raw: string) {
    const n = Number(raw)
    const next = { ...quantities }
    if (!Number.isFinite(n) || n <= 0) {
      delete next[size]
    } else {
      next[size] = Math.floor(n)
    }
    onChange(next)
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white">
      <table className="w-full text-sm">
        <thead className="bg-white text-left text-xs text-gray-500">
          <tr>
            <th className="px-3 py-2 font-medium">Size</th>
            <th className="px-3 py-2 text-right font-medium">Qty</th>
          </tr>
        </thead>
        <tbody>
          {sizes.map(size => {
            const value = quantities[size] ?? 0
            return (
              <tr key={size} className="border-t border-gray-100">
                <td className="px-3 py-2 font-medium text-gray-800">{size}</td>
                <td className="px-3 py-2 text-right">
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={value || ''}
                    placeholder="0"
                    onChange={e => setSize(size, e.target.value)}
                    aria-label={`Quantity for size ${size}`}
                    className="w-20 rounded-lg border border-gray-200 px-2 py-1 text-right text-sm focus:border-pr-blue focus:outline-none focus:ring-2 focus:ring-pr-blue/30"
                  />
                </td>
              </tr>
            )
          })}
        </tbody>
        <tfoot>
          <tr className="border-t border-gray-200 bg-white">
            <td className="px-3 py-2 text-xs font-medium text-gray-500">
              Order total
            </td>
            <td className="px-3 py-2 text-right text-sm font-semibold text-gray-800">
              {total}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}
