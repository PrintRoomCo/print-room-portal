export function getEffectiveMoq(
  product: { moq: number | null },
  catalogueItem: { moq_override: number | null } | null,
  opts?: { orgMoqExempt?: boolean },
): number {
  if (opts?.orgMoqExempt) return 1
  return catalogueItem?.moq_override ?? product.moq ?? 1
}
