'use server'

import { sendPasswordResetEmail as sendReset } from '@/lib/supabase-auth'

export async function sendPasswordResetEmail(
  email: string,
  captchaToken?: string
): Promise<{ error: string | null }> {
  if (!email) {
    return { error: 'Email is required' }
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  if (!emailRegex.test(email)) {
    return { error: 'Please enter a valid email address' }
  }

  const redirectTo = `${process.env.NEXT_PUBLIC_SITE_URL}/callback`

  const result = await sendReset(email, redirectTo, captchaToken)

  if (!result.success) {
    return { error: result.error || 'Failed to send reset email' }
  }

  return { error: null }
}
