/**
 * Monday.com — fetch a Production board item with its subitems.
 *
 * Returns a flattened snapshot suitable for `transformSubitemsToQuoteData`.
 */

import { mondayApiCall } from './client'
import { PRODUCTION_SUBITEM_COLUMNS as S } from './column-ids'

export interface MondayColumnValue {
  id: string
  text?: string | null
  value?: string | null
  display_value?: string | null
  linked_items?: Array<{ id: string; name: string }>
}

export interface MondaySubitemLine {
  mondayItemId: number
  mondaySubitemId: number
  name: string
  productName: string
  productSku?: string
  colorName?: string
  brand?: string
  sizes: Record<string, number>
  totalQty: number
  stockStatus?: string
  formulaTotal?: number
}

export interface MondayProjectSnapshot {
  itemId: number
  itemName: string
  columns: Record<string, MondayColumnValue>
  artworkUrls: string[]
  proofPdfUrls: string[]
  subitems: MondaySubitemLine[]
}

interface ProjectWithSubitemsResult {
  items: Array<{
    id: string
    name: string
    column_values: Array<{
      id: string
      text?: string | null
      value?: string | null
      display_value?: string | null
      linked_items?: Array<{ id: string; name: string }>
    }>
    subitems: Array<{
      id: string
      name: string
      column_values: Array<{
        id: string
        text?: string | null
        value?: string | null
        display_value?: string | null
        linked_items?: Array<{ id: string; name: string }>
      }>
    }> | null
  }>
}

function indexColumns(
  columns: MondayColumnValue[] | undefined
): Record<string, MondayColumnValue> {
  const out: Record<string, MondayColumnValue> = {}
  if (!columns) return out
  for (const c of columns) out[c.id] = c
  return out
}

/**
 * Parse a Monday file column — returns a list of URLs it refers to.
 * Monday populates file columns in two shapes:
 *  1. `text` is a string of comma-separated URLs (observed on some file_* columns)
 *  2. `value` is a JSON string like `{"files":[{"assetId":123,"name":"x.png", ...}]}`
 *     — assets must be loaded via the protected_static endpoint.
 */
function extractFileUrls(col: MondayColumnValue | undefined): string[] {
  if (!col) return []
  const urls: string[] = []

  if (col.text) {
    for (const token of col.text.split(/[,\n]/).map((t) => t.trim())) {
      if (/^https?:\/\//i.test(token)) urls.push(token)
    }
  }

  if (col.value) {
    try {
      const parsed = JSON.parse(col.value) as {
        files?: Array<{ assetId?: number | string; url?: string; name?: string }>
      }
      if (Array.isArray(parsed.files)) {
        for (const f of parsed.files) {
          if (f.url && /^https?:\/\//i.test(f.url)) {
            urls.push(f.url)
          } else if (f.assetId) {
            urls.push(
              `https://theprint-room-group.monday.com/protected_static/${f.assetId}/resources/${f.assetId}/${encodeURIComponent(f.name ?? 'file')}`
            )
          }
        }
      }
    } catch {
      // silently fall back to text-only parsing
    }
  }

  return Array.from(new Set(urls))
}

function parseSubitem(
  parentItemId: number,
  subitem: ProjectWithSubitemsResult['items'][number]['subitems'] extends (infer U)[] | null
    ? U
    : never
): MondaySubitemLine {
  const cols = indexColumns(subitem.column_values)

  const skuMirror = cols[S.skuMirror]?.display_value?.trim()
  const fallbackSku = cols[S.fallbackSku]?.text?.trim()
  const productSku = skuMirror || fallbackSku || undefined

  const linkedGarment = cols[S.garmentRelation]?.linked_items?.[0]?.name?.trim()
  const fallbackGarment = cols[S.fallbackGarment]?.text?.trim()
  const productName = linkedGarment || fallbackGarment || subitem.name

  const colorMirror = cols[S.colorMirror]?.display_value?.trim()
  const fallbackColor = cols[S.fallbackColor]?.text?.trim()
  let colorName = colorMirror || fallbackColor || undefined
  if (!colorName && linkedGarment) {
    const trailing = linkedGarment.split(/\s+/).slice(-1)[0]
    if (trailing && /^[A-Z][a-z]+$/.test(trailing)) colorName = trailing
  }

  const brand = cols[S.brand]?.text?.trim() || undefined
  const stockStatus = cols[S.stockStatus]?.text?.trim() || undefined

  const sizes: Record<string, number> = {}
  for (const [sizeKey, colId] of Object.entries(S.sizes)) {
    const raw = cols[colId]?.text
    if (!raw) continue
    const n = Number(raw)
    if (Number.isFinite(n) && n > 0) sizes[sizeKey] = n
  }

  const totalQty = Object.values(sizes).reduce((sum, n) => sum + n, 0)

  const formulaRaw = cols[S.formulaTotal]?.text
  const formulaTotal = formulaRaw ? Number(formulaRaw) : undefined

  return {
    mondayItemId: parentItemId,
    mondaySubitemId: Number(subitem.id),
    name: subitem.name,
    productName,
    productSku,
    colorName,
    brand,
    sizes,
    totalQty,
    stockStatus,
    formulaTotal: Number.isFinite(formulaTotal) ? formulaTotal : undefined,
  }
}

const PROJECT_QUERY = `
  query ProjectWithSubitems($itemId: [ID!]!) {
    items(ids: $itemId) {
      id
      name
      column_values {
        id
        text
        value
        ... on MirrorValue { display_value }
        ... on BoardRelationValue { linked_items { id name } }
      }
      subitems {
        id
        name
        column_values {
          id
          text
          value
          ... on MirrorValue { display_value }
          ... on BoardRelationValue { linked_items { id name } }
        }
      }
    }
  }
`

export async function fetchProductionProjectWithSubitems(
  mondayItemId: number
): Promise<MondayProjectSnapshot | null> {
  const data = await mondayApiCall<ProjectWithSubitemsResult>(PROJECT_QUERY, {
    itemId: [String(mondayItemId)],
  })

  const raw = data?.items?.[0]
  if (!raw) return null

  const columns = indexColumns(raw.column_values)

  const artworkUrls = extractFileUrls(columns['file_mkpesta8'])
  const proofPdfUrls = extractFileUrls(columns['file_mkqjp7kh'])

  const subitems = (raw.subitems ?? []).map((sub) =>
    parseSubitem(Number(raw.id), sub)
  )

  return {
    itemId: Number(raw.id),
    itemName: raw.name,
    columns,
    artworkUrls,
    proofPdfUrls,
    subitems,
  }
}
