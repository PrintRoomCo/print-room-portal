'use client'

import { useState, useRef, useEffect } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import HCaptcha from '@hcaptcha/react-hcaptcha'
import { submitAccessRequest } from './actions'

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
    if (captchaToken) formData.set('captchaToken', captchaToken)

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
      <div className="min-h-screen flex">
        <LeftPanel />
        <div className="flex-1 min-h-screen overflow-y-auto bg-gray-50">
          <div className="flex items-center justify-center p-6 lg:p-8 min-h-screen">
            <div className="w-full max-w-md text-center">
              <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-[rgb(var(--color-primary))] flex items-center justify-center shadow-lg shadow-[rgb(var(--color-primary))]/30">
                <svg className="w-10 h-10 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h1 className="text-2xl font-bold text-gray-900 mb-4">Request Submitted!</h1>
              <p className="text-gray-600 mb-8">
                Thank you for your interest. Our team will review your application and get back to you within 1-2 business days.
              </p>
              <Link
                href="/sign-in"
                className="inline-flex items-center justify-center py-3 px-6 rounded-full text-sm font-semibold text-white bg-[rgb(var(--color-primary))] hover:bg-[rgb(var(--color-primary-dark))] transition-all duration-300 shadow-lg shadow-[rgb(var(--color-primary))]/30"
              >
                Back to Sign In
              </Link>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex">
      <LeftPanel />
      <div className="flex-1 min-h-screen overflow-y-auto bg-gray-50">
        <div className="flex items-center justify-center p-6 lg:p-8">
          <div className="w-full max-w-lg py-8">
            <div className="lg:hidden mb-8 text-center">
              <Image src="/print-room-logo.png" alt="The Print Room" width={128} height={32} className="h-8 w-auto mx-auto" />
            </div>

            <div className="mb-8">
              <h2 className="text-2xl font-semibold text-gray-900">Request B2B Access</h2>
              <p className="text-sm text-gray-500 mt-2">
                Fill in your details below and our team will set up your account.
              </p>
            </div>

            {error && (
              <div className="mb-6 p-4 rounded-2xl bg-red-50 border border-red-200/50">
                <p className="text-sm text-red-600">{error}</p>
              </div>
            )}

            {/* Customer Type Toggle */}
            <div className="mb-6 flex gap-2">
              <button
                type="button"
                onClick={() => setCustomerType('company')}
                className={`flex-1 py-2.5 px-4 rounded-full text-sm font-medium transition-all duration-300 ${customerType === 'company' ? 'bg-[rgb(var(--color-primary))] text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
              >
                Company
              </button>
              <button
                type="button"
                onClick={() => setCustomerType('creative')}
                className={`flex-1 py-2.5 px-4 rounded-full text-sm font-medium transition-all duration-300 ${customerType === 'creative' ? 'bg-[rgb(var(--color-primary))] text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
              >
                Individual / Creative
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">First Name *</label>
                  <input type="text" name="firstName" required className="input-glass" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Last Name *</label>
                  <input type="text" name="lastName" required className="input-glass" />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Email *</label>
                <input type="email" name="email" required placeholder="you@company.com" className="input-glass" />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
                <input type="tel" name="phone" placeholder="+64 21 123 4567" className="input-glass" />
              </div>

              {customerType === 'company' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Company Name *</label>
                  <input type="text" name="companyName" required className="input-glass" />
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Industry</label>
                <select name="industry" className="input-glass appearance-none cursor-pointer">
                  <option value="">Select your industry...</option>
                  {INDUSTRY_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Estimated Volume</label>
                <select name="estimatedVolume" className="input-glass appearance-none cursor-pointer">
                  <option value="">Select estimated volume...</option>
                  {VOLUME_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">How did you hear about us?</label>
                <select name="referralSource" className="input-glass appearance-none cursor-pointer">
                  <option value="">Select...</option>
                  {REFERRAL_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Message</label>
                <textarea name="message" rows={3} placeholder="Tell us about your needs..." className="textarea-glass" />
              </div>

              {hcaptchaSitekey && (
                <div className="flex justify-center">
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
                className="w-full py-3.5 px-6 rounded-full text-sm font-semibold uppercase tracking-wide text-white bg-[rgb(var(--color-primary))] hover:bg-[rgb(var(--color-primary-dark))] disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-300 shadow-lg shadow-[rgb(var(--color-primary))]/30 hover:shadow-xl hover:shadow-[rgb(var(--color-primary))]/40 hover:-translate-y-0.5 active:translate-y-0 active:shadow-md"
              >
                {isSubmitting ? 'Submitting...' : 'Submit Request'}
              </button>

              <p className="text-center text-sm text-gray-600">
                Already have an account?{' '}
                <Link href="/sign-in" className="text-[rgb(var(--color-primary))] font-medium hover:underline">
                  Sign in
                </Link>
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
        <Image src="/print-room-logo.png" alt="The Print Room" width={192} height={48} className="h-10 xl:h-12 w-auto brightness-0 invert" />
      </div>
      <div className="space-y-4 xl:space-y-6 flex-1 flex flex-col justify-center py-6">
        <h1 className="text-3xl xl:text-4xl font-bold text-white leading-tight">Join Our B2B Program</h1>
        <p className="text-white/80 text-base xl:text-lg max-w-md">
          Get access to exclusive pricing, custom product catalogs, and dedicated account management.
        </p>
      </div>
      <div className="text-white/50 text-xs xl:text-sm flex-shrink-0">
        &copy; {new Date().getFullYear()} The Print Room. All rights reserved.
      </div>
    </div>
  )
}
