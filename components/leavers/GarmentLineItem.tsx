'use client'

import { useCallback } from 'react'
import type { GarmentLine, CatalogData } from './QuoteBuilder'
import { DecorationItem } from './DecorationItem'
import { VolumePricingTiers } from './VolumePricingTiers'

interface Props {
  index: number
  line: GarmentLine
  catalog: CatalogData
  linePricing: any | null
  onChange: (line: GarmentLine) => void
  onRemove?: () => void
  onOpenDesignPicker: (decoIdx: number) => void
  quoteSessionId: string
  artworkUploadUrl: string
}

function emptyDecoration() {
  return {
    decorationType: '', detail: '', location: '', decorationColours: '',
    artworkType: 'custom' as const, artworkFileId: '', standardDesignId: '',
  }
}

export function GarmentLineItem({
  index, line, catalog, linePricing, onChange, onRemove,
  onOpenDesignPicker, quoteSessionId, artworkUploadUrl,
}: Props) {
  const update = useCallback((patch: Partial<GarmentLine>) => {
    onChange({ ...line, ...patch })
  }, [line, onChange])

  // Cascade helpers
  const productTypes = catalog.productTypes.map((pt: any) => pt.name)
  const brands = catalog.productTypes.find((pt: any) => pt.name === line.productType)?.brands?.map((b: any) => b.name) || []
  const productsForBrand = catalog.productTypes
    .find((pt: any) => pt.name === line.productType)?.brands
    ?.find((b: any) => b.name === line.brand)?.products || []

  const handleProductTypeChange = (productType: string) => {
    const pt = catalog.productTypes.find((t: any) => t.name === productType)
    const newBrands = pt?.brands || []
    if (newBrands.length === 1) {
      const brand = newBrands[0].name
      const prods = newBrands[0].products || []
      if (prods.length === 1) {
        update({ productType, brand, productId: prods[0].id, productName: prods[0].productName })
      } else {
        update({ productType, brand, productId: '', productName: '' })
      }
    } else {
      update({ productType, brand: '', productId: '', productName: '' })
    }
  }

  const handleBrandChange = (brand: string) => {
    const pt = catalog.productTypes.find((t: any) => t.name === line.productType)
    const br = pt?.brands?.find((b: any) => b.name === brand)
    const prods = br?.products || []
    if (prods.length === 1) {
      update({ brand, productId: prods[0].id, productName: prods[0].productName })
    } else {
      update({ brand, productId: '', productName: '' })
    }
  }

  const handleProductChange = (productId: string) => {
    const prod = catalog.products.find((p: any) => p.id === productId)
    if (prod) {
      update({ productId, productName: prod.productName, productType: prod.productType, brand: prod.brand })
    }
  }

  const handleDecoChange = (decoIdx: number, deco: any) => {
    const decos = [...line.decorations]
    decos[decoIdx] = deco
    update({ decorations: decos })
  }

  const addDecoration = () => {
    if (line.decorations.length < 4) {
      update({ decorations: [...line.decorations, emptyDecoration()] })
    }
  }

  const removeDecoration = (decoIdx: number) => {
    if (line.decorations.length > 1) {
      update({ decorations: line.decorations.filter((_, i) => i !== decoIdx) })
    }
  }

  const formatPrice = (n: number | null | undefined) => n != null ? `$${Number(n).toFixed(2)}` : '--'

  return (
    <div className="card p-6 mb-4">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <span className="w-7 h-7 rounded-full bg-[rgb(var(--color-brand-blue))] text-white text-xs font-semibold flex items-center justify-center">
            {index + 1}
          </span>
          <span className="font-semibold">Garment Line</span>
        </div>
        <div className="flex gap-2">
          <button
            className="btn-ghost text-xs"
            onClick={() => update({ _expanded: !line._expanded })}
          >
            {line._expanded ? 'Collapse' : 'Expand'}
          </button>
          {onRemove && (
            <button className="btn-ghost text-xs text-red-500" onClick={onRemove}>Remove</button>
          )}
        </div>
      </div>

      {line._expanded && (
        <>
          {/* Product cascade */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1 uppercase tracking-wide">Product Type</label>
              <select className="select-glass" value={line.productType} onChange={e => handleProductTypeChange(e.target.value)}>
                <option value="">Select type...</option>
                {productTypes.map((t: string) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1 uppercase tracking-wide">Brand</label>
              <select className="select-glass" value={line.brand} onChange={e => handleBrandChange(e.target.value)} disabled={!line.productType}>
                <option value="">Select brand...</option>
                {brands.map((b: string) => <option key={b} value={b}>{b}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1 uppercase tracking-wide">Product</label>
              <select className="select-glass" value={line.productId} onChange={e => handleProductChange(e.target.value)} disabled={!line.brand}>
                <option value="">Select product...</option>
                {productsForBrand.map((p: any) => <option key={p.id} value={p.id}>{p.productName}</option>)}
              </select>
            </div>
          </div>

          {/* Colour + Quantity */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1 uppercase tracking-wide">Garment Colour</label>
              <input className="input-glass" value={line.garmentColour} onChange={e => update({ garmentColour: e.target.value })} placeholder="e.g. Navy, Black" />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1 uppercase tracking-wide">Quantity (min 24)</label>
              <div className="quantity-control">
                <button className="quantity-btn" onClick={() => update({ quantity: Math.max(24, line.quantity - 1) })}>-</button>
                <input
                  type="number"
                  className="w-16 text-center bg-transparent border-none focus:outline-none"
                  value={line.quantity}
                  min={24}
                  onChange={e => update({ quantity: Math.max(24, parseInt(e.target.value) || 24) })}
                />
                <button className="quantity-btn" onClick={() => update({ quantity: line.quantity + 1 })}>+</button>
              </div>
            </div>
          </div>

          {/* Decorations */}
          <div className="mb-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Decorations</span>
              {line.decorations.length < 4 && (
                <button className="btn-ghost text-xs" onClick={addDecoration}>+ Add decoration</button>
              )}
            </div>
            {line.decorations.map((deco, decoIdx) => (
              <DecorationItem
                key={decoIdx}
                index={decoIdx}
                decoration={deco}
                productType={line.productType}
                catalog={catalog}
                onChange={(d) => handleDecoChange(decoIdx, d)}
                onRemove={line.decorations.length > 1 ? () => removeDecoration(decoIdx) : undefined}
                onOpenDesignPicker={() => onOpenDesignPicker(decoIdx)}
                quoteSessionId={quoteSessionId}
                artworkUploadUrl={artworkUploadUrl}
              />
            ))}
          </div>

          {/* Line pricing + tiers */}
          {linePricing?.priceable && (
            <div className="mt-4 pt-4 border-t border-gray-100">
              <div className="flex justify-between items-baseline mb-2">
                <span className="text-xs font-medium text-muted-foreground uppercase">Unit price (incl. GST)</span>
                <span className="text-xl font-bold text-[rgb(var(--color-brand-blue))]">
                  {formatPrice(linePricing.unitPriceInclGst)}
                </span>
              </div>
              {linePricing.tierCards && <VolumePricingTiers tiers={linePricing.tierCards} />}
            </div>
          )}
        </>
      )}
    </div>
  )
}
