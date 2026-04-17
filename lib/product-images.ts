import { getSupabaseServer } from '@/lib/supabase'

/**
 * Bulk-resolve the primary "front" garment image per product id.
 * Returns a map of productId → file_url. Missing products are simply absent from the map.
 */
export async function resolveProductFrontImages(
  productIds: string[]
): Promise<Record<string, string>> {
  const uniqueIds = Array.from(new Set(productIds.filter(Boolean)))
  if (uniqueIds.length === 0) return {}

  const supabase = getSupabaseServer()

  const { data, error } = await supabase
    .from('product_images')
    .select('product_id, file_url, view, position, image_type')
    .in('product_id', uniqueIds)
    .eq('image_type', 'product')
    .order('position', { ascending: true })

  if (error) {
    console.error('[product-images] Failed to fetch product images:', error)
    return {}
  }

  const map: Record<string, string> = {}
  for (const row of data || []) {
    if (!row.product_id || !row.file_url) continue
    // Prefer the front view; otherwise accept the lowest-position fallback.
    const existing = map[row.product_id]
    if (!existing || row.view === 'front') {
      map[row.product_id] = row.file_url
    }
  }
  return map
}
