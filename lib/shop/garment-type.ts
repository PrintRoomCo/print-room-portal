/**
 * The canonical "garment type" vocabulary for the customer portal — the display
 * counterpart to the staff portal's `src/lib/products/garment-types.ts`. The two
 * repos don't share code, so this is a deliberate copy kept in lockstep.
 *
 * These are garment SHAPES. "Corporate" and "Trades" were dropped because they
 * are use-cases, not shapes; "bags" was added. The staff portal owns the schema:
 * this list mirrors the DB CHECK constraint on `products.garment_family`
 * (enforced there) — this repo is a read-only consumer with no migrations, so it
 * never writes these values, only labels them.
 *
 * Note: the DB column and the URL query key are intentionally still named
 * `garment_family` (a rename would ripple into the shared Supabase project and
 * break bookmarked `/catalogue?garment_family=…` links). Only the code/display
 * vocabulary is "garment type" — see `lib/shop/filter-params.ts`, which keeps the
 * `garment_family` param, and the `.eq('garment_family', …)` catalogue query.
 */
export const GARMENT_TYPES = [
  'accessories',
  'bags',
  'belt',
  'crew',
  'headwear',
  'healthcare',
  'hoodie',
  'jacket',
  'pants',
  'polo',
  'scrubs',
  'shirt',
  'shorts',
  'tee',
  'vest',
] as const

export type GarmentType = (typeof GARMENT_TYPES)[number]

const TYPE_SET: ReadonlySet<string> = new Set(GARMENT_TYPES)

export function isGarmentType(value: unknown): value is GarmentType {
  return typeof value === 'string' && TYPE_SET.has(value)
}

/** Display label for a garment type, e.g. "headwear" → "Headwear". */
export function garmentTypeLabel(type: string): string {
  return type.charAt(0).toUpperCase() + type.slice(1)
}
