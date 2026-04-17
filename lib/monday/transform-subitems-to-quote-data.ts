/**
 * Pure transformer: Monday Production snapshot → `QuoteDataItem[]` + summary.
 *
 * No I/O. All lookups (colour hex, SKU→productId) must be supplied by the caller.
 */

import type { QuoteDataItem } from '@/lib/job-tracker'
import { PRODUCTION_COLUMNS } from './column-ids'
import type { MondayProjectSnapshot, MondaySubitemLine } from './subitems'

export interface TransformLookups {
  colorHexByName: Record<string, string>
  skuToProductId?: Record<string, string>
}

export interface TransformResult {
  items: QuoteDataItem[]
  summary: { total: number; subtotal: number }
  warnings: string[]
}

const DEFAULT_COLOR_HEX = '#9ca3af'

function normalizeDecorationCode(token: string | undefined): string | undefined {
  if (!token) return undefined
  const t = token.trim().toUpperCase()
  switch (t) {
    case 'SP':
      return 'screen'
    case 'EMB':
      return 'embroidery'
    case 'HP':
      return 'heatpress'
    case 'DTF':
      return 'dtf'
    default:
      return undefined
  }
}

function proxyArtworkUrl(url: string): string {
  return `/api/monday-asset?url=${encodeURIComponent(url)}`
}

function toQuoteDataItem(
  sub: MondaySubitemLine,
  printMethod: string | undefined,
  artworkUrl: string | undefined,
  lookups: TransformLookups,
  warnings: string[]
): QuoteDataItem {
  const colorName = sub.colorName
  const colorHex = colorName
    ? lookups.colorHexByName[colorName.toLowerCase()] ?? DEFAULT_COLOR_HEX
    : undefined

  const skuKey = sub.productSku?.trim().toUpperCase()
  const productId = skuKey ? lookups.skuToProductId?.[skuKey] : undefined

  if (skuKey && lookups.skuToProductId && !productId) {
    warnings.push(`No products.id match for SKU "${sub.productSku}"`)
  }

  if (
    typeof sub.formulaTotal === 'number' &&
    Math.abs(sub.formulaTotal - sub.totalQty) > 1
  ) {
    warnings.push(
      `Size sum (${sub.totalQty}) diverges from formula total (${sub.formulaTotal}) on subitem ${sub.mondaySubitemId}`
    )
  }

  const logos: NonNullable<QuoteDataItem['customizations']>['logos'] =
    artworkUrl || printMethod
      ? [
          {
            ...(artworkUrl ? { imageUrl: proxyArtworkUrl(artworkUrl) } : {}),
            ...(printMethod ? { printMethod } : {}),
          },
        ]
      : undefined

  const customizations: QuoteDataItem['customizations'] = {}
  if (logos) customizations.logos = logos
  if (colorName && colorHex) {
    customizations.colors = {
      garment: { name: colorName, hex: colorHex },
    }
  }

  const item: QuoteDataItem = {
    productName: sub.productName,
    sizes: { ...sub.sizes },
    quantity: sub.totalQty,
    subtotal: 0,
    designInstanceId: `monday:${sub.mondaySubitemId}`,
  }
  if (productId) item.productId = productId
  if (Object.keys(customizations).length > 0) item.customizations = customizations

  return item
}

export function transformSubitemsToQuoteData(
  snapshot: MondayProjectSnapshot,
  lookups: TransformLookups
): TransformResult {
  const warnings: string[] = []

  const decorationRaw = snapshot.columns[PRODUCTION_COLUMNS.decorationMethods]?.text
  const firstDecorationToken = decorationRaw?.split(',')[0]?.trim()
  const printMethod = normalizeDecorationCode(firstDecorationToken)

  const artworkUrl = snapshot.artworkUrls[0]

  const items = snapshot.subitems
    .filter((sub) => sub.totalQty > 0 || Object.keys(sub.sizes).length > 0)
    .map((sub) => toQuoteDataItem(sub, printMethod, artworkUrl, lookups, warnings))

  const quoteTotalRaw = snapshot.columns[PRODUCTION_COLUMNS.quoteTotal]?.text
  const quoteTotal = quoteTotalRaw ? Number(quoteTotalRaw) : 0
  const total = Number.isFinite(quoteTotal) ? quoteTotal : 0

  return {
    items,
    summary: { total, subtotal: total },
    warnings,
  }
}
