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

  // variant_availability is a view from the staff-portal Inventory sub-app
  // spec. It may not exist yet — we tolerate the error and return an empty
  // result. Relationship names (product_color_swatches, sizes, products) are
  // best-effort guesses from the spec; the graceful-error branch will catch
  // mismatches at runtime until the schema lands.
  const { data, error } = await adminClient
    .from('variant_availability')
    .select(
      `
      variant_id,
      stock_qty,
      committed_qty,
      available_qty,
      product_variants!inner (
        product_id,
        updated_at,
        product_color_swatches ( name, hex ),
        sizes ( label ),
        products ( name )
      )
    `
    )
    .eq('organization_id', organizationId)

  if (error) {
    console.error('[Customer Inventory API] query failed:', error.message)
    return NextResponse.json({ rows: [] })
  }

  // Cast to any: PostgREST join shapes are hard to type cleanly without
  // generated types covering the variant_availability view.
  const rows: CustomerInventoryRow[] = (data ?? []).map((r: any) => ({
    variant_id: r.variant_id,
    product_id: r.product_variants?.product_id ?? '',
    product_name: r.product_variants?.products?.name ?? 'Product',
    colour_name: r.product_variants?.product_color_swatches?.name ?? null,
    colour_hex: r.product_variants?.product_color_swatches?.hex ?? null,
    size_label: r.product_variants?.sizes?.label ?? null,
    available_qty: r.available_qty ?? 0,
    stock_qty: r.stock_qty ?? 0,
    committed_qty: r.committed_qty ?? 0,
    updated_at: r.product_variants?.updated_at ?? null,
  }))

  return NextResponse.json({ rows })
}
