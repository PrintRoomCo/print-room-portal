'use server'

import { getSupabaseServer } from '@/lib/supabase'
import { createAccountRequestItem } from '@/lib/monday/account-requests'

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

  if (!firstName?.trim() || !lastName?.trim() || !email?.trim()) {
    return { error: 'First name, last name, and email are required.' }
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
