/**
 * NZD-only formatter for SERVER-SAFE rendering paths. If you need
 * the user's chosen display currency (CurrencyContext) — use
 * <Money amount={…} /> from components/shop/Money.tsx instead.
 *
 * Server components can't call useCurrency() (it's a hook). This
 * helper exists for those paths.
 */

const FALLBACK = 'Price on request'

export function formatPrice(n: number | null | undefined): string {
  if (n == null) return FALLBACK
  const num = typeof n === 'number' ? n : Number(n)
  if (!Number.isFinite(num) || num <= 0) return FALLBACK
  return `$${num.toFixed(2)}`
}

export function formatLineTotal(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(Number(n))) return FALLBACK
  return `$${Number(n).toFixed(2)}`
}
