'use client'

import { useState, useRef, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Image from 'next/image'
import HCaptcha from '@hcaptcha/react-hcaptcha'
import { useAuth } from '@/contexts/AuthContext'

export default function SignInPage() {
  return (
    <Suspense>
      <SignIn />
    </Suspense>
  )
}

type Mode = 'code' | 'password'
type CodeStage = 'request' | 'verify'

// Same-origin pathname only — block protocol-relative or absolute URLs to prevent open redirect.
function safeReturnTo(rt: string | null): string {
  if (!rt) return '/account'
  if (!rt.startsWith('/') || rt.startsWith('//')) return '/account'
  return rt
}

function SignIn() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { signIn, requestEmailCode, verifyEmailCode } = useAuth()

  const [mode, setMode] = useState<Mode>('code')
  const [codeStage, setCodeStage] = useState<CodeStage>('request')

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [captchaToken, setCaptchaToken] = useState<string | null>(null)
  const captchaRef = useRef<HCaptcha>(null)

  const returnTo = safeReturnTo(searchParams.get('returnTo'))
  const hcaptchaSitekey = process.env.NEXT_PUBLIC_HCAPTCHA_SITEKEY || null

  const urlError = searchParams.get('error')
  const urlErrorDescription = searchParams.get('error_description')

  const errorMessages: Record<string, string> = {
    access_denied: 'Your account could not be verified. Please contact support if this persists.',
    unauthorized: 'You do not have access to this portal. Please contact your account manager.',
  }

  const displayError =
    error || urlErrorDescription || (urlError && errorMessages[urlError]) || urlError || null

  useEffect(() => {
    if (error) {
      captchaRef.current?.resetCaptcha()
      setCaptchaToken(null)
    }
  }, [error])

  function switchMode(next: Mode) {
    setMode(next)
    setError(null)
    setInfo(null)
    setCodeStage('request')
    setCode('')
  }

  async function handlePasswordSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setIsSubmitting(true)
    const result = await signIn(email, password, captchaToken || undefined)
    if (result.error) {
      setError(result.error)
      setIsSubmitting(false)
      return
    }
    router.push(returnTo)
  }

  async function handleRequestCode(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setInfo(null)
    setIsSubmitting(true)
    const result = await requestEmailCode(email, captchaToken || undefined)
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
    router.push(returnTo)
  }

  return (
    <div className="min-h-screen flex">
      {/* Left Panel - Brand */}
      <LeftPanel />

      {/* Right Panel - Form */}
      <div className="flex-1 min-h-screen overflow-y-auto bg-gray-50">
        <div className="flex items-center justify-center p-6 lg:p-8 min-h-screen">
          <div className="w-full max-w-md py-8">
            {/* Mobile Logo */}
            <div className="lg:hidden mb-8 text-center">
              <Image
                src="/print-room-logo.png"
                alt="The Print Room"
                width={128}
                height={32}
                style={{ width: 'auto', height: 'auto' }}
                className="h-8 w-auto mx-auto"
              />
            </div>

            {/* Title */}
            <div className="mb-8 text-center">
              <h2 className="text-2xl font-semibold text-gray-900">Sign In</h2>
              <p className="text-sm text-gray-500 mt-2">
                {mode === 'code'
                  ? 'Get a one-time code emailed to you'
                  : 'Sign in with your email and password'}
              </p>
            </div>

            {/* Mode Tabs */}
            <div className="mb-6 flex gap-2 rounded-full bg-gray-100 p-1 text-sm">
              <button
                type="button"
                onClick={() => switchMode('code')}
                className={`flex-1 rounded-full px-4 py-2 font-medium transition ${
                  mode === 'code'
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                Email code
              </button>
              <button
                type="button"
                onClick={() => switchMode('password')}
                className={`flex-1 rounded-full px-4 py-2 font-medium transition ${
                  mode === 'password'
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                Password
              </button>
            </div>

            {/* Info / Error */}
            {info && !error && (
              <div className="mb-6 p-4 rounded-2xl bg-blue-50 border border-blue-200/50">
                <p className="text-sm text-blue-700">{info}</p>
              </div>
            )}
            {displayError && (
              <div
                role="alert"
                className="mb-6 p-4 rounded-2xl bg-red-50 border border-red-200/50 shadow-[0_2px_8px_-2px_rgba(239,68,68,0.1)]"
              >
                <p className="text-sm text-red-600">{displayError}</p>
              </div>
            )}

            {mode === 'password' ? (
              <form onSubmit={handlePasswordSubmit} suppressHydrationWarning>
                <div className="space-y-4" suppressHydrationWarning>
                  <div suppressHydrationWarning>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">
                      Email <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="email"
                      name="email"
                      placeholder="you@company.com"
                      autoComplete="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="input-glass"
                      suppressHydrationWarning
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">
                      Password <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="password"
                      name="password"
                      placeholder="••••••••"
                      autoComplete="current-password"
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="input-glass"
                    />
                  </div>
                </div>
                <div className="mt-3 text-right">
                  <a
                    href="/reset-password"
                    className="text-sm text-[rgb(var(--color-brand-blue))] hover:underline"
                  >
                    Forgot password?
                  </a>
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
                  className="mt-8 w-full py-3.5 px-6 rounded-full text-sm font-semibold uppercase tracking-wide text-white bg-[rgb(var(--color-brand-blue))] hover:bg-[rgb(var(--color-brand-blue))]/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-300 shadow-lg shadow-[rgb(var(--color-brand-blue))]/30 hover:shadow-xl hover:shadow-[rgb(var(--color-brand-blue))]/40 hover:-translate-y-0.5 active:translate-y-0 active:shadow-md"
                >
                  {isSubmitting ? 'Signing in...' : 'Sign In'}
                </button>
              </form>
            ) : codeStage === 'request' ? (
              <form onSubmit={handleRequestCode}>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    Email <span className="text-red-500">*</span>
                  </label>
                  <input
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
                  disabled={isSubmitting || !email}
                  className="mt-8 w-full py-3.5 px-6 rounded-full text-sm font-semibold uppercase tracking-wide text-white bg-[rgb(var(--color-brand-blue))] hover:bg-[rgb(var(--color-brand-blue))]/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-300 shadow-lg shadow-[rgb(var(--color-brand-blue))]/30 hover:shadow-xl hover:shadow-[rgb(var(--color-brand-blue))]/40 hover:-translate-y-0.5"
                >
                  {isSubmitting ? 'Sending code...' : 'Send code'}
                </button>
              </form>
            ) : (
              <form onSubmit={handleVerifyCode}>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    6-digit code <span className="text-red-500">*</span>
                  </label>
                  <input
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
                  className="mt-8 w-full py-3.5 px-6 rounded-full text-sm font-semibold uppercase tracking-wide text-white bg-[rgb(var(--color-brand-blue))] hover:bg-[rgb(var(--color-brand-blue))]/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-300 shadow-lg shadow-[rgb(var(--color-brand-blue))]/30 hover:shadow-xl hover:shadow-[rgb(var(--color-brand-blue))]/40 hover:-translate-y-0.5"
                >
                  {isSubmitting ? 'Verifying...' : 'Verify & sign in'}
                </button>
              </form>
            )}

            <p className="mt-6 text-center text-sm text-gray-600">
              Don&apos;t have an account?{' '}
              <a
                href="/request-access"
                className="text-[rgb(var(--color-brand-blue))] font-medium hover:underline"
              >
                Request access
              </a>
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

function LeftPanel() {
  return (
    <div className="hidden lg:flex lg:w-1/2 bg-pr-blue p-8 xl:p-12 flex-col justify-between h-screen sticky top-0 overflow-hidden">
      <div className="flex-shrink-0">
        <Image
          src="/print-room-logo.png"
          alt="The Print Room"
          width={192}
          height={48}
          style={{ width: 'auto', height: 'auto' }}
          className="h-10 xl:h-12 w-auto brightness-0 invert"
        />
      </div>

      <div className="space-y-4 xl:space-y-6 flex-1 flex flex-col justify-center py-6">
        <h1 className="text-3xl xl:text-4xl font-bold text-white leading-tight">
          Welcome Back
        </h1>
        <p className="text-white/80 text-base xl:text-lg max-w-md">
          Sign in to access your B2B dashboard, manage projects, and explore your
          custom product catalog.
        </p>

        <ul className="space-y-2 xl:space-y-3 mt-4 xl:mt-6">
          {[
            'Access your custom designs',
            'View project history & tracking',
            'Browse your exclusive catalog',
            'Manage team members',
            'Download reports & invoices',
          ].map((feature) => (
            <li
              key={feature}
              className="flex items-center gap-2 xl:gap-3 text-white/90 text-sm xl:text-base"
            >
              <svg
                className="w-4 h-4 xl:w-5 xl:h-5 text-white/60 flex-shrink-0"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M5 13l4 4L19 7"
                />
              </svg>
              {feature}
            </li>
          ))}
        </ul>
      </div>

      <div className="text-white/50 text-xs xl:text-sm flex-shrink-0">
        &copy; {new Date().getFullYear()} The Print Room. All rights reserved.
      </div>
    </div>
  )
}
