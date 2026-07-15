import { forwardRef } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ResetPasswordClient from '../ResetPasswordClient'

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  requestEmailCode: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
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
}))

vi.mock('@hcaptcha/react-hcaptcha', () => ({
  default: forwardRef(function MockHCaptcha() {
    return <div data-testid="hcaptcha" />
  }),
}))

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    requestEmailCode: mocks.requestEmailCode,
    verifyEmailCode: mocks.verifyEmailCode,
  }),
}))

vi.mock('../actions', () => ({
  sendPasswordResetEmail: mocks.sendPasswordResetEmail,
}))

beforeEach(() => {
  process.env.NEXT_PUBLIC_HCAPTCHA_SITEKEY = 'site-key'
  mocks.push.mockClear()
  mocks.requestEmailCode.mockReset().mockResolvedValue({ error: null })
  mocks.sendPasswordResetEmail.mockReset().mockResolvedValue({ error: null })
  mocks.verifyEmailCode.mockReset().mockResolvedValue({ error: null })
})

describe('ResetPasswordClient email-code fallback', () => {
  it('bypasses hCaptcha and redirects to set-password after code verification', async () => {
    const user = userEvent.setup()
    render(<ResetPasswordClient />)

    expect(screen.getByTestId('hcaptcha')).toBeInTheDocument()

    await user.click(
      screen.getByRole('button', {
        name: /verify via email code instead/i,
      }),
    )

    expect(screen.queryByTestId('hcaptcha')).not.toBeInTheDocument()

    await user.type(screen.getByLabelText(/email/i), 'buyer@example.com')
    await user.click(screen.getByRole('button', { name: /send code/i }))

    expect(mocks.requestEmailCode).toHaveBeenCalledWith('buyer@example.com')
    expect(await screen.findByLabelText(/6-digit code/i)).toBeInTheDocument()

    await user.type(screen.getByLabelText(/6-digit code/i), '123456')
    await user.click(screen.getByRole('button', { name: /verify & continue/i }))

    expect(mocks.verifyEmailCode).toHaveBeenCalledWith(
      'buyer@example.com',
      '123456',
    )
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith('/set-password'))
  })
})
