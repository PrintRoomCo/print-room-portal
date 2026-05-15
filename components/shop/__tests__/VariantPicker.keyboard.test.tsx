import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { VariantPicker, type VariantRow } from '../VariantPicker'

const variants: VariantRow[] = [
  {
    variant_id: 'red-s',
    color_swatch_id: 'red',
    color_label: 'Red',
    color_hex: '#ff0000',
    color_position: 0,
    size_id: 1,
    size_label: 'S',
    size_order: 0,
  },
  {
    variant_id: 'blue-s',
    color_swatch_id: 'blue',
    color_label: 'Blue',
    color_hex: '#0000ff',
    color_position: 1,
    size_id: 1,
    size_label: 'S',
    size_order: 0,
  },
]

describe('VariantPicker keyboard navigation', () => {
  it('moves focus between colour swatches with arrow keys', async () => {
    const user = userEvent.setup()
    render(
      <VariantPicker
        variants={variants}
        selectedColorSwatchId="red"
        selectedSizeId={1}
        onChange={vi.fn()}
      />,
    )

    const red = screen.getByRole('radio', { name: /select colour red/i })
    const blue = screen.getByRole('radio', { name: /select colour blue/i })
    const group = screen.getByRole('group', { name: /select colour/i })

    group.focus()
    await user.keyboard('{ArrowRight}')

    expect(blue).toHaveFocus()
  })
})
