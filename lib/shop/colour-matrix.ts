// Catalogue colour resolution for the customer PDP.
//
// Curated rows (b2b_catalogue_item_colors) used to *filter* which colours a
// customer could see. They no longer do: every master colour with a buyable
// variant is shown. Curated rows now only influence ORDER (sort_order) and the
// DEFAULT colour — they never hide a colour. Decoration scope is a separate,
// staff-side concern.

export interface MatrixVariant {
  variant_id: string
  color_swatch_id: string | null
  color_label: string | null
  color_hex: string | null
  /** The colour's own product photo (master swatch image), if any. */
  color_image_url: string | null
  color_position: number
  /** From the curated row for this colour, if any — ordering only. */
  catalogue_color_sort_order: number | null
  /** From the curated row for this colour, if any — default selection only. */
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
  // Curation is only a subset, so it can't order the full list and must NOT
  // float curated colours to the front.
  if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1
  if (a.position !== b.position) return a.position - b.position
  return (a.label ?? '').localeCompare(b.label ?? '')
}

/**
 * Build the customer-facing colour options and the (unfiltered) variant matrix.
 * Colour options are the DISTINCT colours present on the buyable variants,
 * ordered default-first then by curated sort order, falling back to the
 * master swatch position for non-curated colours. No colour is hidden.
 */
export function resolveColourMatrix(variants: MatrixVariant[]): {
  colourOptions: ColourOption[]
  variants: MatrixVariant[]
} {
  const bySwatch = new Map<string, ColourOption>()
  for (const v of variants) {
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

  const sortedVariants = [...variants].sort((a, b) => {
    if (a.catalogue_color_is_default !== b.catalogue_color_is_default) {
      return a.catalogue_color_is_default ? -1 : 1
    }
    if (a.color_position !== b.color_position) return a.color_position - b.color_position
    return a.size_order - b.size_order
  })

  return { colourOptions, variants: sortedVariants }
}
