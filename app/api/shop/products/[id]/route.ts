import { NextResponse } from 'next/server'
import { requireB2BCustomerApi } from '@/lib/checkout/server'
import {
  getOpenPeriodForOrg,
  getPreOrderItemIds,
  getPeriodBracketsForItem,
} from '@/lib/pricing/period-brackets'
import { sanitizeDescription } from '@/lib/shop/sanitize-description'
import { isCheckoutCountryPartitionEnabled } from '@/lib/checkout/country-partition-config'
import { getOrgDefaultBillingCountry } from '@/lib/account/org-countries'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireB2BCustomerApi()
  if ('error' in auth) return auth.error
  const { admin, context } = auth
  const { id } = await params
  const countryPartitionEnabled = isCheckoutCountryPartitionEnabled()
  const defaultCountry = countryPartitionEnabled
    ? await getOrgDefaultBillingCountry(admin, context.organizationId)
    : null

  const legacyBracketsQuery = defaultCountry
    ? Promise.resolve({ data: [] })
    : admin
        .from('product_pricing_tiers')
        .select('min_quantity, max_quantity, unit_price')
        .eq('product_id', id)
        .eq('is_active', true)
        .order('min_quantity', { ascending: true })

  const [{ data: catalogueItem }, { data: product, error: pErr }, { data: variants }, { data: sizeRows }, { data: brackets }] = await Promise.all([
    admin.from('b2b_catalogue_items')
      .select('id, name, description, b2b_catalogues!inner(is_active)')
      .eq('source_product_id', id)
      .eq('is_active', true)
      .eq('b2b_catalogues.organization_id', context.organizationId)
      .eq('b2b_catalogues.is_active', true)
      .limit(1)
      .maybeSingle(),
    admin.from('products')
      .select(
        'id, name, description, brand_id, category_id, moq, lead_time_days, sizing_type, ' +
        'decoration_methods, decoration_price, image_url, specs, is_active, ' +
        '_channel:product_type_activations!inner(product_type,is_active)'
      )
      .eq('id', id)
      .eq('_channel.product_type', 'b2b')
      .eq('_channel.is_active', true)
      .single(),
    admin.from('product_variants')
      .select(`
        id, color_swatch_id,
        product_color_swatches (label, hex, position)
      `)
      .eq('product_id', id)
      .eq('is_active', true),
    admin.from('sizes')
      .select('id, label, order_index')
      .eq('product_id', id)
      .order('order_index', { ascending: true }),
    legacyBracketsQuery,
  ])

  interface ProductDetail {
    id: string
    name: string
    description: string | null
    brand_id: string
    category_id: string
    moq: number | null
    lead_time_days: number | null
    sizing_type: string | null
    decoration_methods: string[] | null
    decoration_price: number | null
    image_url: string | null
    specs: unknown
    is_active: boolean
  }
  const productRow = product as unknown as ProductDetail | null
  if (!catalogueItem || pErr || !productRow || !productRow.is_active) {
    return NextResponse.json({ error: 'Product not found' }, { status: 404 })
  }

  const catItem = catalogueItem as {
    id: string
    name: string
    description: string | null
  }

  const { data: catalogueColorRows } = await admin
    .from('b2b_catalogue_item_colors')
    .select('color_swatch_id, sort_order, is_default')
    .eq('catalogue_item_id', catItem.id)

  const catalogueColors = (catalogueColorRows ?? []) as Array<{
    color_swatch_id: string
    sort_order: number | null
    is_default: boolean | null
  }>
  const configuredColorIds = new Set(catalogueColors.map((row) => row.color_swatch_id))
  const colorConfigById = new Map(catalogueColors.map((row) => [row.color_swatch_id, row]))

  interface VariantRow {
    id: string
    color_swatch_id: string | null
    // supabase-js types many-to-one embeds as arrays regardless of cardinality —
    // in practice PostgREST returns a single object here. Handle both defensively.
    product_color_swatches:
      | { label: string | null; hex: string | null; position: number | null }
      | { label: string | null; hex: string | null; position: number | null }[]
      | null
  }
  interface SizeRow {
    id: number
    label: string | null
    order_index: number | null
  }
  const variantRows = (variants ?? []) as unknown as VariantRow[]
  const pickOne = <T,>(v: T | T[] | null): T | null =>
    Array.isArray(v) ? (v[0] ?? null) : v

  const mappedVariants = variantRows.map((v) => {
    const swatch = pickOne(v.product_color_swatches)
    const colorConfig = v.color_swatch_id ? colorConfigById.get(v.color_swatch_id) : null
    return {
      variant_id: v.id,
      color_swatch_id: v.color_swatch_id,
      color_label: swatch?.label ?? null,
      color_hex: swatch?.hex ?? null,
      color_position: swatch?.position ?? 0,
      catalogue_color_sort_order: colorConfig?.sort_order ?? null,
      catalogue_color_is_default: colorConfig?.is_default === true,
    }
  })
    .filter((v) => {
      if (configuredColorIds.size === 0) return true
      return v.color_swatch_id != null && configuredColorIds.has(v.color_swatch_id)
    })
    .sort((a, b) => {
      if (a.catalogue_color_is_default !== b.catalogue_color_is_default) {
        return a.catalogue_color_is_default ? -1 : 1
      }
      const aColor = a.catalogue_color_sort_order ?? a.color_position
      const bColor = b.catalogue_color_sort_order ?? b.color_position
      return aColor - bColor
    })

  // Per-product size list for the runtime size picker (colourway model).
  const mappedSizes = ((sizeRows ?? []) as SizeRow[]).map((s) => ({
    size_id: s.id,
    size_label: s.label,
    size_order: s.order_index ?? 0,
  }))

  // Pre-order: swap brackets to period snapshot when open (spec §3.5).
  const openPeriod = await getOpenPeriodForOrg(admin, context.organizationId)
  const preOrderIds = await getPreOrderItemIds(admin, [catItem.id])
  const isPreOrderItem = preOrderIds.has(catItem.id)
  let finalBrackets = (brackets ?? []) as Array<{
    min_quantity: number
    max_quantity: number | null
    unit_price: number
  }>
  if (defaultCountry) {
    const { data: exactBrackets } = await admin
      .from('b2b_catalogue_item_pricing_tiers')
      .select('min_quantity, max_quantity, unit_price')
      .eq('catalogue_item_id', catItem.id)
      .eq('currency', defaultCountry.currency)
      .order('min_quantity', { ascending: true })
    finalBrackets = (exactBrackets ?? []) as typeof finalBrackets
  }
  if (isPreOrderItem && openPeriod) {
    const periodBrackets = await getPeriodBracketsForItem(
      admin,
      openPeriod.id,
      catItem.id,
      defaultCountry?.currency ?? 'NZD',
      countryPartitionEnabled,
    )
    if (periodBrackets.length > 0) {
      finalBrackets = periodBrackets.map((b) => ({
        min_quantity: b.minQty,
        max_quantity: b.maxQty,
        unit_price: b.unitPrice,
      }))
    }
  }

  return NextResponse.json({
    product: {
      ...productRow,
      name: catItem.name ?? productRow.name,
      description: sanitizeDescription(catItem.description ?? productRow.description),
      image_url: productRow.image_url,
    },
    variants: mappedVariants,
    sizes: mappedSizes,
    brackets: finalBrackets,
    ...(defaultCountry ? { currency: defaultCountry.currency } : {}),
  })
}
