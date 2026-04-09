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

function SignIn() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { signIn } = useAuth()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [captchaToken, setCaptchaToken] = useState<string | null>(null)
  const captchaRef = useRef<HCaptcha>(null)

  const returnTo = searchParams.get('returnTo') || '/account'
  const hcaptchaSitekey = process.env.NEXT_PUBLIC_HCAPTCHA_SITEKEY || null

  // Check for error in URL params (from callback)
  const urlError = searchParams.get('error')
  const urlErrorDescription = searchParams.get('error_description')

  const errorMessages: Record<string, string> = {
    access_denied: 'Your account could not be verified. Please contact support if this persists.',
    unauthorized: 'You do not have access to this portal. Please contact your account manager.',
  }

  const displayError =
    error || urlErrorDescription || (urlError && errorMessages[urlError]) || urlError || null

  // Reset captcha on error
  useEffect(() => {
    if (error) {
      captchaRef.current?.resetCaptcha()
      setCaptchaToken(null)
    }
  }, [error])

  async function handleSubmit(e: React.FormEvent) {
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
                className="h-8 w-auto mx-auto"
              />
              <p className="text-gray-600 mt-2 text-sm">B2B Portal Sign In</p>
            </div>

            {/* Title */}
            <div className="mb-8 text-center">
              <h2 className="text-2xl font-semibold text-gray-900">Sign In</h2>
              <p className="text-sm text-gray-500 mt-2">
                Sign in with your email and password
              </p>
            </div>

            {/* Error Message */}
            {displayError && (
              <div className="mb-6 p-4 rounded-2xl bg-red-50 border border-red-200/50 shadow-[0_2px_8px_-2px_rgba(239,68,68,0.1)]">
                <p className="text-sm text-red-600">{displayError}</p>
              </div>
            )}

            {/* Form */}
            <form onSubmit={handleSubmit}>
              <div className="space-y-4">
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

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    Password <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="password"
                    name="password"
                    placeholder="Enter your password"
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="input-glass"
                  />
                </div>
              </div>

              {/* Forgot Password Link */}
              <div className="mt-4 text-right">
                <a
                  href="/reset-password"
                  className="text-sm text-[rgb(var(--color-primary))] hover:underline"
                >
                  Forgot password or first time signing in?
                </a>
              </div>

              {/* hCaptcha */}
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

              {/* Submit Button */}
              <button
                type="submit"
                disabled={isSubmitting}
                className="mt-8 w-full py-3.5 px-6 rounded-full text-sm font-semibold uppercase tracking-wide text-white bg-[rgb(var(--color-primary))] hover:bg-[rgb(var(--color-primary-dark))] disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-300 shadow-lg shadow-[rgb(var(--color-primary))]/30 hover:shadow-xl hover:shadow-[rgb(var(--color-primary))]/40 hover:-translate-y-0.5 active:translate-y-0 active:shadow-md"
              >
                {isSubmitting ? 'Signing in...' : 'Sign In'}
              </button>

              {/* Request Access Link */}
              <p className="mt-6 text-center text-sm text-gray-600">
                Don&apos;t have an account?{' '}
                <a
                  href="/request-access"
                  className="text-[rgb(var(--color-primary))] font-medium hover:underline"
                >
                  Request access
                </a>
              </p>
            </form>
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
          className="h-10 xl:h-12 w-auto brightness-0 invert"
        />
      </div>

      <div className="space-y-4 xl:space-y-6 flex-1 flex flex-col justify-center py-6">
        <h1 className="text-3xl xl:text-4xl font-bold text-white leading-tight">
          Welcome Back
        </h1>
        <p className="text-white/80 text-base xl:text-lg max-w-md">
          Sign in to access your B2B dashboard, manage orders, and explore your
          custom product catalog.
        </p>

        <ul className="space-y-2 xl:space-y-3 mt-4 xl:mt-6">
          {[
            'Access your custom designs',
            'View order history & tracking',
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
