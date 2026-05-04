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
