'use client'

import type { CustomerInventoryRow } from '@/lib/inventory/customer-rows'

export function InventoryClient({ rows }: { rows: CustomerInventoryRow[] }) {
  // Data is server-rendered by the page — no on-mount fetch, no loading state.
  return (
    <div className="min-h-screen bg-[#FAFAFA]">
      <div className="mx-auto max-w-[1320px] px-4 pb-16 pt-[100px] md:px-6 md:pt-[120px]">
        <header className="mb-10 md:mb-12">
          <h1 className="font-dm-sans text-[clamp(40px,5vw,72px)] font-medium leading-[1.05] tracking-[-0.02em] text-gray-900">
            Inventory
          </h1>
          <p className="mt-4 max-w-2xl text-base text-gray-500">
            The stock we&rsquo;re holding for you. &ldquo;Available&rdquo; is how many
            you can order right now.
          </p>
        </header>

        {/* Stock table */}
        <section>
          <h2 className="mb-4 text-sm font-medium text-gray-700">Stock on hand</h2>
          <div className="overflow-x-auto rounded-2xl bg-white">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-gray-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Product</th>
                  <th className="px-4 py-3 font-medium">Colour</th>
                  <th className="px-4 py-3 font-medium">Size</th>
                  <th className="px-4 py-3 text-right font-medium">Available</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-gray-500">
                      No tracked stock yet.
                    </td>
                  </tr>
                ) : (
                  rows.map((r) => (
                    <tr
                      key={`${r.variant_id}::${r.size_id ?? ''}`}
                      className="border-t border-gray-100"
                    >
                      <td className="px-4 py-3">
                        <div className="text-gray-900">
                          {r.design_name ?? r.product_name}
                        </div>
                        {r.design_name ? (
                          <div className="text-xs text-gray-400">{r.product_name}</div>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 text-gray-700">{r.colour_name ?? '—'}</td>
                      <td className="px-4 py-3 text-gray-700">{r.size_label ?? '—'}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{r.available_qty}</td>
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
