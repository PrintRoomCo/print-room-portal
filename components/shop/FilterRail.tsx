import Link from 'next/link'
import type { ShopFilters } from '@/lib/shop/filter-params'
import type { ShopFacets } from '@/lib/shop/facets'
import { activeFilterCount } from '@/lib/shop/filter-params'
import { FilterAutoSubmitSelect } from './FilterAutoSubmitSelect'
import { FilterAutoSubmitCheckbox } from './FilterAutoSubmitCheckbox'
import { PILL_LABELS } from '@/lib/shop/fulfilment-mode'
import { garmentTypeLabel } from '@/lib/shop/garment-type'

interface Props {
  filters: ShopFilters
  facets: ShopFacets
  /** Route to post back to. `/catalogue` for catalogue listing, `/shop` for inventory. */
  basePath: '/catalogue' | '/shop'
  /**
   * Whether to show the "Ordering mode" filter. Hidden for stock_only members
   * (memberCanReorder === false) — the same condition that hides the PDP
   * order-mode pill: they can only ever draw from stock, so a "Purchase order"
   * filter option would be inert. Defaults to shown.
   */
  showModeFilter?: boolean
}

export function FilterRail({ filters, facets, basePath, showModeFilter = true }: Props) {
  const hasActive = activeFilterCount(filters) > 0

  const clearHref = basePath

  return (
    <aside>
      <form method="GET" action={basePath} className="space-y-4">
        <Section label="Search">
          <input
            type="search"
            name="q"
            defaultValue={filters.q}
            placeholder="Search products"
            className="w-full rounded-full bg-white px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300"
          />
        </Section>

        <Section label="Brand">
          <FilterAutoSubmitSelect
            name="brand_id"
            defaultValue={filters.brandId ?? ''}
            ariaLabel="Filter by brand"
            options={[
              { value: '', label: 'All brands' },
              ...facets.brands.map((b) => ({ value: b.id, label: b.name })),
            ]}
          />
        </Section>

        <Section label="Category">
          <FilterAutoSubmitSelect
            name="category_id"
            defaultValue={filters.categoryId ?? ''}
            ariaLabel="Filter by category"
            options={[
              { value: '', label: 'All categories' },
              ...facets.categories.map((c) => ({ value: c.id, label: c.name })),
            ]}
          />
        </Section>

        {/* Garment type — the display counterpart of the DB `garment_family`
            column. The form field + URL param intentionally stay `garment_family`
            (see lib/shop/garment-type.ts); only the option labels are nice-cased.
            Shown only when the catalogue in scope actually has garment families —
            unlike brand/category, garment_family is often unset, and a zero-option
            filter would be inert. */}
        {facets.garmentFamilies.length > 0 && (
          <Section label="Garment type">
            <FilterAutoSubmitSelect
              name="garment_family"
              defaultValue={filters.garmentFamily ?? ''}
              ariaLabel="Filter by garment type"
              options={[
                { value: '', label: 'All types' },
                ...facets.garmentFamilies.map((v) => ({
                  value: v,
                  label: garmentTypeLabel(v),
                })),
              ]}
            />
          </Section>
        )}

        {showModeFilter && (
          <Section label="Ordering mode">
            <FilterAutoSubmitSelect
              name="mode"
              defaultValue={filters.mode === 'all' ? '' : filters.mode}
              ariaLabel="Filter by ordering mode"
              options={[
                { value: '', label: 'All' },
                { value: 'from_inventory', label: PILL_LABELS.from_inventory },
                { value: 'reorder', label: PILL_LABELS.reorder },
              ]}
            />
          </Section>
        )}

        <Section label="Sort">
          <FilterAutoSubmitSelect
            name="sort"
            defaultValue={filters.sort}
            ariaLabel="Sort"
            options={[
              { value: 'name', label: 'Name (A → Z)' },
              { value: 'newest', label: 'Newest' },
            ]}
          />
        </Section>

        <Section label="Stock">
          <FilterAutoSubmitCheckbox
            name="in_stock"
            defaultChecked={filters.inStock}
            label="In stock only"
          />
        </Section>

        <noscript>
          <button
            type="submit"
            className="rounded-full bg-pr-blue px-4 py-2 text-sm text-white"
          >
            Apply filters
          </button>
        </noscript>
      </form>

      {hasActive && (
        <Link
          href={clearHref}
          className="mt-4 inline-block text-[11px] font-medium tracking-[0.12em] text-gray-500 hover:text-gray-900"
        >
          Clear all
        </Link>
      )}
    </aside>
  )
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <p className="text-[11px] font-medium tracking-[0.12em] text-gray-500">{label}</p>
      {children}
    </div>
  )
}
