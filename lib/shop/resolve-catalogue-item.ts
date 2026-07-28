import type { SupabaseClient } from '@supabase/supabase-js'
import { getGrantedCatalogueItemIds } from './member-access'
import type { ImageLayout } from './image-layout'

/** The catalogue-item shape the PDP loader needs to render a skin. */
export type PdpCatalogueItem = {
  id: string
  name: string | null
  description: string | null
  sku_override: string | null
  moq_override: number | null
  /** Feature #9 — soft per-order cap override (nullable). NULL = inherit master. */
  max_order_qty_override: number | null
  fulfilment_type_override: 'stocked' | 'made_to_order' | 'mixed' | null
  price_mode: 'computed' | 'manual_final' | null
  /** Staff-set min_quantity of each band HIDDEN from the customer Volume-pricing
   *  widget (display only). Empty = show the full ladder. */
  volume_display_hidden_bands: number[]
  /** Feature 1 — assigned org location dataset (nullable). NULL = no PDP location
   *  dropdown for this product. Drives the required dropdown when set. */
  line_dataset_id: string | null
  /** Feature 2 — per-product custom-name cap (nullable). NULL = no PDP custom-name
   *  input for this product. A positive int enables it and caps the input length. */
  custom_name_max_length: number | null
  /** Nullable item-level override; NULL inherits products.image_layout. */
  image_layout_override: ImageLayout | null
}

const CAT_ITEM_SELECT =
  'id, name, description, sku_override, moq_override, max_order_qty_override, fulfilment_type_override, price_mode, volume_display_hidden_bands, line_dataset_id, custom_name_max_length, image_layout_override, b2b_catalogues!inner(organization_id, is_active)'

export interface ResolveCatalogueItemParams {
  productId: string
  organizationId: string
  membershipId: string
  /** True when the request is a staff read-only preview. */
  isPreview: boolean
  /** Editor-launched preview: the in-edit catalogue item id pinned in the cookie. */
  previewItemId: string | null
}

export interface ResolveCatalogueItemDeps {
  /** Injectable for tests; defaults to the real member-access resolver. */
  getGrantedItemIds?: typeof getGrantedCatalogueItemIds
}

/**
 * Resolve which catalogue-item skin to render on a product's PDP for the current
 * (previewed or real) member.
 *
 * Preview is honoured ONLY when the pinned preview item actually belongs to the
 * product being viewed. The preview cookie pins a single itemId for 30 minutes;
 * while it is live, staff navigating to a DIFFERENT product used to hard-404
 * because the preview lookup (`id = previewItemId AND source_product_id = productId`)
 * returned nothing. We now fall back to the member's normal granted access for
 * that product instead of 404ing — exact-item preview (incl. draft/inactive
 * force-show) is unchanged; only the cross-product miss now degrades gracefully.
 */
export async function resolveCatalogueItemForPdp(
  admin: SupabaseClient,
  params: ResolveCatalogueItemParams,
  deps: ResolveCatalogueItemDeps = {},
): Promise<PdpCatalogueItem | null> {
  const { productId, organizationId, membershipId, isPreview, previewItemId } = params
  const getGranted = deps.getGrantedItemIds ?? getGrantedCatalogueItemIds

  if (isPreview && previewItemId) {
    const { data } = await admin
      .from('b2b_catalogue_items')
      .select(CAT_ITEM_SELECT)
      .eq('id', previewItemId)
      .eq('source_product_id', productId)
      .eq('b2b_catalogues.organization_id', organizationId)
      .maybeSingle()
    if (data) return data as unknown as PdpCatalogueItem
    // Stale / cross-product preview item — fall through to normal access.
  }

  const grantedItemIds = await getGranted(admin, membershipId, organizationId)
  if (grantedItemIds.length === 0) return null

  const { data } = await admin
    .from('b2b_catalogue_items')
    .select(CAT_ITEM_SELECT)
    .eq('source_product_id', productId)
    .eq('is_active', true)
    .eq('b2b_catalogues.organization_id', organizationId)
    .eq('b2b_catalogues.is_active', true)
    .in('id', grantedItemIds)
    .limit(1)
    .maybeSingle()

  return (data as unknown as PdpCatalogueItem) ?? null
}
