import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { VariantPicker, type VariantRow } from '../VariantPicker'

const variants: VariantRow[] = [
  { variant_id: 'red-s', color_swatch_id: 'red', color_label: 'Red', color_hex: '#f00', color_position: 0, size_id: 1, size_label: 'S', size_order: 0 },
  { variant_id: 'red-m', color_swatch_id: 'red', color_label: 'Red', color_hex: '#f00', color_position: 0, size_id: 2, size_label: 'M', size_order: 1 },
  { variant_id: 'red-l', color_swatch_id: 'red', color_label: 'Red', color_hex: '#f00', color_position: 0, size_id: 3, size_label: 'L', size_order: 2 },
]
// keyed by variant_id; red-l deliberately ABSENT (untracked). Cast avoids
// importing the VariantAvailability type into the fixture.
const availability = {
  'red-s': { available_qty: 4, allow_order_without_stock: false },
  'red-m': { available_qty: 0, allow_order_without_stock: false },
} as never

describe('VariantPicker inStockOnly', () => {
  it('shows only in-stock sizes and no status text in inStockOnly mode', () => {
    render(
      <VariantPicker
        variants={variants}
        selectedColorSwatchId="red"
        selectedSizeId={1}
        onChange={vi.fn()}
        availability={availability}
        showSizePicker
        inStockOnly
      />,
    )
    // Status is suppressed in inStockOnly mode, so the in-stock size's radio
    // accessible name is exactly its label ("S").
    expect(screen.getByRole('radio', { name: /^S$/ })).toBeInTheDocument()
    expect(screen.queryByRole('radio', { name: /^M$/ })).not.toBeInTheDocument() // 0 stock → hidden
    expect(screen.queryByRole('radio', { name: /^L$/ })).not.toBeInTheDocument() // untracked → hidden
    expect(screen.queryByText(/in stock/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/available to order/i)).not.toBeInTheDocument()
  })

  it('default mode (inStockOnly off) is unchanged — all sizes + status text show', () => {
    render(
      <VariantPicker
        variants={variants}
        selectedColorSwatchId="red"
        selectedSizeId={1}
        onChange={vi.fn()}
        availability={availability}
        showSizePicker
      />,
    )
    // Size items render <span>{label}</span> with NO aria-label, so in default
    // mode a size radio's accessible name is label + status (e.g. "M 0 in stock").
    // Query by the size label text, not an exact radio name. red-l is untracked
    // → it still renders in default mode with no status span.
    expect(screen.getByText('M')).toBeInTheDocument()
    expect(screen.getByText('L')).toBeInTheDocument()
    // Two sizes have status text ("4 in stock", "0 in stock") → use getAllByText.
    expect(screen.getAllByText(/in stock/i).length).toBeGreaterThan(0)
  })
})
