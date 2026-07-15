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
