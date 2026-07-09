import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PortalShell } from '../PortalShell'

const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
  useAuth: vi.fn(),
  useCompany: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mocks.replace }),
}))

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: mocks.useAuth,
}))

vi.mock('@/contexts/CompanyContext', () => ({
  useCompany: mocks.useCompany,
}))
vi.mock('../PortalTopBar', () => ({
  PortalTopBar: () => <div data-testid="topbar" />,
}))
vi.mock('@/components/cart/CartDrawer', () => ({
  CartDrawer: () => null,
}))
vi.mock('../Sidebar', () => ({
  Sidebar: ({ children }: { children: React.ReactNode }) => (
    <div>
      {children}
      <main id="main-content" />
    </div>
  ),
}))
vi.mock('../RoleChangeNotice', () => ({ RoleChangeNotice: () => null }))
vi.mock('../PortalTopBarContext', () => ({
  PortalTopBarProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))
vi.mock('@/components/ui/PortalSkeleton', () => ({
  PortalSkeleton: () => <div data-testid="skeleton" />,
}))

beforeEach(() => {
  mocks.replace.mockClear()
  mocks.useAuth.mockReset().mockReturnValue({
    user: { id: 'user-1' },
    loading: false,
  })
  mocks.useCompany.mockReset().mockReturnValue({
    access: { companyName: 'Test', role: 'org_admin', stores: [] },
    loading: false,
  })
})

describe('PortalShell', () => {
  it('renders a skip-to-content link as first focusable child', () => {
    render(<PortalShell>content</PortalShell>)
    const skip = screen.getByRole('link', { name: /skip to main content/i })
    expect(skip).toHaveAttribute('href', '#main-content')
  })

  it('redirects signed-out users to sign in instead of showing the account-data error', async () => {
    mocks.useAuth.mockReturnValue({ user: null, loading: false })
    mocks.useCompany.mockReturnValue({ access: null, loading: false })

    render(<PortalShell>content</PortalShell>)

    expect(
      screen.queryByText(/unable to load account data/i),
    ).not.toBeInTheDocument()
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith('/sign-in'))
  })
})
