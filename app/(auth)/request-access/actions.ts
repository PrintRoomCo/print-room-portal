'use server'

import { headers } from 'next/headers'
import { getSupabaseServer } from '@/lib/supabase'
import { createAccountRequestItem } from '@/lib/monday/account-requests'

const FALLBACK_LIMIT = 5
const FALLBACK_WINDOW_MS = 60 * 60 * 1000
const fallbackAttempts = new Map<string, number[]>()

async function getRequestIp() {
  const headerStore = await headers()
  const forwardedFor = headerStore.get('x-forwarded-for')?.split(',')[0]?.trim()
  return (
    forwardedFor ||
    headerStore.get('x-real-ip') ||
    headerStore.get('cf-connecting-ip') ||
    'unknown'
  )
}

function isFallbackRateLimited(ip: string, now = Date.now()) {
  const cutoff = now - FALLBACK_WINDOW_MS
  const recent = (fallbackAttempts.get(ip) ?? []).filter((ts) => ts > cutoff)

  if (recent.length >= FALLBACK_LIMIT) {
    fallbackAttempts.set(ip, recent)
    return true
  }

  recent.push(now)
  fallbackAttempts.set(ip, recent)
  return false
}

export async function submitAccessRequest(
  formData: FormData
): Promise<{ error: string | null }> {
  const firstName = formData.get('firstName') as string
  const lastName = formData.get('lastName') as string
  const email = formData.get('email') as string
  const phone = formData.get('phone') as string
  const companyName = formData.get('companyName') as string
  const customerType = formData.get('customerType') as string
  const industry = formData.get('industry') as string
  const estimatedVolume = formData.get('estimatedVolume') as string
  const referralSource = formData.get('referralSource') as string
  const message = formData.get('message') as string
  const accessibilityFallback = formData.get('accessibility_fallback') === 'true'

  if (!firstName?.trim() || !lastName?.trim() || !email?.trim()) {
    return { error: 'First name, last name, and email are required.' }
  }

  if (accessibilityFallback && isFallbackRateLimited(await getRequestIp())) {
    return {
      error:
        'Too many access requests from this connection. Please wait and try again, or email our team directly.',
    }
  }

  const supabase = getSupabaseServer()

  // Check for existing request with same email
  const { data: existing } = await supabase
    .from('account_requests')
    .select('id, status')
    .eq('email', email.trim().toLowerCase())
    .single()

  if (existing) {
    if (existing.status === 'pending') {
      return { error: 'A request with this email is already pending review.' }
    }
  }

  const { error } = await supabase.from('account_requests').insert({
    first_name: firstName.trim(),
    last_name: lastName.trim(),
    full_name: `${firstName.trim()} ${lastName.trim()}`,
    email: email.trim().toLowerCase(),
    phone: phone?.trim() || null,
    company_name: companyName?.trim() || null,
    customer_type: customerType || 'company',
    industry: industry || null,
    estimated_volume: estimatedVolume || null,
    referral_source: referralSource || null,
    message: message?.trim() || null,
    status: 'pending',
    platform: 'print-room',
  })

  if (error) {
    console.error('[RequestAccess] Insert error:', error)
    return { error: 'Failed to submit your request. Please try again.' }
  }

  // Fire-and-forget: push to Monday.com Account Requests board
  createAccountRequestItem({
    fullName: `${firstName.trim()} ${lastName.trim()}`,
    email: email.trim().toLowerCase(),
    companyName: companyName?.trim() || null,
    phone: phone?.trim() || null,
    customerType: customerType || null,
    industry: industry || null,
    estimatedVolume: estimatedVolume || null,
    message: message?.trim() || null,
  }).catch((err) => {
    console.error('[RequestAccess] Monday push failed (non-blocking):', err)
  })

  return { error: null }
}
