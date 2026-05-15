import type { SupabaseClient } from '@supabase/supabase-js'

export interface ShopFacets {
  brands: Array<{ id: string; name: string }>
  categories: Array<{ id: string; name: string }>
  garmentFamilies: string[]
}

export async function getShopFacets(
  admin: SupabaseClient,
  scopedProductIds: string[],
): Promise<ShopFacets> {
  if (scopedProductIds.length === 0) {
    return { brands: [], categories: [], garmentFamilies: [] }
  }

  // Step 1: collect the distinct facet keys actually present on products in
  // scope. Single scan over `products` — no embedded FK joins (the chained
  // `tablename!fk_name!inner(...)` PostgREST syntax was returning empty data
  // for newly-ported orgs even though the FKs resolved at the SQL layer).
  const { data: rows } = await admin
    .from('products')
    .select('brand_id, category_id, garment_family')
    .in('id', scopedProductIds)

  const brandIdSet = new Set<string>()
  const categoryIdSet = new Set<string>()
  const familySet = new Set<string>()
  for (const r of (rows ?? []) as Array<{
    brand_id: string | null
    category_id: string | null
    garment_family: string | null
  }>) {
    if (r.brand_id) brandIdSet.add(r.brand_id)
    if (r.category_id) categoryIdSet.add(r.category_id)
    if (r.garment_family && r.garment_family.trim() !== '') {
      familySet.add(r.garment_family)
    }
  }

  // Step 2: hydrate labels from brands + categories. Separate queries keep the
  // result shape flat and avoid PostgREST FK-disambiguation quirks.
  const brandIds = Array.from(brandIdSet)
  const categoryIds = Array.from(categoryIdSet)
  const [brandsRes, categoriesRes] = await Promise.all([
    brandIds.length > 0
      ? admin.from('brands').select('id, name').in('id', brandIds)
      : Promise.resolve({ data: [] as Array<{ id: string; name: string }> }),
    categoryIds.length > 0
      ? admin.from('categories').select('id, name').in('id', categoryIds)
      : Promise.resolve({ data: [] as Array<{ id: string; name: string }> }),
  ])

  return {
    brands: ((brandsRes.data ?? []) as Array<{ id: string; name: string }>)
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name)),
    categories: ((categoriesRes.data ?? []) as Array<{ id: string; name: string }>)
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name)),
    garmentFamilies: Array.from(familySet).sort((a, b) => a.localeCompare(b)),
  }
}
