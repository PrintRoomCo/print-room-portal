export const IMAGE_LAYOUTS = [
  'standard_views',
  'merchandised_gallery',
] as const

export type ImageLayout = (typeof IMAGE_LAYOUTS)[number]

export function isImageLayout(value: unknown): value is ImageLayout {
  return (
    typeof value === 'string'
    && (IMAGE_LAYOUTS as readonly string[]).includes(value)
  )
}

export function parseImageLayout(value: unknown): ImageLayout {
  return isImageLayout(value) ? value : 'standard_views'
}

export function effectiveImageLayout(
  productLayout: unknown,
  itemOverride: unknown,
): ImageLayout {
  return isImageLayout(itemOverride)
    ? itemOverride
    : parseImageLayout(productLayout)
}
