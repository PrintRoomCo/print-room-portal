export interface PeriodSavingsBand {
  minQuantity: number
  unitPrice: number
}

export interface PeriodSavingsOpportunity {
  projectedNetworkQty: number
  unitsToNextSaving: number
  currentUnitPrice: number
  nextUnitPrice: number
  perUnitSavings: number
  franchiseSavings: number
}

function toCents(value: number): number {
  return Math.round(value * 100)
}

function fromCents(value: number): number {
  return value / 100
}

/**
 * Finds the next tier that actually lowers the price.
 *
 * The projected network quantity includes the franchise's unsubmitted
 * selection/cart. That makes the progress message describe what the total will
 * be after checkout, while same-price quantity boundaries are deliberately
 * skipped because they do not unlock a saving.
 */
export function calculatePeriodSavingsOpportunity({
  networkQty,
  franchiseQty,
  bands,
}: {
  networkQty: number
  franchiseQty: number
  bands: PeriodSavingsBand[]
}): PeriodSavingsOpportunity | null {
  const safeNetworkQty = Math.max(0, Math.floor(networkQty))
  const safeFranchiseQty = Math.max(0, Math.floor(franchiseQty))
  const projectedNetworkQty = safeNetworkQty + safeFranchiseQty
  const pricingQty = Math.max(projectedNetworkQty, 1)
  const sortedBands = bands
    .filter(
      (band) =>
        Number.isFinite(band.minQuantity) &&
        band.minQuantity > 0 &&
        Number.isFinite(band.unitPrice),
    )
    .slice()
    .sort((a, b) => a.minQuantity - b.minQuantity)

  let currentBand: PeriodSavingsBand | null = null
  for (const band of sortedBands) {
    if (band.minQuantity <= pricingQty) currentBand = band
    else break
  }
  currentBand ??= sortedBands[0] ?? null
  if (!currentBand) return null

  const currentPriceCents = toCents(currentBand.unitPrice)
  const nextSavingBand = sortedBands.find(
    (band) =>
      band.minQuantity > pricingQty &&
      toCents(band.unitPrice) < currentPriceCents,
  )
  if (!nextSavingBand) return null

  const nextPriceCents = toCents(nextSavingBand.unitPrice)
  const savingCents = currentPriceCents - nextPriceCents

  return {
    projectedNetworkQty,
    unitsToNextSaving: nextSavingBand.minQuantity - projectedNetworkQty,
    currentUnitPrice: fromCents(currentPriceCents),
    nextUnitPrice: fromCents(nextPriceCents),
    perUnitSavings: fromCents(savingCents),
    franchiseSavings: fromCents(savingCents * safeFranchiseQty),
  }
}
