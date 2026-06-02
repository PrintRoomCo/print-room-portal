'use client'

import { useEffect, useMemo, useState } from 'react'
import type { CustomerInventoryRow } from '@/app/api/inventory/route'
import type { AuditEntry } from '@/lib/inventory/audit'

export function InventoryClient() {
  const [rows, setRows] = useState<CustomerInventoryRow[]>([])
  const [entries, setEntries] = useState<AuditEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [variantFilter, setVariantFilter] = useState<string | null>(null)

  useEffect(() => {
    let stale = false
    Promise.all([
      fetch('/api/inventory').then((r) => (r.ok ? r.json() : { rows: [] })),
      fetch('/api/inventory/audit').then((r) => (r.ok ? r.json() : { entries: [] })),
    ])
      .then(([stock, audit]) => {
        if (stale) return
        setRows(stock.rows ?? [])
        setEntries(audit.entries ?? [])
        setLoading(false)
      })
      .catch(() => {
        if (stale) return
        setRows([])
        setEntries([])
        setLoading(false)
      })
    return () => {
      stale = true
    }
  }, [])

  const visibleEntries = useMemo(
    () => (variantFilter ? entries.filter((e) => e.variantId === variantFilter) : entries),
    [entries, variantFilter],
  )

  return (
    <div className="min-h-screen bg-[#FAFAFA]">
      <div className="mx-auto max-w-[1320px] px-4 pb-16 pt-[100px] md:px-6 md:pt-[120px]">
        <header className="mb-10 md:mb-12">
          <h1 className="font-dm-sans text-[clamp(40px,5vw,72px)] font-medium leading-[1.05] tracking-[-0.02em] text-gray-900">
            Inventory
          </h1>
        </header>

        {/* Stock table */}
        <section className="mb-12">
          <h2 className="mb-4 text-sm font-medium text-gray-700">Stock on hand</h2>
          <div className="overflow-x-auto rounded-2xl bg-white">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-gray-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Product</th>
                  <th className="px-4 py-3 font-medium">Colour</th>
                  <th className="px-4 py-3 font-medium">Size</th>
                  <th className="px-4 py-3 text-right font-medium">Available</th>
                  <th className="px-4 py-3 text-right font-medium">In stock</th>
                  <th className="px-4 py-3 text-right font-medium">Committed</th>
                  <th className="px-4 py-3 font-medium">Audit</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-gray-400">
                      Loading…
                    </td>
                  </tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-gray-500">
                      No tracked stock yet.
                    </td>
                  </tr>
                ) : (
                  rows.map((r) => (
                    <tr key={r.variant_id} className="border-t border-gray-100">
                      <td className="px-4 py-3 text-gray-900">{r.product_name}</td>
                      <td className="px-4 py-3 text-gray-700">{r.colour_name ?? '—'}</td>
                      <td className="px-4 py-3 text-gray-700">{r.size_label ?? '—'}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{r.available_qty}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{r.stock_qty}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{r.committed_qty}</td>
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          onClick={() => setVariantFilter(r.variant_id)}
                          className="rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-900 hover:bg-gray-200"
                        >
                          View
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* Audit feed */}
        <section>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-medium text-gray-700">
              Stock movements{variantFilter ? ' · filtered to one variant' : ''}
            </h2>
            {variantFilter && (
              <button
                type="button"
                onClick={() => setVariantFilter(null)}
                className="rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-900 hover:bg-gray-200"
              >
                Clear filter
              </button>
            )}
          </div>
          <div className="overflow-x-auto rounded-2xl bg-white">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-gray-500">
                <tr>
                  <th className="px-4 py-3 font-medium">When</th>
                  <th className="px-4 py-3 font-medium">Movement</th>
                  <th className="px-4 py-3 text-right font-medium">Δ Stock</th>
                  <th className="px-4 py-3 font-medium">Who</th>
                  <th className="px-4 py-3 font-medium">Where</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-gray-400">
                      Loading…
                    </td>
                  </tr>
                ) : visibleEntries.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-gray-500">
                      No movements recorded.
                    </td>
                  </tr>
                ) : (
                  visibleEntries.map((e) => (
                    <tr key={e.id} className="border-t border-gray-100">
                      <td className="px-4 py-3 text-gray-700 tabular-nums">
                        {new Date(e.createdAt).toLocaleDateString('en-NZ', {
                          day: 'numeric',
                          month: 'short',
                          year: 'numeric',
                        })}
                      </td>
                      <td className="px-4 py-3 text-gray-700">
                        {e.reason}
                        {e.note ? <span className="text-gray-400"> · {e.note}</span> : null}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">{e.deltaStock}</td>
                      <td className="px-4 py-3 text-gray-900">{e.who}</td>
                      <td className="px-4 py-3 text-gray-700">{e.where ?? '—'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  )
}
