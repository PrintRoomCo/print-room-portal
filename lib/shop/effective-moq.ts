export function getEffectiveMoq(
  product: { moq: number | null },
  catalogueItem: { moq_override: number | null } | null,
): number {
  return catalogueItem?.moq_override ?? product.moq ?? 1
}
