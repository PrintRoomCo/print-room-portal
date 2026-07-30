import type { SupabaseClient } from '@supabase/supabase-js'

export interface CustomerInventoryRow {
  variant_id: string
  // SKUCOLLAPSE: rows are per-(colourway variant, size) — size_id disambiguates
  // the sibling stock rows now that product_variants is colourway-grain.
  size_id: number | null
  product_id: string
  product_name: string
  /** The org's design/catalogue-item name for this blank when exactly one active
   *  design maps to it (b2b_catalogue_items.name — the same field as the PDP
   *  title). NULL when the blank has 0 or >1 active designs, since stock is
   *  blank-grain and therefore pooled; the UI falls back to product_name. */
  design_name: string | null
  colour_name: string | null
  colour_hex: string | null
  size_label: string | null
  available_qty: number
  stock_qty: number
  committed_qty: number
  updated_at: string | null
}

/** PostgREST to-one embeds arrive as an object or a single-element array. */
function pickOne<T>(v: T | T[] | null | undefined): T | null {
  if (v == null) return null
  return Array.isArray(v) ? v[0] ?? null : v
}

/**
 * Resolve the single design name to show for a stocked blank. Stock is
 * blank+colourway grain (no design dimension), so a design name is only
 * unambiguous when the org has exactly one active design skinning that blank.
 * 0 or >1 distinct names → null (the UI falls back to the blank/garment name).
 */
export function pickDesignName(names: Array<string | null | undefined>): string | null {
  const uniq = Array.from(
    new Set(names.filter((n): n is string => !!n && n.trim() !== '').map((n) => n.trim())),
  )
  return uniq.length === 1 ? uniq[0] : null
}

/**
 * Customer-facing stock-on-hand rows for an organization. Shared by the
 * server-rendered Inventory page (initial paint) and /api/inventory (client
 * refresh) so the two can never drift. Returns [] on any query error.
 *
 * Requires a service-role client — the caller is responsible for having
 * authorized the org (the page/route both gate on org membership + admin).
 */
export async function getCustomerInventoryRows(
  adminClient: SupabaseClient,
  organizationId: string,
): Promise<CustomerInventoryRow[]> {
  // 1. Stock numbers for the org. `variant_availability` is a thin view over
  //    variant_inventory (variant_id, organization_id, stock/committed/available).
  //    We do NOT embed product_variants off the view: a view has no FKs, so
  //    PostgREST relationship inference 400s. Descriptors are fetched from the
  //    base table below and joined in JS — same pattern as the reorder route.
  const { data: stockRows, error: stockError } = await adminClient
    .from('variant_availability')
    .select('variant_id, size_id, stock_qty, committed_qty, available_qty')
    .eq('organization_id', organizationId)

  if (stockError) {
    console.error('[Customer Inventory] stock query failed:', stockError.message)
    return []
  }

  const stock = (stockRows ?? []) as Array<{
    variant_id: string
    size_id: number | null
    stock_qty: number
    committed_qty: number
    available_qty: number
  }>

  const variantIds = Array.from(
    new Set(stock.map((s) => s.variant_id).filter((id): id is string => !!id)),
  )
  if (variantIds.length === 0) return []

  // 2. Variant descriptors from the base table — colourway-grain, so no size
  //    embed. Size labels are resolved separately (the size axis lives on
  //    variant_inventory / variant_availability, not product_variants).
  const { data: variantRows, error: variantError } = await adminClient
    .from('product_variants')
    .select(
      `
      id,
      product_id,
      updated_at,
      product_color_swatches ( label, hex ),
      products ( name )
    `,
    )
    .in('id', variantIds)

  if (variantError) {
    console.error('[Customer Inventory] variant descriptor query failed:', variantError.message)
    return []
  }

  // Cast to any: PostgREST join shapes are hard to type without generated types.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const descriptorById = new Map<string, any>()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const v of (variantRows ?? []) as any[]) {
    descriptorById.set(v.id, v)
  }

  // 2b. Resolve the org's active design (catalogue-item) name per source product.
  //     variant_inventory has no design dimension, but in practice each stocked
  //     blank maps to exactly one active design for the org, so we surface the
  //     design name (b2b_catalogue_items.name — same field the PDP title uses) to
  //     disambiguate two designs on one blank. Same org-scoped join the PDP
  //     resolver uses; org_admin-only page, so no member-grant filtering needed.
  const productIds = Array.from(
    new Set(
      (variantRows ?? [])
        .map((v: { product_id?: string | null }) => v.product_id)
        .filter((id): id is string => !!id),
    ),
  )
  const designNameByProductId = new Map<string, string | null>()
  if (productIds.length > 0) {
    const { data: catItemRows } = await adminClient
      .from('b2b_catalogue_items')
      .select('source_product_id, name, b2b_catalogues!inner(organization_id, is_active)')
      .eq('is_active', true)
      .eq('b2b_catalogues.organization_id', organizationId)
      .eq('b2b_catalogues.is_active', true)
      .in('source_product_id', productIds)

    const namesByProduct = new Map<string, string[]>()
    for (const ci of (catItemRows ?? []) as Array<{
      source_product_id: string | null
      name: string | null
    }>) {
      if (!ci.source_product_id) continue
      const list = namesByProduct.get(ci.source_product_id) ?? []
      list.push(ci.name ?? '')
      namesByProduct.set(ci.source_product_id, list)
    }
    for (const [pid, names] of namesByProduct) {
      designNameByProductId.set(pid, pickDesignName(names))
    }
  }

  // 3. Resolve size labels for the stamped sizes.
  const sizeIds = Array.from(
    new Set(stock.map((s) => s.size_id).filter((id): id is number => id != null)),
  )
  const sizeLabelById = new Map<number, string | null>()
  if (sizeIds.length > 0) {
    const { data: sizeRows } = await adminClient.from('sizes').select('id, label').in('id', sizeIds)
    for (const s of (sizeRows ?? []) as Array<{ id: number; label: string | null }>) {
      sizeLabelById.set(s.id, s.label)
    }
  }

  return stock.map((s) => {
    const v = descriptorById.get(s.variant_id)
    const swatch = pickOne(v?.product_color_swatches) as { label?: string; hex?: string } | null
    const product = pickOne(v?.products) as { name?: string } | null
    return {
      variant_id: s.variant_id,
      size_id: s.size_id ?? null,
      product_id: v?.product_id ?? '',
      product_name: product?.name ?? 'Product',
      design_name: designNameByProductId.get(v?.product_id ?? '') ?? null,
      colour_name: swatch?.label ?? null,
      colour_hex: swatch?.hex ?? null,
      size_label: s.size_id == null ? null : sizeLabelById.get(s.size_id) ?? null,
      available_qty: s.available_qty ?? (s.stock_qty ?? 0) - (s.committed_qty ?? 0),
      stock_qty: s.stock_qty ?? 0,
      committed_qty: s.committed_qty ?? 0,
      updated_at: v?.updated_at ?? null,
    }
  })
}
