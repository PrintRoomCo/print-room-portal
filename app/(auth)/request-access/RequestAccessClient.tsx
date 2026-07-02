'use client'

import { useState, useRef, useEffect } from 'react'
import Link from 'next/link'
import HCaptcha from '@hcaptcha/react-hcaptcha'
import { submitAccessRequest } from './actions'
import AuthScene from '@/components/auth/AuthScene'

const INDUSTRY_OPTIONS = [
  'Corporate / Professional Services',
  'Hospitality / Food & Beverage',
  'Healthcare / Medical',
  'Education',
  'Trades / Construction',
  'Retail',
  'Sports / Recreation',
  'Government / Public Sector',
  'Not-for-profit',
  'Events / Promotions',
  'Other',
]

const VOLUME_OPTIONS = [
  'Under 50 units',
  '50-200 units',
  '200-500 units',
  '500-1,000 units',
  '1,000+ units',
]

const REFERRAL_OPTIONS = [
  'Google Search',
  'Social Media',
  'Referral from a friend or colleague',
  'Industry event / trade show',
  'Print Room website',
  'Other',
]

export default function RequestAccess() {
  const [customerType, setCustomerType] = useState<'company' | 'creative'>('company')
  const [useCaptchaFreeFallback, setUseCaptchaFreeFallback] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [captchaToken, setCaptchaToken] = useState<string | null>(null)
  const captchaRef = useRef<HCaptcha>(null)

  const hcaptchaSitekey = process.env.NEXT_PUBLIC_HCAPTCHA_SITEKEY || null

  useEffect(() => {
    if (error) {
      captchaRef.current?.resetCaptcha()
      setCaptchaToken(null)
    }
  }, [error])

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setIsSubmitting(true)

    const formData = new FormData(e.currentTarget)
    formData.set('customerType', customerType)
    if (useCaptchaFreeFallback) {
      formData.set('accessibility_fallback', 'true')
    } else if (captchaToken) {
      formData.set('captchaToken', captchaToken)
    }

    const result = await submitAccessRequest(formData)

    if (result.error) {
      setError(result.error)
      setIsSubmitting(false)
      return
    }

    setSuccess(true)
    setIsSubmitting(false)
  }

  if (success) {
    return (
      <AuthScene heading="Join Us">
        <div className="w-full max-w-md text-center">
          <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-[rgb(var(--color-primary))] flex items-center justify-center shadow-lg shadow-[rgb(var(--color-primary))]/30">
            <svg className="w-10 h-10 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          {/* AuthScene renders the page's single <h1> ("Join Us") — keep this an <h2>. */}
          <h2 className="text-2xl font-bold text-gray-900 mb-4">Request Submitted!</h2>
          <p className="text-gray-600 mb-8">
            Thank you for your interest. Our team will review your application and get back to you within 1-2 business days.
          </p>
          <Link href="/sign-in" className="auth-btn">
            Back to sign in
          </Link>
        </div>
      </AuthScene>
    )
  }

  return (
    <AuthScene heading="Join Us">
      <div className="w-full max-w-lg">
        <div className="mb-8">
          <h2 className="text-2xl font-semibold text-gray-900">Request B2B Access</h2>
          <p className="text-sm text-gray-500 mt-2">
            Fill in your details below and our team will set up your account.
          </p>
        </div>

        {error && (
          <div role="alert" className="mb-6 p-4 rounded-2xl bg-red-50 border border-red-200/50">
            <p className="text-sm text-red-600">{error}</p>
          </div>
        )}

        {/* Customer Type Toggle */}
        <div className="mb-6 inline-flex w-full rounded-full border border-[hsl(var(--border))] p-1 text-sm">
          <button
            type="button"
            onClick={() => setCustomerType('company')}
            className={`flex-1 rounded-full px-4 py-2 font-medium transition ${customerType === 'company' ? 'bg-[rgb(var(--color-primary))] text-white' : 'text-gray-500 hover:text-gray-800'}`}
          >
            Company
          </button>
          <button
            type="button"
            onClick={() => setCustomerType('creative')}
            className={`flex-1 rounded-full px-4 py-2 font-medium transition ${customerType === 'creative' ? 'bg-[rgb(var(--color-primary))] text-white' : 'text-gray-500 hover:text-gray-800'}`}
          >
            Individual / Creative
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="request-first-name" className="block text-sm font-medium text-gray-700 mb-1">First Name *</label>
              <input id="request-first-name" type="text" name="firstName" required autoComplete="given-name" className="auth-field" />
            </div>
            <div>
              <label htmlFor="request-last-name" className="block text-sm font-medium text-gray-700 mb-1">Last Name *</label>
              <input id="request-last-name" type="text" name="lastName" required autoComplete="family-name" className="auth-field" />
            </div>
          </div>

          <div>
            <label htmlFor="request-email" className="block text-sm font-medium text-gray-700 mb-1">Email *</label>
            <input id="request-email" type="email" name="email" required autoComplete="email" placeholder="you@company.com" className="auth-field" />
          </div>

          <div>
            <label htmlFor="request-phone" className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
            <input id="request-phone" type="tel" name="phone" autoComplete="tel" placeholder="+64 21 123 4567" className="auth-field" />
          </div>

          {customerType === 'company' && (
            <div>
              <label htmlFor="request-company-name" className="block text-sm font-medium text-gray-700 mb-1">Company Name *</label>
              <input id="request-company-name" type="text" name="companyName" required autoComplete="organization" className="auth-field" />
            </div>
          )}

          <div>
            <label htmlFor="request-industry" className="block text-sm font-medium text-gray-700 mb-1">Industry</label>
            <select id="request-industry" name="industry" className="auth-field">
              <option value="">Select your industry...</option>
              {INDUSTRY_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="request-estimated-volume" className="block text-sm font-medium text-gray-700 mb-1">Estimated Volume</label>
            <select id="request-estimated-volume" name="estimatedVolume" className="auth-field">
              <option value="">Select estimated volume...</option>
              {VOLUME_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="request-referral-source" className="block text-sm font-medium text-gray-700 mb-1">How did you hear about us?</label>
            <select id="request-referral-source" name="referralSource" className="auth-field">
              <option value="">Select...</option>
              {REFERRAL_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="request-message" className="block text-sm font-medium text-gray-700 mb-1">Message</label>
            <textarea id="request-message" name="message" rows={3} placeholder="Tell us about your needs..." className="auth-field" />
          </div>

          {hcaptchaSitekey && !useCaptchaFreeFallback && (
            <div className="flex justify-center">
              <HCaptcha
                ref={captchaRef}
                sitekey={hcaptchaSitekey}
                onVerify={(token) => setCaptchaToken(token)}
                onExpire={() => setCaptchaToken(null)}
              />
            </div>
          )}

          {!useCaptchaFreeFallback && (
            <button
              type="button"
              onClick={() => {
                setUseCaptchaFreeFallback(true)
                setCaptchaToken(null)
                setError(null)
                captchaRef.current?.resetCaptcha()
              }}
              className="w-full text-center text-sm font-medium text-pr-charcoal underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pr-charcoal"
            >
              Trouble with the captcha? Send us your request via email
            </button>
          )}

          <button type="submit" disabled={isSubmitting} className="auth-btn">
            {isSubmitting ? 'Submitting...' : 'Submit request'}
          </button>

          <p className="text-center text-sm text-gray-600">
            Already have an account?{' '}
            <Link href="/sign-in" className="font-medium text-pr-charcoal underline-offset-4 hover:underline">
              Sign in
            </Link>
          </p>
        </form>
      </div>
    </AuthScene>
  )
}
