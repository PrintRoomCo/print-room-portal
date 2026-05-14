// Some master records embed the SKU at the end of the product name
// (e.g. "Box Minus Hood [-4cm] 5172" with sku "5172"). Rendering both the
// name and the SKU subheader duplicates the code. Strip the trailing token
// when it matches the SKU so the title reads cleanly and the SKU stands on
// its own.
export function stripTrailingSku(
  name: string | null | undefined,
  sku: string | null | undefined,
): string {
  if (!name) return ''
  if (!sku) return name
  const trimmedSku = sku.trim()
  if (!trimmedSku) return name
  // Allow optional separator chars (space, dash, slash, pipe) between name
  // and trailing SKU.
  const pattern = new RegExp(
    `[\\s\\-\\/|]+${escapeRegex(trimmedSku)}\\s*$`,
    'i',
  )
  return name.replace(pattern, '').trim() || name
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
