'use client'

interface TierCard {
  tierLabel: string
  minQuantity: number
  maxQuantity: number | null
  unitPriceExclGst: number
  unitPriceInclGst: number
  isCurrent: boolean
}

interface Props {
  tiers: TierCard[]
}

export function VolumePricingTiers({ tiers }: Props) {
  if (!tiers || tiers.length === 0) return null

  return (
    <div className="flex gap-2 flex-wrap">
      {tiers.map(tier => (
        <div
          key={tier.tierLabel}
          className={`card-interactive flex-1 min-w-[100px] p-3 text-center ${
            tier.isCurrent ? 'border-[rgb(var(--color-brand-blue))] bg-[rgb(var(--color-brand-blue))]/5' : ''
          }`}
        >
          <div className="text-xs text-muted-foreground">{tier.tierLabel} units</div>
          <div className="text-lg font-bold mt-1">${tier.unitPriceInclGst.toFixed(2)}</div>
          {tier.isCurrent && (
            <span className="glass-badge-green text-[10px] mt-1 inline-block">Current</span>
          )}
        </div>
      ))}
    </div>
  )
}
