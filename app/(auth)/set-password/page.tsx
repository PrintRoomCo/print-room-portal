'use client'

import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Image from 'next/image'
import { getSupabaseBrowser } from '@/lib/supabase-browser'

export default function SetPasswordPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
        <div className="w-full max-w-md text-center">
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    }>
      <SetPassword />
    </Suspense>
  )
}

function SetPassword() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const supabase = getSupabaseBrowser()

  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [sessionChecked, setSessionChecked] = useState(false)

  // Check for error in URL
  useEffect(() => {
    const errorParam = searchParams.get('error')
    const errorDescription = searchParams.get('error_description')
    if (errorParam) {
      setError(errorDescription || errorParam)
    }
  }, [searchParams])

  // Handle recovery tokens from URL hash fragment
  useEffect(() => {
    if (typeof window === 'undefined') return

    const hash = window.location.hash
    if (!hash) {
      // No hash — check for existing session
      supabase.auth.getSession().then(({ data }) => {
        if (!data.session) {
          setError('Your password reset link has expired or is invalid. Please request a new one.')
        }
        setSessionChecked(true)
      })
      return
    }

    const hashParams = new URLSearchParams(hash.substring(1))
    const accessToken = hashParams.get('access_token')
    const refreshToken = hashParams.get('refresh_token')
    const type = hashParams.get('type')

    if (type === 'recovery' && accessToken && refreshToken) {
      supabase.auth
        .setSession({ access_token: accessToken, refresh_token: refreshToken })
        .then(({ error: err }) => {
          if (err) {
            setError('Failed to verify your reset link. Please try again.')
          } else {
            window.history.replaceState(null, '', window.location.pathname)
          }
          setSessionChecked(true)
        })
    } else {
      setSessionChecked(true)
    }
  }, [supabase])

  const validatePassword = (pwd: string): string | null => {
    if (pwd.length < 8) return 'Password must be at least 8 characters long'
    if (!/[A-Z]/.test(pwd)) return 'Password must contain at least one uppercase letter'
    if (!/[a-z]/.test(pwd)) return 'Password must contain at least one lowercase letter'
    if (!/[0-9]/.test(pwd)) return 'Password must contain at least one number'
    return null
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (password !== confirmPassword) {
      setError('Passwords do not match')
      return
    }

    const validationError = validatePassword(password)
    if (validationError) {
      setError(validationError)
      return
    }

    setIsLoading(true)

    const { error: updateError } = await supabase.auth.updateUser({ password })

    if (updateError) {
      setError(updateError.message)
      setIsLoading(false)
      return
    }

    setSuccess(true)
    setTimeout(() => router.push('/account'), 2000)
  }

  // Loading state
  if (!sessionChecked) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
        <div className="w-full max-w-md text-center">
          <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-[rgb(var(--color-primary))] flex items-center justify-center animate-pulse">
            <svg className="w-8 h-8 text-white animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
          </div>
          <p className="text-gray-600">Verifying your reset link...</p>
        </div>
      </div>
    )
  }

  // Success state
  if (success) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
        <div className="w-full max-w-md text-center">
          <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-[rgb(var(--color-primary))] flex items-center justify-center shadow-lg shadow-[rgb(var(--color-primary))]/30">
            <svg className="w-10 h-10 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mb-4">Password Updated!</h1>
          <p className="text-gray-600 mb-8">
            Your password has been successfully updated. Redirecting you to your account...
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <Image src="/print-room-logo.png" alt="The Print Room" width={160} height={40} className="h-10 w-auto mx-auto" />
          <h1 className="text-2xl font-bold text-gray-900 mt-6 mb-2">Set Your Password</h1>
          <p className="text-gray-600">Create a secure password for your B2B account.</p>
        </div>

        {error && (
          <div className="mb-6 p-4 rounded-2xl bg-red-50 border border-red-200/50 shadow-[0_2px_8px_-2px_rgba(239,68,68,0.1)]">
            <p className="text-sm text-red-600">{error}</p>
          </div>
        )}

        {/* Password Requirements */}
        <div className="mb-6 p-4 rounded-2xl bg-white border border-gray-200">
          <p className="text-xs font-semibold text-gray-700 mb-2">Password Requirements:</p>
          <ul className="text-xs text-gray-600 space-y-1">
            {[
              { test: password.length >= 8, label: 'At least 8 characters' },
              { test: /[A-Z]/.test(password), label: 'One uppercase letter' },
              { test: /[a-z]/.test(password), label: 'One lowercase letter' },
              { test: /[0-9]/.test(password), label: 'One number' },
            ].map((req) => (
              <li key={req.label} className="flex items-center gap-2">
                <span className={`w-1.5 h-1.5 rounded-full ${req.test ? 'bg-[rgb(var(--color-brand-blue))]' : 'bg-gray-300'}`} />
                {req.label}
              </li>
            ))}
          </ul>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                New Password <span className="text-red-500">*</span>
              </label>
              <input
                type="password"
                placeholder="Enter your new password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="input-glass"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Confirm Password <span className="text-red-500">*</span>
              </label>
              <input
                type="password"
                placeholder="Confirm your new password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                className="input-glass"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="mt-6 w-full py-3.5 px-6 rounded-full text-sm font-semibold uppercase tracking-wide text-white bg-[rgb(var(--color-primary))] hover:bg-[rgb(var(--color-primary-dark))] disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-300 shadow-lg shadow-[rgb(var(--color-primary))]/30 hover:shadow-xl hover:shadow-[rgb(var(--color-primary))]/40 hover:-translate-y-0.5 active:translate-y-0 active:shadow-md"
          >
            {isLoading ? 'Setting Password...' : 'Set Password'}
          </button>
        </form>
      </div>
    </div>
  )
}
