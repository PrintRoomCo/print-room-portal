import { forwardRef } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import SignInPage from '../SignInClient'

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  signIn: vi.fn(),
  requestEmailCode: vi.fn(),
  verifyEmailCode: vi.fn(),
}))

vi.mock('next/image', () => ({
  default: ({ alt = '', width: _width, height: _height, priority: _priority, ...props }: {
    alt?: string
    width?: number
    height?: number
    priority?: boolean
  }) => {
    void _width
    void _height
    void _priority
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img alt={alt} {...props} />
    )
  },
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.push }),
  useSearchParams: () => ({ get: () => null }),
}))

vi.mock('@hcaptcha/react-hcaptcha', () => ({
  default: forwardRef(function MockHCaptcha(_props, _ref) {
    void _props
    void _ref
    return <div data-testid="hcaptcha" />
  }),
}))

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    signIn: mocks.signIn,
    requestEmailCode: mocks.requestEmailCode,
    verifyEmailCode: mocks.verifyEmailCode,
  }),
}))

beforeEach(() => {
  process.env.NEXT_PUBLIC_HCAPTCHA_SITEKEY = 'site-key'
  mocks.push.mockClear()
  mocks.requestEmailCode.mockReset()
  mocks.verifyEmailCode.mockReset()
  window.sessionStorage.clear()
})

describe('SignIn login-help link', () => {
  it('shows a "Trouble logging in?" mailto link beside Forgot password (password mode)', async () => {
    const user = userEvent.setup()
    render(<SignInPage />)

    // Forgot-password + login-help links live in password mode; switch to it.
    await user.click(screen.getByRole('button', { name: 'Password' }))

    const help = screen.getByRole('link', { name: /trouble logging in/i })
    expect(help).toHaveAttribute('href', 'mailto:jamie@theprint-room.co.nz')

    // Sanity: it sits next to the existing Forgot-password link.
    expect(
      screen.getByRole('link', { name: /forgot password/i }),
    ).toHaveAttribute('href', '/reset-password')
  })
})

describe('SignIn email-code persistence (Android tab-discard recovery)', () => {
  it('persists the verify step so a reload restores it instead of the email step', async () => {
    const user = userEvent.setup()
    mocks.requestEmailCode.mockResolvedValue({ error: null })

    // First mount: request a code.
    const { unmount } = render(<SignInPage />)
    await user.type(screen.getByLabelText(/email/i), 'crew@reburger.co.nz')
    await user.click(screen.getByRole('button', { name: /send code/i }))

    // We are now on the verify step.
    expect(await screen.findByLabelText(/6-digit code/i)).toBeInTheDocument()

    // Simulate Android Chrome discarding + reloading the tab: unmount and remount fresh.
    unmount()
    render(<SignInPage />)

    // The reload lands on the verify step with the email intact — not back at "Send code".
    expect(await screen.findByLabelText(/6-digit code/i)).toBeInTheDocument()
    // Email appears in both the info banner and the "Sent to …" line.
    expect(screen.getAllByText(/crew@reburger\.co\.nz/i).length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: /send code/i })).not.toBeInTheDocument()
  })

  it('does not restore once the code has been successfully verified', async () => {
    const user = userEvent.setup()
    mocks.requestEmailCode.mockResolvedValue({ error: null })
    mocks.verifyEmailCode.mockResolvedValue({ error: null })

    const { unmount } = render(<SignInPage />)
    await user.type(screen.getByLabelText(/email/i), 'crew@reburger.co.nz')
    await user.click(screen.getByRole('button', { name: /send code/i }))

    await user.type(await screen.findByLabelText(/6-digit code/i), '123456')
    await user.click(screen.getByRole('button', { name: /verify & sign in/i }))
    expect(mocks.push).toHaveBeenCalled()

    // A later fresh mount starts at the email step — the pending state was cleared.
    unmount()
    render(<SignInPage />)
    expect(screen.getByRole('button', { name: /send code/i })).toBeInTheDocument()
    expect(screen.queryByLabelText(/6-digit code/i)).not.toBeInTheDocument()
  })
})
