import { getSupabaseServer } from '@/lib/supabase'
import { createClient } from '@supabase/supabase-js'

/**
 * Change a user's password by verifying current password first.
 * Uses a temporary client to sign in with current creds, then updates.
 */
export async function changePassword(
  email: string,
  currentPassword: string,
  newPassword: string
): Promise<{ success: boolean; error?: string }> {
  // Verify current password by attempting sign-in
  const tempClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  const { data: signInData, error: signInError } =
    await tempClient.auth.signInWithPassword({ email, password: currentPassword })

  if (signInError || !signInData.user) {
    return { success: false, error: 'Current password is incorrect' }
  }

  // Use service role to update password
  const supabase = getSupabaseServer()
  const { error: updateError } = await supabase.auth.admin.updateUserById(
    signInData.user.id,
    { password: newPassword }
  )

  if (updateError) {
    return { success: false, error: updateError.message }
  }

  return { success: true }
}

/**
 * Send a password reset email via Supabase.
 */
export async function sendPasswordResetEmail(
  email: string,
  redirectTo?: string,
  captchaToken?: string
): Promise<{ success: boolean; error?: string }> {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: redirectTo || `${process.env.NEXT_PUBLIC_SITE_URL}/set-password`,
    captchaToken,
  })

  if (error) {
    return { success: false, error: error.message }
  }

  return { success: true }
}
