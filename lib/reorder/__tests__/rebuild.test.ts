import { describe, it, expect } from 'vitest'
import {
  buildRebuildLines,
  deriveFulfilmentType,
  type QuoteItemRebuildRow,
} from '../rebuild'

function row(over: Partial<QuoteItemRebuildRow> = {}): QuoteItemRebuildRow {
  return {
    product_id: 'product_id' in over ? over.product_id! : 'p1',
    variant_id: 'variant_id' in over ? over.variant_id! : 'v1',
    product_name: over.product_name ?? 'Basic Tee',
    quantity: over.quantity ?? 10,
    decorations: 'decorations' in over ? over.decorations : [],
    ship_to_store_id: over.ship_to_store_id ?? null,
    catalogue_item_id: over.catalogue_item_id ?? null,
    catalogue_variant_label: over.catalogue_variant_label ?? null,
    qty_from_stock: over.qty_from_stock ?? 0,
    qty_to_make: over.qty_to_make ?? 0,
    colour_label: over.colour_label ?? null,
    size_label: over.size_label ?? null,
    image_url: over.image_url ?? null,
  }
}

describe('deriveFulfilmentType', () => {
  it('is made_to_order when any qty is destined for production', () => {
    expect(deriveFulfilmentType({ qty_to_make: 5 })).toBe('made_to_order')
  })
  it('is stocked when nothing is made (pure stock draw)', () => {
    expect(deriveFulfilmentType({ qty_to_make: 0 })).toBe('stocked')
  })
})

describe('buildRebuildLines', () => {
  it('maps colour + size join into "Colour / Size"', () => {
    const { lines } = buildRebuildLines([row({ colour_label: 'Bone', size_label: 'M' })])
    expect(lines[0].variantLabel).toBe('Bone / M')
  })

  it('falls back to catalogue_variant_label when the variant join is empty', () => {
    const { lines } = buildRebuildLines([
      row({ colour_label: null, size_label: null, catalogue_variant_label: 'Design A' }),
    ])
    expect(lines[0].variantLabel).toBe('Design A')
  })

  it('falls back to "—" when nothing resolves a label', () => {
    const { lines } = buildRebuildLines([row({ colour_label: null, size_label: null })])
    expect(lines[0].variantLabel).toBe('—')
  })

  it('carries product, qty, store, catalogue identity and image straight through', () => {
    const { lines } = buildRebuildLines([
      row({
        product_id: 'p9',
        quantity: 24,
        ship_to_store_id: 'store-1',
        catalogue_item_id: 'ci-1',
        catalogue_variant_label: 'Design A',
        image_url: 'https://img/x.png',
      }),
    ])
    expect(lines[0]).toMatchObject({
      productId: 'p9',
      qty: 24,
      shipToStoreId: 'store-1',
      catalogueItemId: 'ci-1',
      catalogueVariantLabel: 'Design A',
      imageUrl: 'https://img/x.png',
      unitPrice: 0,
    })
  })

  it('counts a null variant_id as a degraded line but still emits it (variantless)', () => {
    const { lines, degradedCount } = buildRebuildLines([row({ variant_id: null })])
    expect(degradedCount).toBe(1)
    expect(lines[0].variantId).toBe('')
  })

  it('drops rows with no product_id (cannot re-add or re-price)', () => {
    const { lines } = buildRebuildLines([row({ product_id: null })])
    expect(lines).toHaveLength(0)
  })

  it('passes through well-formed decoration snapshots and ignores malformed ones', () => {
    const good = { linkId: 'l1', decorationId: 'od1', name: 'Emb', method: 'embroidery', positionLabel: 'LC', unitPrice: 3, artworkUrl: 'a', snapshotUrl: null }
    const { lines } = buildRebuildLines([row({ decorations: [good, { nope: true }, null] })])
    expect(lines[0].decorations).toHaveLength(1)
    expect(lines[0].decorations[0].linkId).toBe('l1')
  })
})
