import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AccountMenu } from '../AccountMenu'

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  signOut: vi.fn(),
  useAuth: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.push }),
}))

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: mocks.useAuth,
}))

beforeEach(() => {
  mocks.push.mockClear()
  mocks.signOut.mockReset().mockResolvedValue(undefined)
  mocks.useAuth.mockReset()
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

    const trigger = screen.getByRole('button', { name: /account/i })
    trigger.focus()
    await user.keyboard('{Enter}')

    expect(await screen.findByRole('menu')).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /settings/i })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /sign out/i })).toBeInTheDocument()

    await user.keyboard('{Escape}')

    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
    expect(trigger).toHaveFocus()
  })

  it('keeps the optimistic sign-out navigation', async () => {
    const user = userEvent.setup()
    mocks.useAuth.mockReturnValue({ user: { id: 'user-1' }, signOut: mocks.signOut })

    render(<AccountMenu />)

    await user.click(screen.getByRole('button', { name: /account/i }))
    await user.click(await screen.findByRole('menuitem', { name: /sign out/i }))

    expect(mocks.push).toHaveBeenCalledWith('/sign-in')
    expect(mocks.signOut).toHaveBeenCalledTimes(1)
  })
})
