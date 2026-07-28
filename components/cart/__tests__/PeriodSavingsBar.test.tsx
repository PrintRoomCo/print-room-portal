import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PeriodSavingsBar } from '@/app/(portal)/cart/PeriodSavingsBar'

vi.mock('@/contexts/CurrencyContext', () => ({
  useCurrency: () => ({ format: (amount: number) => `$${amount.toFixed(2)}` }),
}))

describe('PeriodSavingsBar', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('names the product and shows the franchise total saving', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        period: { id: 'period-1', closesAt: '2026-08-21T12:00:00.000Z' },
        items: [
          {
            catalogueItemId: 'duffel-item',
            aggQty: 0,
            unitsToNextBreak: 52,
            currentUnitPrice: 32.12,
            nextUnitPrice: 30.14,
            perUnitSavings: 1.98,
            franchiseSavings: 95.04,
          },
        ],
      }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    render(
      <PeriodSavingsBar
        cartItems={[
          {
            catalogueItemId: 'duffel-item',
            productName: 'Recycled Weekender Duffel',
            qty: 48,
          },
        ]}
        compact
      />,
    )

    const notice = await screen.findByRole('status', {
      name: /pre-order savings/i,
    })
    const toggle = screen.getByRole('button', {
      name: /network price progress/i,
    })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(notice).not.toHaveTextContent(
      '52 more units of Recycled Weekender Duffel',
    )

    fireEvent.click(toggle)

    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(notice).toHaveTextContent('52 more units of Recycled Weekender Duffel')
    expect(notice).toHaveTextContent('$95.04')
    expect(notice).toHaveTextContent('$1.98 per unit')
    expect(notice).not.toHaveTextContent('$0.00')
    expect(notice).not.toHaveTextContent('—')
    expect(
      notice.querySelector('[class*="divide-y"], [class*="border-t"]'),
    ).toBeNull()
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('item=duffel-item%3A48'),
      ),
    )
  })
})
