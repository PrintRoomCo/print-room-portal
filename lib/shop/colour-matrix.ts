// Catalogue colour resolution for the customer PDP.
//
// Only the colours explicitly added to the catalogue item
// (b2b_catalogue_item_colors) are shown. Rows in that table drive BOTH
// visibility and ORDER (sort_order) + the DEFAULT colour. Decoration scope
// is a separate, staff-side concern.

export interface MatrixVariant {
  variant_id: string
  color_swatch_id: string | null
  color_label: string | null
  color_hex: string | null
  /** The colour's own product photo (master swatch image), if any. */
  color_image_url: string | null
  color_position: number
  /** From the added row for this colour, if any — ordering only. */
  catalogue_color_sort_order: number | null
  /** From the added row for this colour, if any — default selection only. */
  catalogue_color_is_default: boolean
  size_id: number | null
  size_label: string | null
  size_order: number
}

export interface ColourOption {
  id: string
  label: string | null
  hex: string | null
  imageUrl: string | null
  position: number
  catalogueSortOrder: number | null
  isDefault: boolean
}

function compareColours(
  a: { isDefault: boolean; position: number; label: string | null },
  b: { isDefault: boolean; position: number; label: string | null },
): number {
  // The default colour leads; everything else follows master (supplier) position.
  if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1
  if (a.position !== b.position) return a.position - b.position
  return (a.label ?? '').localeCompare(b.label ?? '')
}

/**
 * Customer-facing colour options and the scoped variant matrix.
 *
 * Only the colours present in `addedSwatchIds` (rows from
 * `b2b_catalogue_item_colors`) are shown. A product with no colours added
 * returns empty arrays — that is the correct behaviour; a blank / un-built
 * product should show nothing. Colour options are ordered default-first,
 * then by master swatch position.
 */
export function resolveColourMatrix(
  variants: MatrixVariant[],
  addedSwatchIds: Set<string>,
): {
  colourOptions: ColourOption[]
  variants: MatrixVariant[]
} {
  // Restrict to variants whose colour was explicitly added to the catalogue item.
  const scoped = variants.filter(
    (v) => v.color_swatch_id != null && addedSwatchIds.has(v.color_swatch_id),
  )

  const bySwatch = new Map<string, ColourOption>()
  for (const v of scoped) {
    if (!v.color_swatch_id || bySwatch.has(v.color_swatch_id)) continue
    bySwatch.set(v.color_swatch_id, {
      id: v.color_swatch_id,
      label: v.color_label,
      hex: v.color_hex,
      imageUrl: v.color_image_url,
      position: v.color_position,
      catalogueSortOrder: v.catalogue_color_sort_order,
      isDefault: v.catalogue_color_is_default,
    })
  }

  const colourOptions = [...bySwatch.values()].sort(compareColours)

  const sortedVariants = [...scoped].sort((a, b) => {
    if (a.catalogue_color_is_default !== b.catalogue_color_is_default) {
      return a.catalogue_color_is_default ? -1 : 1
    }
    if (a.color_position !== b.color_position) return a.color_position - b.color_position
    return a.size_order - b.size_order
  })

  return { colourOptions, variants: sortedVariants }
}
