export const SHOW_ALL_VARIANTS_KEY = 'pr.catalogue.showAllVariants'

/** Default ON: with nothing stored, customers see per-colour tiles. */
export function readShowAllVariants(storage: Pick<Storage, 'getItem'>): boolean {
  const raw = storage.getItem(SHOW_ALL_VARIANTS_KEY)
  if (raw === null) return true
  return raw !== '0'
}

export function writeShowAllVariants(storage: Pick<Storage, 'setItem'>, on: boolean): void {
  storage.setItem(SHOW_ALL_VARIANTS_KEY, on ? '1' : '0')
}
