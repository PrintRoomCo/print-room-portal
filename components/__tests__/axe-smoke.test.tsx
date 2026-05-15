import { render } from '@testing-library/react'
import { axe } from 'vitest-axe'
import { describe, expect, it, vi } from 'vitest'
import { VariantPicker, type VariantRow } from '@/components/shop/VariantPicker'

vi.mock('next/navigation', () => ({
  usePathname: () => '/shop',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}))

vi.mock('@/components/cart/useCart', () => ({
  useCart: () => ({ lines: [], addLine: vi.fn(), removeLine: vi.fn(), updateLine: vi.fn() }),
}))

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: null, signOut: vi.fn() }),
}))

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

describe('axe smoke', () => {
  it('VariantPicker has no a11y violations', async () => {
    const { container } = render(
      <VariantPicker
        variants={variants}
        selectedColorSwatchId="red"
        selectedSizeId={1}
        onChange={vi.fn()}
      />,
    )
    expect(await axe(container)).toHaveNoViolations()
  })

  it('CartChip has no a11y violations', async () => {
    const { CartChip } = await import('@/components/cart/CartChip')
    const { container } = render(<CartChip />)
    expect(await axe(container)).toHaveNoViolations()
  })

  it('AccountMenu (signed-out) has no a11y violations', async () => {
    const { AccountMenu } = await import('@/components/layout/AccountMenu')
    const { container } = render(<AccountMenu />)
    expect(await axe(container)).toHaveNoViolations()
  })
})
