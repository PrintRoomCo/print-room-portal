import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const addLine = vi.fn()
const push = vi.fn()
// Hoisted so the (hoisted) vi.mock factory can read it and each test can flip
// the role. Default org_admin so the existing branch tests see the button.
const company = vi.hoisted(() => ({ isOrgAdmin: true }))
vi.mock('@/components/cart/useCart', () => ({ useCart: () => ({ addLine }) }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))
// Legacy modal path renders ReorderForm — stub it so this test stays focused.
vi.mock('@/components/orders/ReorderForm', () => ({
  ReorderForm: () => <div data-testid="legacy-reorder-form" />,
}))
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { email: 'a@b.test' } }) }))
vi.mock('@/contexts/CompanyContext', () => ({
  useCompany: () => ({ access: { isOrgAdmin: company.isOrgAdmin } }),
}))

import { ReorderButton } from '../ReorderButton'
import type { JobTracker } from '@/lib/job-tracker'

function tracker(over: Partial<JobTracker> = {}): JobTracker {
  return { id: 1, status: 'completed', quote_id: null, ...over } as unknown as JobTracker
}

beforeEach(() => {
  vi.clearAllMocks()
  company.isOrgAdmin = true
  vi.stubGlobal('fetch', vi.fn())
})

describe('ReorderButton', () => {
  it('rebuilds the cart and routes to /cart for a quote_id-linked order', async () => {
    ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({
        lines: [{ productId: 'p1', qty: 10, variantId: 'v1', variantLabel: 'Bone / M' }],
        degradedCount: 0,
      }),
    })

    render(<ReorderButton tracker={tracker({ quote_id: 'q-1' })} />)
    await userEvent.click(screen.getByRole('button', { name: /reorder/i }))

    await waitFor(() => expect(addLine).toHaveBeenCalledTimes(1))
    expect(addLine).toHaveBeenCalledWith(
      expect.objectContaining({ productId: 'p1', variantLabel: 'Bone / M' }),
    )
    expect(push).toHaveBeenCalledWith('/cart')
    expect(screen.queryByTestId('legacy-reorder-form')).toBeNull()
  })

  it('opens the legacy Monday modal for an order with no quote_id', async () => {
    render(<ReorderButton tracker={tracker({ quote_id: null })} />)
    await userEvent.click(screen.getByRole('button', { name: /reorder/i }))
    expect(screen.getByTestId('legacy-reorder-form')).toBeInTheDocument()
    expect(globalThis.fetch).not.toHaveBeenCalled()
    expect(addLine).not.toHaveBeenCalled()
  })

  it('renders nothing for a non-admin (staff) member — gate covers both branches', () => {
    company.isOrgAdmin = false
    const { container } = render(<ReorderButton tracker={tracker({ quote_id: 'q-1' })} />)
    expect(screen.queryByRole('button', { name: /reorder/i })).toBeNull()
    expect(container).toBeEmptyDOMElement()
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })
})
