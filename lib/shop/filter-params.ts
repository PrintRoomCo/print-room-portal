import type { OrderingMode } from './fulfilment-mode'

export type ShopSort = 'name' | 'newest'

export interface ShopFilters {
  q: string
  brandId: string | null
  categoryId: string | null
  garmentFamily: string | null
  sort: ShopSort
  inStock: boolean
  mode: OrderingMode
  page: number
}

export const DEFAULT_SHOP_FILTERS: ShopFilters = {
  q: '',
  brandId: null,
  categoryId: null,
  garmentFamily: null,
  sort: 'name',
  inStock: false,
  mode: 'all',
  page: 1,
}

const SORT_VALUES: ShopSort[] = ['name', 'newest']

const MODE_VALUES: OrderingMode[] = ['all', 'from_inventory', 'reorder']

function pickFirst(v: string | string[] | undefined): string | undefined {
  if (Array.isArray(v)) return v[0]
  return v
}

export function parseShopFilters(
  sp: { [key: string]: string | string[] | undefined },
): ShopFilters {
  const sortRaw = pickFirst(sp.sort) as ShopSort | undefined
  const sort = sortRaw && SORT_VALUES.includes(sortRaw) ? sortRaw : 'name'

  const pageRaw = Number(pickFirst(sp.page) ?? '1')
  const page = Number.isFinite(pageRaw) && pageRaw >= 1 ? Math.floor(pageRaw) : 1

  return {
    q: (pickFirst(sp.q) ?? '').trim(),
    brandId: pickFirst(sp.brand_id) || null,
    categoryId: pickFirst(sp.category_id) || null,
    garmentFamily: pickFirst(sp.garment_family) || null,
    sort,
    inStock: pickFirst(sp.in_stock) === '1',
    mode: (() => {
      const raw = pickFirst(sp.mode) as OrderingMode | undefined
      return raw && MODE_VALUES.includes(raw) ? raw : 'all'
    })(),
    page,
  }
}

export function activeFilterCount(filters: ShopFilters): number {
  let n = 0
  if (filters.q !== '') n++
  if (filters.brandId !== null) n++
  if (filters.categoryId !== null) n++
  if (filters.garmentFamily !== null) n++
  if (filters.sort !== 'name') n++
  if (filters.inStock) n++
  if (filters.mode !== 'all') n++
  return n
}
