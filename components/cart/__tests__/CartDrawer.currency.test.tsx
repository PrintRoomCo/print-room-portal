import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { CartDrawer } from '../CartDrawer'

const { cart, setOpen } = vi.hoisted(() => ({
  setOpen: vi.fn(),
  cart: {
    lines: [
      {
        lineId: 'line-1',
        productId: 'product-1',
        productName: 'Test tee',
        variantId: 'variant-1',
        variantLabel: 'Black / M',
        qty: 1,
        unitPrice: 10,
        priceCurrency: 'AUD',
        imageUrl: null,
        decorations: [],
        fulfilmentType: 'made_to_order' as const,
      },
    ],
    updateLine: vi.fn(),
    removeLine: vi.fn(),
    setFulfilmentType: vi.fn(),
  },
}))

vi.mock('../useCart', () => ({ useCart: () => cart }))
vi.mock('@/components/layout/PortalTopBarContext', () => ({
  useCartDrawer: () => ({ open: true, setOpen }),
}))
vi.mock('@/contexts/CurrencyContext', () => ({
  useCurrency: () => ({ format: (amount: number) => `VISITOR-NZD ${amount.toFixed(2)}` }),
}))
vi.mock('@/contexts/CompanyContext', () => ({
  useCompany: () => ({ access: { role: 'org_admin', region: 'AU' } }),
}))
vi.mock('next/navigation', () => ({
  usePathname: () => '/catalogue',
  useRouter: () => ({ push: vi.fn() }),
}))
vi.mock('../CartTable', () => ({ CartTable: () => <div>Cart lines</div> }))
vi.mock('@/app/(portal)/cart/PeriodSavingsBar', () => ({
  PeriodSavingsBar: () => null,
}))

describe('CartDrawer canonical authored currency', () => {
  it('formats the cart total as AUD without applying visitor FX', () => {
    render(<CartDrawer />)

    expect(screen.getByText('$11.00')).toBeInTheDocument()
    expect(screen.queryByText(/VISITOR-NZD/)).not.toBeInTheDocument()
  })
})
