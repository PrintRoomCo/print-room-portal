// NZ regions used by the account location forms. Stored on `stores.state` as the
// region *name* (e.g. "Auckland"); the form works in region *codes*. Kept here
// once so the server action and the client modal share a single source of truth.

export interface NzRegion {
  code: string
  name: string
}

export const NZ_REGIONS: NzRegion[] = [
  { code: 'AUK', name: 'Auckland' },
  { code: 'BOP', name: 'Bay of Plenty' },
  { code: 'CAN', name: 'Canterbury' },
  { code: 'GIS', name: 'Gisborne' },
  { code: 'HKB', name: "Hawke's Bay" },
  { code: 'MBH', name: 'Marlborough' },
  { code: 'MWT', name: 'Manawatu-Wanganui' },
  { code: 'NSN', name: 'Nelson' },
  { code: 'NTL', name: 'Northland' },
  { code: 'OTA', name: 'Otago' },
  { code: 'STL', name: 'Southland' },
  { code: 'TAS', name: 'Tasman' },
  { code: 'TKI', name: 'Taranaki' },
  { code: 'WGN', name: 'Wellington' },
  { code: 'WKO', name: 'Waikato' },
  { code: 'WTC', name: 'West Coast' },
]

/** Region name for a code, or null if the code is unknown. */
export function regionNameFromCode(code: string | null | undefined): string | null {
  if (!code) return null
  return NZ_REGIONS.find((r) => r.code === code)?.name ?? null
}

/**
 * Reverse-map a stored `state` value back to a region code for pre-filling the
 * form's <select>. Matches by name first (how the create/update actions store
 * it), then by code. Returns '' when nothing matches — callers should keep the
 * raw value as a pass-through option so an edit never silently nulls it out.
 */
export function regionCodeFromState(state: string | null | undefined): string {
  if (!state) return ''
  const trimmed = state.trim().toLowerCase()
  const byName = NZ_REGIONS.find((r) => r.name.toLowerCase() === trimmed)
  if (byName) return byName.code
  const byCode = NZ_REGIONS.find((r) => r.code.toLowerCase() === trimmed)
  return byCode?.code ?? ''
}
