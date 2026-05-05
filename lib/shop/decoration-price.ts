type MaybeNumber = number | string | null | undefined

interface ResolveDecorationPriceArgs {
  override: MaybeNumber
  master: MaybeNumber
}

function toNumberOrNull(value: MaybeNumber): number | null {
  if (value === null || value === undefined) return null
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

/**
 * Catalogue decoration resolution:
 * COALESCE(b2b_catalogue_items.decoration_price_override, products.decoration_price, 0).
 * A zero override is meaningful and must not fall through to the master value.
 */
export function resolveDecorationPrice(args: ResolveDecorationPriceArgs): number {
  const override = toNumberOrNull(args.override)
  if (override !== null) return override
  return toNumberOrNull(args.master) ?? 0
}
