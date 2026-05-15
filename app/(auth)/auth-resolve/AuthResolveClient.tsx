'use client'

import { useEffect, useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { getSupabaseBrowser } from '@/lib/supabase-browser'

export default function AuthResolvePage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
          <p className="text-gray-600">Finalising sign-in...</p>
        </div>
      }
    >
      <AuthResolve />
    </Suspense>
  )
}

function AuthResolve() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const supabase = getSupabaseBrowser()

  const [status, setStatus] = useState<'working' | 'error'>('working')
  const [error, setError] = useState<string | null>(null)

  const next = searchParams.get('next') ?? '/account'

  useEffect(() => {
    if (typeof window === 'undefined') return

    const hash = window.location.hash
    if (!hash || hash.length < 2) {
      router.replace(`/sign-in?error=no_code&error_description=${encodeURIComponent('Sign-in link is missing its token. Request a fresh one.')}`)
      return
    }

    const hashParams = new URLSearchParams(hash.substring(1))
    const accessToken = hashParams.get('access_token')
    const refreshToken = hashParams.get('refresh_token')
    const type = hashParams.get('type')
    const errorCode = hashParams.get('error') ?? hashParams.get('error_code')
    const errorDescription = hashParams.get('error_description')

    if (errorCode) {
      router.replace(
        `/sign-in?error=${encodeURIComponent(errorCode)}&error_description=${encodeURIComponent(errorDescription ?? 'Sign-in failed.')}`,
      )
      return
    }

    if (!accessToken || !refreshToken) {
      router.replace(`/sign-in?error=no_code&error_description=${encodeURIComponent('Sign-in link is missing its token. Request a fresh one.')}`)
      return
    }

    supabase.auth
      .setSession({ access_token: accessToken, refresh_token: refreshToken })
      .then(({ error: setErr }) => {
        if (setErr) {
          setStatus('error')
          setError(setErr.message)
          return
        }
        // Strip the fragment so a refresh doesn't reuse it
        window.history.replaceState(null, '', window.location.pathname + window.location.search)
        if (type === 'invite' || type === 'recovery') {
          router.replace('/set-password?invite=1')
          return
        }
        router.replace(next)
      })
  }, [router, supabase, next])

  if (status === 'error') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
        <div className="w-full max-w-md text-center">
          <p className="text-red-600 mb-4">{error ?? 'Could not finalise sign-in.'}</p>
          <a href="/sign-in" className="text-[rgb(var(--color-brand-blue))] hover:underline">
            Back to sign-in
          </a>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
      <p className="text-gray-600">Finalising sign-in...</p>
    </div>
  )
}
