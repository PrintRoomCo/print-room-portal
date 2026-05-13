import Link from 'next/link'
import type { ShopFilters } from '@/lib/shop/filter-params'
import type { ShopFacets } from '@/lib/shop/facets'
import { activeFilterCount } from '@/lib/shop/filter-params'
import { FilterAutoSubmitSelect } from './FilterAutoSubmitSelect'
import { FilterAutoSubmitCheckbox } from './FilterAutoSubmitCheckbox'

interface Props {
  filters: ShopFilters
  facets: ShopFacets
  /** Route to post back to. `/catalogue` for catalogue listing, `/shop` for inventory. */
  basePath: '/catalogue' | '/shop'
}

export function FilterRail({ filters, facets, basePath }: Props) {
  const hasActive = activeFilterCount(filters) > 0

  const clearHref = basePath

  return (
    <aside className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
      <form method="GET" action={basePath} className="space-y-4">
        <Section label="Search">
          <input
            type="search"
            name="q"
            defaultValue={filters.q}
            placeholder="Search products"
            className="rounded-full bg-gray-50 border border-gray-200 px-4 py-2 text-sm w-full"
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

        <Section label="Garment family">
          <FilterAutoSubmitSelect
            name="garment_family"
            defaultValue={filters.garmentFamily ?? ''}
            ariaLabel="Filter by garment family"
            options={[
              { value: '', label: 'All families' },
              ...facets.garmentFamilies.map((g) => ({ value: g, label: g })),
            ]}
          />
        </Section>

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
          className="mt-3 inline-block text-xs font-medium text-gray-600 underline"
        >
          Clear all
        </Link>
      )}
    </aside>
  )
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium uppercase tracking-wide text-gray-400">{label}</p>
      {children}
    </div>
  )
}
