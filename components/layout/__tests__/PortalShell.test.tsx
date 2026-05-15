import { render, screen } from '@testing-library/react'
import { PortalShell } from '../PortalShell'

vi.mock('@/contexts/CompanyContext', () => ({
  useCompany: () => ({
    access: { companyName: 'Test', role: 'org_admin', stores: [] },
    loading: false,
  }),
}))
vi.mock('../PortalTopBar', () => ({
  PortalTopBar: () => <div data-testid="topbar" />,
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

describe('PortalShell', () => {
  it('renders a skip-to-content link as first focusable child', () => {
    render(<PortalShell>content</PortalShell>)
    const skip = screen.getByRole('link', { name: /skip to main content/i })
    expect(skip).toHaveAttribute('href', '#main-content')
  })
})
