import { forwardRef } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import RequestAccessClient from '../RequestAccessClient'

const mocks = vi.hoisted(() => ({
  submitAccessRequest: vi.fn(),
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

vi.mock('@hcaptcha/react-hcaptcha', () => ({
  default: forwardRef(function MockHCaptcha() {
    return <div data-testid="hcaptcha" />
  }),
}))

vi.mock('../actions', () => ({
  submitAccessRequest: mocks.submitAccessRequest,
}))

beforeEach(() => {
  process.env.NEXT_PUBLIC_HCAPTCHA_SITEKEY = 'site-key'
  mocks.submitAccessRequest.mockReset().mockResolvedValue({ error: null })
})

describe('RequestAccessClient captcha-free fallback', () => {
  it('hides hCaptcha and submits the accessibility fallback flag', async () => {
    const user = userEvent.setup()
    render(<RequestAccessClient />)

    expect(screen.getByTestId('hcaptcha')).toBeInTheDocument()

    await user.click(
      screen.getByRole('button', {
        name: /send us your request via email/i,
      }),
    )

    expect(screen.queryByTestId('hcaptcha')).not.toBeInTheDocument()

    await user.type(screen.getByLabelText(/first name/i), 'Jamie')
    await user.type(screen.getByLabelText(/last name/i), 'Tester')
    await user.type(screen.getByLabelText(/email/i), 'jamie@example.com')
    await user.type(screen.getByLabelText(/company name/i), 'The Print Room')
    await user.click(screen.getByRole('button', { name: /submit request/i }))

    await waitFor(() => expect(mocks.submitAccessRequest).toHaveBeenCalledTimes(1))
    const formData = mocks.submitAccessRequest.mock.calls[0][0] as FormData
    expect(formData.get('accessibility_fallback')).toBe('true')
    expect(formData.has('captchaToken')).toBe(false)
  })
})
