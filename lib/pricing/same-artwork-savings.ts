import { pickBracket, type CartLine, type CartLineBracket } from '@/lib/cart/types'

/**
 * "Same artwork savings" — the customer-facing half of pooled decoration pricing
 * (spec 2026-08-13 §8).
 *
 * The rule the copy must express is the OUTCOME, never the formula: this artwork
 * appears on N garments in your order, so this line is priced at the N+ rate. No
 * itemised per-placement math is exposed anywhere.
 *
 * Everything here reads what `recomputeProductTierPrices` already computed
 * (`decorations[].pooledQty`) rather than re-deriving pools in a component.
 */

export interface SameArtworkSavings {
  /** Garments in the order carrying the artwork that set this line's band. */
  pooledQty: number
  /** The band the line landed in, e.g. 600 for "the 600+ rate". */
  bandMinQty: number | null
  /** The artwork doing the work, for a11y text. */
  decorationName: string
}

export interface NextArtworkBand {
  /** More garments carrying this artwork needed to reach the next price break. */
  unitsToNext: number
  decorationName: string
}

/** The decoration whose pool set this line's band — the largest one. */
function governingDecoration(line: CartLine) {
  let best: CartLine['decorations'][number] | null = null
  for (const d of line.decorations) {
    if (d.pooledQty == null) continue
    if (!best || d.pooledQty > (best.pooledQty ?? 0)) best = d
  }
  return best
}

/**
 * The pill, or null when there is nothing to say — no pooling, or a pool that is
 * only this line, which has earned the customer nothing to shout about.
 */
export function sameArtworkSavings(line: CartLine): SameArtworkSavings | null {
  const governing = governingDecoration(line)
  const pooledQty = governing?.pooledQty
  if (!governing || pooledQty == null) return null
  if (pooledQty <= line.qty) return null

  return {
    pooledQty,
    bandMinQty: pickBracket(line.brackets, pooledQty)?.minQty ?? null,
    decorationName: governing.name,
  }
}

/**
 * Distance to the next price break, across BOTH ladders the pooled quantity
 * moves: the garment's own ladder and the governing artwork's ladder. The
 * customer does not care which one drops — only how many more garments it takes.
 *
 * Same-price band boundaries are skipped: they are not a saving. Mirrors
 * `calculatePeriodSavingsOpportunity`.
 */
export function nextArtworkBand(line: CartLine): NextArtworkBand | null {
  const governing = governingDecoration(line)
  const pooledQty = governing?.pooledQty
  if (!governing || pooledQty == null) return null

  const candidates = [
    nextCheaperMin(line.brackets, pooledQty),
    nextCheaperMin(governing.brackets, pooledQty),
  ].filter((v): v is number => v != null)

  if (candidates.length === 0) return null
  const unitsToNext = Math.min(...candidates) - pooledQty
  if (unitsToNext <= 0) return null

  return { unitsToNext, decorationName: governing.name }
}

/** The lowest band minimum above `qty` whose price is actually cheaper. */
function nextCheaperMin(
  brackets: CartLineBracket[] | undefined,
  qty: number,
): number | null {
  if (!brackets || brackets.length === 0) return null
  const current = pickBracket(brackets, qty)
  if (!current) return null
  const cheaper = brackets
    .filter((b) => b.minQty > qty && toCents(b.unitPrice) < toCents(current.unitPrice))
    .sort((a, b) => a.minQty - b.minQty)
  return cheaper[0]?.minQty ?? null
}

function toCents(value: number): number {
  return Math.round(value * 100)
}

/**
 * Copy, in one place, exactly as specced (§8). Outcome, not formula.
 */
export const SAME_ARTWORK_PILL_LABEL = 'Same artwork savings'

export function sameArtworkTooltip(savings: SameArtworkSavings): string {
  const rate =
    savings.bandMinQty != null ? `the ${savings.bandMinQty}+ rate` : 'a better rate'
  return `This artwork appears on ${savings.pooledQty} garments in your order, so this line is priced at ${rate}. Removing other garments may change this price.`
}

export function nextArtworkBandMessage(next: NextArtworkBand): string {
  const garments = next.unitsToNext === 1 ? 'garment' : 'garments'
  return `Add ${next.unitsToNext} more ${garments} with this artwork to reach the next price break`
}
