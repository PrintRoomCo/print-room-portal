import { render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { allInLineTotal } from '@/lib/cart/types'
import { CartDrawer } from '../CartDrawer'

const { cart, setOpen } = vi.hoisted(() => ({
  setOpen: vi.fn(),
  cart: {
    lines: [
      {
        lineId: 'line-1',
        productId: 'product-1',
        productName: 'Demo Store Tee',
        variantId: 'variant-1',
        variantLabel: 'Navy / L',
        qty: 60,
        unitPrice: 26.75,
        priceCurrency: 'NZD',
        imageUrl: null,
        decorations: [],
        fulfilmentType: 'made_to_order' as const,
      },
      {
        lineId: 'line-2',
        productId: 'product-2',
        productName: 'Everyday Pullover Hoodie',
        variantId: 'variant-2',
        variantLabel: 'Navy / M',
        qty: 190,
        unitPrice: 52.66,
        priceCurrency: 'NZD',
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
  useCurrency: () => ({ format: (amount: number) => `NZD ${amount.toFixed(2)}` }),
}))
vi.mock('@/contexts/CompanyContext', () => ({
  useCompany: () => ({
    access: { role: 'org_admin' },
    countryPartitionEnabled: false,
    defaultBillingCountry: {
      code: 'NZ',
      name: 'New Zealand',
      currency: 'NZD',
      taxRate: 0.15,
      taxLabel: 'GST 15%',
      isDefault: true,
    },
  }),
}))
vi.mock('next/navigation', () => ({
  usePathname: () => '/catalogue',
  useRouter: () => ({ push: vi.fn() }),
}))
vi.mock('../CartTable', () => ({ CartTable: () => <div>Cart lines</div> }))
vi.mock('@/app/(portal)/cart/PeriodSavingsBar', () => ({
  PeriodSavingsBar: () => null,
}))

/**
 * 60 x 26.75 = 1,605.00 and 190 x 52.66 = 10,005.40 are the ex-GST line
 * amounts CartTable prints. Their sum is 11,610.40, but the drawer's only
 * figure was the GST-inclusive 13,351.96 — a 1,741.56 gap with nothing on
 * screen to explain it (Jon, 2026-08-26).
 */
describe('CartDrawer totals reconcile the line amounts to the total', () => {
  it('shows the ex-GST subtotal that matches the sum of the line amounts', () => {
    render(<CartDrawer />)

    const subtotal = screen.getByTestId('cart-subtotal-row')
    expect(within(subtotal).getByText(/Subtotal/)).toBeInTheDocument()
    expect(within(subtotal).getByText('$11,610.40')).toBeInTheDocument()
  })

  it('shows the GST added on top, using the billing country tax label', () => {
    render(<CartDrawer />)

    const gst = screen.getByTestId('cart-gst-row')
    expect(within(gst).getByText('GST 15%')).toBeInTheDocument()
    expect(within(gst).getByText('$1,741.56')).toBeInTheDocument()
  })

  it('labels the total as GST-inclusive', () => {
    render(<CartDrawer />)

    const total = screen.getByTestId('cart-total-row')
    expect(within(total).getByText(/incl\. GST/i)).toBeInTheDocument()
    expect(within(total).getByText('$13,351.96')).toBeInTheDocument()
  })
})

/**
 * The "excl. GST" label is only honest while the subtotal stays the raw goods
 * value that GST is charged ON. Pin both halves: it equals the sum of the
 * amounts CartTable prints, and GST is added on top rather than baked in.
 */
describe('CartDrawer subtotal is genuinely ex-GST', () => {
  it('equals the sum of the line amounts, with no tax component', () => {
    render(<CartDrawer />)

    const expected = cart.lines.reduce((sum, line) => sum + allInLineTotal(line), 0)
    expect(expected).toBeCloseTo(11610.4, 2)

    const subtotal = screen.getByTestId('cart-subtotal-row')
    expect(within(subtotal).getByText('$11,610.40')).toBeInTheDocument()
    // Had the subtotal been GST-inclusive it would read 13,351.96 here.
    expect(within(subtotal).queryByText('$13,351.96')).not.toBeInTheDocument()
  })

  it('adds GST on top of the subtotal to reach the total', () => {
    render(<CartDrawer />)

    const amount = (testId: string) => {
      const text = screen.getByTestId(testId).textContent ?? ''
      const match = text.match(/\$([\d,]+\.\d{2})/)
      if (!match) throw new Error(`no amount rendered in ${testId}: ${text}`)
      return Number(match[1].replace(/,/g, ''))
    }

    const subtotal = amount('cart-subtotal-row')
    const gst = amount('cart-gst-row')
    const total = amount('cart-total-row')

    expect(subtotal + gst).toBeCloseTo(total, 2)
    expect(gst).toBeCloseTo(subtotal * 0.15, 2)
    // Tax-inclusive subtotal would fail both of the above, but assert the
    // direction outright so the intent survives a future rate change.
    expect(subtotal).toBeLessThan(total)
  })
})
