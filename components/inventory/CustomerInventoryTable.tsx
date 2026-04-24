'use client'

import Link from 'next/link'
import type { CustomerInventoryRow } from '@/app/api/inventory/route'

export interface CustomerInventoryTableProps {
  rows: CustomerInventoryRow[]
}

function formatDate(value: string | null): string {
  if (!value) return '—'
  try {
    return new Date(value).toLocaleDateString('en-NZ', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  } catch {
    return '—'
  }
}

export function CustomerInventoryTable({ rows }: CustomerInventoryTableProps) {
  if (rows.length === 0) {
    return (
      <div className="card-elevated p-8 text-center">
        <p className="text-gray-500">
          No tracked inventory yet. Your account manager will let you know when
          stock is on hand.
        </p>
      </div>
    )
  }

  return (
    <div className="card-elevated overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 text-gray-600">
          <tr>
            <th className="text-left px-4 py-3 font-medium">Product</th>
            <th className="text-left px-4 py-3 font-medium">Colour</th>
            <th className="text-left px-4 py-3 font-medium">Size</th>
            <th className="text-right px-4 py-3 font-medium">Available</th>
            <th className="text-right px-4 py-3 font-medium">On hand</th>
            <th className="text-right px-4 py-3 font-medium">Updated</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.variant_id}
              className="border-t border-gray-100 hover:bg-gray-50 transition-colors"
            >
              <td className="px-4 py-3">
                <Link
                  href={`/shop/${row.product_id}`}
                  className="text-[rgb(var(--color-primary))] hover:underline"
                >
                  {row.product_name}
                </Link>
              </td>
              <td className="px-4 py-3">
                <span className="inline-flex items-center gap-1.5">
                  {row.colour_hex && (
                    <span
                      className="w-3 h-3 rounded-full border border-gray-200"
                      style={{ backgroundColor: row.colour_hex }}
                      aria-hidden="true"
                    />
                  )}
                  {row.colour_name ?? '—'}
                </span>
              </td>
              <td className="px-4 py-3">{row.size_label ?? '—'}</td>
              <td className="px-4 py-3 text-right font-semibold">
                {row.available_qty}
              </td>
              <td className="px-4 py-3 text-right text-gray-600">
                {row.stock_qty}
              </td>
              <td className="px-4 py-3 text-right text-gray-500 text-xs">
                {formatDate(row.updated_at)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
