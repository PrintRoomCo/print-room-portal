'use client'

import { useState, useRef, useEffect } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import HCaptcha from '@hcaptcha/react-hcaptcha'
import { sendPasswordResetEmail } from './actions'
import { useAuth } from '@/contexts/AuthContext'

type CodeStage = 'request' | 'verify'

export default function ResetPassword() {
  const router = useRouter()
  const { requestEmailCode, verifyEmailCode } = useAuth()
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [codeStage, setCodeStage] = useState<CodeStage>('request')
  const [useEmailCode, setUseEmailCode] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [successEmail, setSuccessEmail] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [captchaToken, setCaptchaToken] = useState<string | null>(null)
  const captchaRef = useRef<HCaptcha>(null)

  const hcaptchaSitekey = process.env.NEXT_PUBLIC_HCAPTCHA_SITEKEY || null

  useEffect(() => {
    if (error) {
      captchaRef.current?.resetCaptcha()
      setCaptchaToken(null)
    }
  }, [error])

  function switchToEmailCode() {
    setUseEmailCode(true)
    setError(null)
    setInfo(null)
    setCode('')
    setCodeStage('request')
    setCaptchaToken(null)
    captchaRef.current?.resetCaptcha()
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setInfo(null)
    setIsSubmitting(true)

    const result = await sendPasswordResetEmail(email, captchaToken || undefined)

    if (result.error) {
      setError(result.error)
      setIsSubmitting(false)
      return
    }

    setSuccessEmail(email)
    setSuccess(true)
    setIsSubmitting(false)
  }

  async function handleRequestCode(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setInfo(null)
    setIsSubmitting(true)

    const result = await requestEmailCode(email)
    setIsSubmitting(false)

    if (result.error) {
      setError(result.error)
      return
    }

    setCodeStage('verify')
    setInfo(`We emailed a 6-digit code to ${email}. It expires in 10 minutes.`)
  }

  async function handleVerifyCode(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setIsSubmitting(true)

    const result = await verifyEmailCode(email, code.trim())

    if (result.error) {
      setError(result.error)
      setIsSubmitting(false)
      return
    }

    router.push('/set-password')
  }

  if (success) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center p-6">
        <div className="w-full max-w-md text-center">
          <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-[rgb(var(--color-primary))] flex items-center justify-center shadow-lg shadow-[rgb(var(--color-primary))]/30">
            <svg className="w-10 h-10 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mb-4">Check Your Email</h1>
          <p className="text-gray-600 mb-4">
            We&apos;ve sent a password reset link to{' '}
            <span className="font-medium text-gray-900">{successEmail}</span>
          </p>
          <p className="text-sm text-gray-500 mb-8">
            Click the link in the email to reset your password. The link will expire in 1 hour.
          </p>
          <Link
            href="/sign-in"
            className="inline-flex items-center justify-center py-3 px-6 rounded-full text-sm font-semibold text-white bg-[rgb(var(--color-primary))] hover:bg-[rgb(var(--color-primary-dark))] transition-all duration-300 shadow-lg shadow-[rgb(var(--color-primary))]/30"
          >
            Back to Sign In
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-white flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <Image src="/print-room-logo.png" alt="The Print Room" width={160} height={40} style={{ width: 'auto', height: 'auto' }} className="h-10 w-auto mx-auto" />
          <h1 className="text-2xl font-bold text-gray-900 mt-6 mb-2">Reset Your Password</h1>
          <p className="text-gray-600">
            Enter your email address and we&apos;ll send you a link to reset your password.
          </p>
        </div>

        {error && (
          <div
            role="alert"
            className="mb-6 p-4 rounded-2xl bg-red-50 border border-red-200/50 shadow-[0_2px_8px_-2px_rgba(239,68,68,0.1)]"
          >
            <p className="text-sm text-red-600">{error}</p>
          </div>
        )}

        {info && !error && (
          <div className="mb-6 p-4 rounded-2xl bg-blue-50 border border-blue-200/50">
            <p className="text-sm text-blue-700">{info}</p>
          </div>
        )}

        {!useEmailCode ? (
          <form onSubmit={handleSubmit}>
            <div>
              <label htmlFor="reset-email" className="block text-sm font-medium text-gray-700 mb-1.5">
                Email <span className="text-red-500">*</span>
              </label>
              <input
                id="reset-email"
                type="email"
                name="email"
                placeholder="you@company.com"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="input-glass"
              />
            </div>

            {hcaptchaSitekey && (
              <div className="mt-6 flex justify-center">
                <HCaptcha
                  ref={captchaRef}
                  sitekey={hcaptchaSitekey}
                  onVerify={(token) => setCaptchaToken(token)}
                  onExpire={() => setCaptchaToken(null)}
                />
              </div>
            )}

            <button
              type="submit"
              disabled={isSubmitting}
              className="mt-6 w-full py-3.5 px-6 rounded-full text-sm font-semibold tracking-wide text-white bg-[rgb(var(--color-primary))] hover:bg-[rgb(var(--color-primary-dark))] disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-300 shadow-lg shadow-[rgb(var(--color-primary))]/30 hover:shadow-xl hover:shadow-[rgb(var(--color-primary))]/40 hover:-translate-y-0.5 active:translate-y-0 active:shadow-md"
            >
              {isSubmitting ? 'Sending...' : 'Send Reset Link'}
            </button>

            <button
              type="button"
              onClick={switchToEmailCode}
              className="mt-4 w-full text-center text-sm font-medium text-[rgb(var(--color-brand-blue))] underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pr-blue"
            >
              Can&apos;t solve the captcha? Verify via email code instead
            </button>

            <p className="mt-6 text-center text-sm text-gray-600">
              Remember your password?{' '}
              <Link href="/sign-in" className="text-[rgb(var(--color-primary))] font-medium hover:underline">
                Sign in
              </Link>
            </p>
          </form>
        ) : codeStage === 'request' ? (
          <form onSubmit={handleRequestCode}>
            <div>
              <label htmlFor="reset-code-email" className="block text-sm font-medium text-gray-700 mb-1.5">
                Email <span className="text-red-500">*</span>
              </label>
              <input
                id="reset-code-email"
                type="email"
                name="email"
                placeholder="you@company.com"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="input-glass"
              />
            </div>

            <button
              type="submit"
              disabled={isSubmitting || !email}
              className="mt-6 w-full py-3.5 px-6 rounded-full text-sm font-semibold tracking-wide text-white bg-[rgb(var(--color-primary))] hover:bg-[rgb(var(--color-primary-dark))] disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-300 shadow-lg shadow-[rgb(var(--color-primary))]/30 hover:shadow-xl hover:shadow-[rgb(var(--color-primary))]/40 hover:-translate-y-0.5 active:translate-y-0 active:shadow-md"
            >
              {isSubmitting ? 'Sending code...' : 'Send code'}
            </button>

            <p className="mt-6 text-center text-sm text-gray-600">
              Remember your password?{' '}
              <Link href="/sign-in" className="text-[rgb(var(--color-primary))] font-medium hover:underline">
                Sign in
              </Link>
            </p>
          </form>
        ) : (
          <form onSubmit={handleVerifyCode}>
            <div>
              <label htmlFor="reset-code" className="block text-sm font-medium text-gray-700 mb-1.5">
                6-digit code <span className="text-red-500">*</span>
              </label>
              <input
                id="reset-code"
                type="text"
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={6}
                autoComplete="one-time-code"
                placeholder="123456"
                required
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                className="input-glass tracking-widest text-center text-lg"
                autoFocus
              />
              <p className="mt-2 text-xs text-gray-500">
                Sent to <span className="font-medium">{email}</span>.{' '}
                <button
                  type="button"
                  onClick={() => {
                    setCodeStage('request')
                    setCode('')
                    setInfo(null)
                  }}
                  className="text-[rgb(var(--color-brand-blue))] hover:underline"
                >
                  Use a different email
                </button>
              </p>
            </div>

            <button
              type="submit"
              disabled={isSubmitting || code.length !== 6}
              className="mt-6 w-full py-3.5 px-6 rounded-full text-sm font-semibold tracking-wide text-white bg-[rgb(var(--color-primary))] hover:bg-[rgb(var(--color-primary-dark))] disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-300 shadow-lg shadow-[rgb(var(--color-primary))]/30 hover:shadow-xl hover:shadow-[rgb(var(--color-primary))]/40 hover:-translate-y-0.5 active:translate-y-0 active:shadow-md"
            >
              {isSubmitting ? 'Verifying...' : 'Verify & continue'}
            </button>

            <p className="mt-6 text-center text-sm text-gray-600">
              Remember your password?{' '}
              <Link href="/sign-in" className="text-[rgb(var(--color-primary))] font-medium hover:underline">
                Sign in
              </Link>
            </p>
          </form>
        )}
      </div>
    </div>
  )
}
