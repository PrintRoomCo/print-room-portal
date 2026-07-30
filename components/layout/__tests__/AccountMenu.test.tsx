import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AccountMenu } from '../AccountMenu'

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
  signOut: vi.fn(),
  useAuth: vi.fn(),
  useCompany: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.push, replace: mocks.replace, refresh: mocks.refresh }),
}))

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: mocks.useAuth,
}))

vi.mock('@/contexts/CompanyContext', () => ({
  useCompany: mocks.useCompany,
}))

beforeEach(() => {
  mocks.push.mockClear()
  mocks.replace.mockClear()
  mocks.refresh.mockClear()
  mocks.signOut.mockReset().mockResolvedValue(undefined)
  mocks.useAuth.mockReset()
  mocks.useCompany.mockReset().mockReturnValue({
    access: { firstName: 'Jamie', lastName: 'Sedgewick' },
  })
})

describe('AccountMenu', () => {
  it('renders a sign-in link for signed-out users', () => {
    mocks.useAuth.mockReturnValue({ user: null, signOut: mocks.signOut })

    render(<AccountMenu />)

    expect(screen.getByRole('link', { name: /sign in/i })).toHaveAttribute(
      'href',
      '/sign-in',
    )
  })

  it('opens from the keyboard, closes on Escape, and returns focus to the trigger', async () => {
    const user = userEvent.setup()
    mocks.useAuth.mockReturnValue({ user: { id: 'user-1' }, signOut: mocks.signOut })

    render(<AccountMenu />)

    const trigger = screen.getByRole('button', { name: /jamie sedgewick/i })
    trigger.focus()
    await user.keyboard('{Enter}')

    expect(await screen.findByRole('menu')).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /settings/i })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /sign out/i })).toBeInTheDocument()

    await user.keyboard('{Escape}')

    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
    expect(trigger).toHaveFocus()
  })

  it('clears the session before navigating to /sign-in on sign out', async () => {
    const user = userEvent.setup()
    mocks.useAuth.mockReturnValue({ user: { id: 'user-1' }, signOut: mocks.signOut })

    render(<AccountMenu />)

    await user.click(screen.getByRole('button', { name: /jamie sedgewick/i }))
    await user.click(await screen.findByRole('menuitem', { name: /sign out/i }))

    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith('/sign-in'))
    expect(mocks.signOut).toHaveBeenCalledTimes(1)
    // Cookie must be cleared before the proxy sees the /sign-in request,
    // otherwise it bounces the still-authed user back to /account.
    expect(mocks.signOut.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.replace.mock.invocationCallOrder[0],
    )
    // Old optimistic push('/sign-in') must not run — it caused the blank /account bounce.
    expect(mocks.push).not.toHaveBeenCalled()
  })

  it('falls back to Account when the member name is missing', () => {
    mocks.useAuth.mockReturnValue({ user: { id: 'user-1' }, signOut: mocks.signOut })
    mocks.useCompany.mockReturnValue({ access: { firstName: '', lastName: '' } })

    render(<AccountMenu />)

    expect(screen.getByRole('button', { name: /account/i })).toBeInTheDocument()
  })
})
