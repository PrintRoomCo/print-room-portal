import Link from 'next/link'
import type { ShopFilters } from '@/lib/shop/filter-params'
import type { ShopFacets } from '@/lib/shop/facets'
import { activeFilterCount } from '@/lib/shop/filter-params'
import { FilterAutoSubmitSelect } from './FilterAutoSubmitSelect'
import { FilterAutoSubmitCheckbox } from './FilterAutoSubmitCheckbox'

interface Props {
  filters: ShopFilters
  facets: ShopFacets
}

// Horizontal desktop variant of FilterRail. Mounted in the catalogue page
// top bar so the grid renders full-width. Mobile still uses the vertical
// FilterRail inside FilterSheetTrigger.
const SELECT_CLASS =
  'rounded-full bg-gray-50 border border-gray-200 px-3 py-2 text-sm w-auto min-w-[10rem]'

export function CatalogueFilterBar({ filters, facets }: Props) {
  const hasActive = activeFilterCount(filters) > 0

  return (
    <aside className="rounded-2xl border border-gray-100 bg-white px-4 py-3 shadow-sm">
      <form
        method="GET"
        action="/catalogue"
        className="flex flex-wrap items-center gap-2"
      >
        <input
          type="search"
          name="q"
          defaultValue={filters.q}
          placeholder="Search products"
          aria-label="Search products"
          className="min-w-[12rem] flex-1 rounded-full bg-gray-50 border border-gray-200 px-4 py-2 text-sm"
        />

        <FilterAutoSubmitSelect
          name="brand_id"
          defaultValue={filters.brandId ?? ''}
          ariaLabel="Filter by brand"
          className={SELECT_CLASS}
          options={[
            { value: '', label: 'All brands' },
            ...facets.brands.map((b) => ({ value: b.id, label: b.name })),
          ]}
        />

        <FilterAutoSubmitSelect
          name="category_id"
          defaultValue={filters.categoryId ?? ''}
          ariaLabel="Filter by category"
          className={SELECT_CLASS}
          options={[
            { value: '', label: 'All categories' },
            ...facets.categories.map((c) => ({ value: c.id, label: c.name })),
          ]}
        />

        <FilterAutoSubmitSelect
          name="garment_family"
          defaultValue={filters.garmentFamily ?? ''}
          ariaLabel="Filter by garment family"
          className={SELECT_CLASS}
          options={[
            { value: '', label: 'All families' },
            ...facets.garmentFamilies.map((g) => ({ value: g, label: g })),
          ]}
        />

        <FilterAutoSubmitSelect
          name="sort"
          defaultValue={filters.sort}
          ariaLabel="Sort"
          className={SELECT_CLASS}
          options={[
            { value: 'name', label: 'Name (A → Z)' },
            { value: 'newest', label: 'Newest' },
          ]}
        />

        <FilterAutoSubmitCheckbox
          name="in_stock"
          defaultChecked={filters.inStock}
          label="In stock only"
        />

        {hasActive && (
          <Link
            href="/catalogue"
            className="ml-auto text-xs font-medium text-gray-600 underline"
          >
            Clear all
          </Link>
        )}

        <noscript>
          <button
            type="submit"
            className="rounded-full bg-pr-blue px-4 py-2 text-sm text-white"
          >
            Apply filters
          </button>
        </noscript>
      </form>
    </aside>
  )
}
