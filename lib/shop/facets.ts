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

  const [brandsRes, categoriesRes, familyRes] = await Promise.all([
    admin
      .from('products')
      .select('brand_id, brands!products_brand_id_fkey!inner(id, name)')
      .in('id', scopedProductIds),
    admin
      .from('products')
      .select('category_id, categories!products_category_id_fkey!inner(id, name)')
      .in('id', scopedProductIds),
    admin
      .from('products')
      .select('garment_family')
      .in('id', scopedProductIds),
  ])

  const brandMap = new Map<string, { id: string; name: string }>()
  for (const r of (brandsRes.data ?? []) as Array<{
    brand_id: string
    brands: { id: string; name: string } | { id: string; name: string }[] | null
  }>) {
    const b = Array.isArray(r.brands) ? r.brands[0] : r.brands
    if (b) brandMap.set(b.id, { id: b.id, name: b.name })
  }

  const categoryMap = new Map<string, { id: string; name: string }>()
  for (const r of (categoriesRes.data ?? []) as Array<{
    category_id: string
    categories: { id: string; name: string } | { id: string; name: string }[] | null
  }>) {
    const c = Array.isArray(r.categories) ? r.categories[0] : r.categories
    if (c) categoryMap.set(c.id, { id: c.id, name: c.name })
  }

  const familySet = new Set<string>()
  for (const r of (familyRes.data ?? []) as Array<{ garment_family: string | null }>) {
    if (r.garment_family && r.garment_family.trim() !== '') {
      familySet.add(r.garment_family)
    }
  }

  return {
    brands: Array.from(brandMap.values()).sort((a, b) => a.name.localeCompare(b.name)),
    categories: Array.from(categoryMap.values()).sort((a, b) => a.name.localeCompare(b.name)),
    garmentFamilies: Array.from(familySet).sort((a, b) => a.localeCompare(b)),
  }
}
