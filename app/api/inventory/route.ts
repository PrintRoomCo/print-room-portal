import { NextResponse } from 'next/server'
import { getSupabaseServerComponent } from '@/lib/supabase-server-component'
import { getSupabaseServer } from '@/lib/supabase'

export interface CustomerInventoryRow {
  variant_id: string
  product_id: string
  product_name: string
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

export async function GET() {
  const supabase = await getSupabaseServerComponent()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ rows: [] }, { status: 401 })
  }

  const adminClient = getSupabaseServer()

  // Resolve organization_id directly — lighter than getCompanyAccess() which
  // pulls profile/org/b2b_account/stores. Mirrors the lookup in
  // app/api/order-tracker/route.ts for consistency.
  const { data: membership } = await adminClient
    .from('user_organizations')
    .select('organization_id')
    .eq('user_id', user.id)
    .single()

  const organizationId = membership?.organization_id
  if (!organizationId) {
    return NextResponse.json({ rows: [] })
  }

  // 1. Stock numbers for the org. `variant_availability` is a thin view over
  //    variant_inventory (variant_id, organization_id, stock/committed/available).
  //    We do NOT embed product_variants off the view: a view has no FKs, so
  //    PostgREST relationship inference 400s (the old single-query embed failed
  //    here, silently returning an empty table). Descriptors are fetched from the
  //    base table below and joined in JS — same pattern as the reorder/audit routes.
  const { data: stockRows, error: stockError } = await adminClient
    .from('variant_availability')
    .select('variant_id, stock_qty, committed_qty, available_qty')
    .eq('organization_id', organizationId)

  if (stockError) {
    console.error('[Customer Inventory API] stock query failed:', stockError.message)
    return NextResponse.json({ rows: [] })
  }

  const stock = (stockRows ?? []) as Array<{
    variant_id: string
    stock_qty: number
    committed_qty: number
    available_qty: number
  }>

  const variantIds = Array.from(
    new Set(stock.map((s) => s.variant_id).filter((id): id is string => !!id))
  )
  if (variantIds.length === 0) {
    return NextResponse.json({ rows: [] })
  }

  // 2. Variant descriptors from the base table — real FKs, so the embeds resolve.
  //    Correct columns: product_color_swatches.label/.hex, sizes.label, products.name.
  const { data: variantRows, error: variantError } = await adminClient
    .from('product_variants')
    .select(
      `
      id,
      product_id,
      updated_at,
      product_color_swatches ( label, hex ),
      sizes ( label ),
      products ( name )
    `
    )
    .in('id', variantIds)

  if (variantError) {
    console.error('[Customer Inventory API] variant descriptor query failed:', variantError.message)
    return NextResponse.json({ rows: [] })
  }

  // Cast to any: PostgREST join shapes are hard to type without generated types.
  const descriptorById = new Map<string, any>()
  for (const v of (variantRows ?? []) as any[]) {
    descriptorById.set(v.id, v)
  }

  const rows: CustomerInventoryRow[] = stock.map((s) => {
    const v = descriptorById.get(s.variant_id)
    const swatch = pickOne(v?.product_color_swatches) as { label?: string; hex?: string } | null
    const size = pickOne(v?.sizes) as { label?: string } | null
    const product = pickOne(v?.products) as { name?: string } | null
    return {
      variant_id: s.variant_id,
      product_id: v?.product_id ?? '',
      product_name: product?.name ?? 'Product',
      colour_name: swatch?.label ?? null,
      colour_hex: swatch?.hex ?? null,
      size_label: size?.label ?? null,
      available_qty: s.available_qty ?? (s.stock_qty ?? 0) - (s.committed_qty ?? 0),
      stock_qty: s.stock_qty ?? 0,
      committed_qty: s.committed_qty ?? 0,
      updated_at: v?.updated_at ?? null,
    }
  })

  return NextResponse.json({ rows })
}
