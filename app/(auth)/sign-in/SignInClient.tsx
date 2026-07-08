'use client'

import { useState, useRef, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import HCaptcha from '@hcaptcha/react-hcaptcha'
import { useAuth } from '@/contexts/AuthContext'
import AuthScene from '@/components/auth/AuthScene'

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
    demo_unavailable: 'The demo is temporarily unavailable. Please try again shortly.',
    demo_failed: 'Could not start the demo session. Please try again.',
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
    <AuthScene heading="Welcome Back" headingHidden>
      <div className="w-full max-w-md">
        {/* Mode Tabs */}
        <div className="sign-in-mode-switch" data-mode={mode}>
          <span className="sign-in-mode-indicator" aria-hidden="true" />
          {(['code', 'password'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => switchMode(m)}
              className="sign-in-mode-option"
              aria-pressed={mode === m}
            >
              {m === 'code' ? 'Email code' : 'Password'}
            </button>
          ))}
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
                <label
                  htmlFor="signin-email"
                  className="block text-sm font-semibold text-black mb-1.5"
                >
                  Email <span className="text-red-500">*</span>
                </label>
                <input
                  id="signin-email"
                  type="email"
                  name="email"
                  placeholder="you@company.com"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="auth-field sign-in-pill-field"
                  suppressHydrationWarning
                />
              </div>
              <div>
                <label
                  htmlFor="signin-password"
                  className="block text-sm font-semibold text-black mb-1.5"
                >
                  Password <span className="text-red-500">*</span>
                </label>
                <input
                  id="signin-password"
                  type="password"
                  name="password"
                  placeholder="••••••••"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="auth-field sign-in-pill-field"
                />
              </div>
            </div>
            <div className="mt-3 text-right">
              <a
                href="/reset-password"
                className="text-sm font-semibold text-black underline-offset-4 hover:underline"
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
            <button type="submit" disabled={isSubmitting} className="sign-in-submit mt-8">
              {isSubmitting ? 'Signing in...' : 'Sign in'}
            </button>
          </form>
        ) : codeStage === 'request' ? (
          <form onSubmit={handleRequestCode}>
            <div>
              <label
                htmlFor="signin-code-email"
                className="block text-sm font-semibold text-black mb-1.5"
              >
                Email <span className="text-red-500">*</span>
              </label>
              <input
                id="signin-code-email"
                type="email"
                name="email"
                placeholder="you@company.com"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="auth-field sign-in-pill-field"
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
            <button type="submit" disabled={isSubmitting || !email} className="sign-in-submit mt-8">
              {isSubmitting ? 'Sending code...' : 'Send code'}
            </button>
          </form>
        ) : (
          <form onSubmit={handleVerifyCode}>
            <div>
              <label
                htmlFor="signin-code"
                className="block text-sm font-medium text-gray-700 mb-1.5"
              >
                6-digit code <span className="text-red-500">*</span>
              </label>
              <input
                id="signin-code"
                type="text"
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={6}
                autoComplete="one-time-code"
                placeholder="123456"
                required
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                className="auth-field tracking-widest text-center text-lg"
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
                  className="font-medium text-pr-charcoal underline-offset-4 hover:underline"
                >
                  Use a different email
                </button>
              </p>
            </div>
            <button
              type="submit"
              disabled={isSubmitting || code.length !== 6}
              className="sign-in-submit mt-8"
            >
              {isSubmitting ? 'Verifying...' : 'Verify & sign in'}
            </button>
          </form>
        )}

        <a
          href="/api/demo/enter"
          className="sign-in-submit mt-4"
          style={{ textAlign: 'center', display: 'block' }}
        >
          Explore the demo
        </a>
      </div>
    </AuthScene>
  )
}
