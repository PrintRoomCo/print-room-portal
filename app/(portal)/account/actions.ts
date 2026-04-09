'use server'

import { getSupabaseServerComponent } from '@/lib/supabase-server-component'
import { getSupabaseServer } from '@/lib/supabase'
import { changePassword } from '@/lib/supabase-auth'

const NZ_REGIONS = [
  { code: 'AUK', name: 'Auckland' },
  { code: 'BOP', name: 'Bay of Plenty' },
  { code: 'CAN', name: 'Canterbury' },
  { code: 'GIS', name: 'Gisborne' },
  { code: 'HKB', name: "Hawke's Bay" },
  { code: 'MBH', name: 'Marlborough' },
  { code: 'MWT', name: 'Manawatu-Wanganui' },
  { code: 'NSN', name: 'Nelson' },
  { code: 'NTL', name: 'Northland' },
  { code: 'OTA', name: 'Otago' },
  { code: 'STL', name: 'Southland' },
  { code: 'TAS', name: 'Tasman' },
  { code: 'TKI', name: 'Taranaki' },
  { code: 'WGN', name: 'Wellington' },
  { code: 'WKO', name: 'Waikato' },
  { code: 'WTC', name: 'West Coast' },
]

function formatPhoneE164(phone: string): string | null {
  if (!phone) return null
  let cleaned = phone.replace(/[^\d+]/g, '')
  if (!cleaned) return null
  if (cleaned.startsWith('+')) return cleaned
  if (cleaned.startsWith('64')) return '+' + cleaned
  if (cleaned.startsWith('0')) return '+64' + cleaned.slice(1)
  return '+64' + cleaned
}

export type ActionResult = {
  success: boolean
  message?: string
  errors?: string[]
}

export async function updateProfile(formData: FormData): Promise<ActionResult> {
  const supabase = await getSupabaseServerComponent()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, errors: ['Not authenticated.'] }

  const firstName = (formData.get('firstName') as string)?.trim()
  const lastName = (formData.get('lastName') as string)?.trim()

  if (!firstName || !lastName) {
    return { success: false, errors: ['First name and last name are required.'] }
  }

  const adminClient = getSupabaseServer()
  const { error } = await adminClient
    .from('profiles')
    .update({
      full_name: `${firstName} ${lastName}`,
      updated_at: new Date().toISOString(),
    })
    .eq('id', user.id)

  if (error) {
    console.error('[Account] Profile update error:', error)
    return { success: false, errors: ['Failed to update profile.'] }
  }

  return { success: true, message: 'Profile updated successfully!' }
}

export async function changePasswordAction(formData: FormData): Promise<ActionResult> {
  const supabase = await getSupabaseServerComponent()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.email) return { success: false, errors: ['Not authenticated.'] }

  const currentPassword = formData.get('currentPassword') as string
  const newPassword = formData.get('newPassword') as string
  const confirmPassword = formData.get('confirmPassword') as string

  if (!currentPassword || !newPassword || !confirmPassword) {
    return { success: false, errors: ['All password fields are required.'] }
  }

  if (newPassword !== confirmPassword) {
    return { success: false, errors: ['New passwords do not match.'] }
  }

  if (
    newPassword.length < 8 ||
    !/[A-Z]/.test(newPassword) ||
    !/[a-z]/.test(newPassword) ||
    !/[0-9]/.test(newPassword)
  ) {
    return {
      success: false,
      errors: ['Password must be at least 8 characters with uppercase, lowercase, and a number.'],
    }
  }

  const result = await changePassword(user.email, currentPassword, newPassword)
  if (!result.success) {
    return { success: false, errors: [result.error || 'Failed to change password.'] }
  }

  return { success: true, message: 'Password changed successfully!' }
}

export async function createLocationAction(formData: FormData): Promise<ActionResult> {
  const supabase = await getSupabaseServerComponent()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, errors: ['Not authenticated.'] }

  const adminClient = getSupabaseServer()

  // Get organization membership
  const { data: membership } = await adminClient
    .from('user_organizations')
    .select('organization_id, role')
    .eq('user_id', user.id)
    .single()

  if (!membership) {
    return { success: false, errors: ['No company associated with your account.'] }
  }

  const storeName = (formData.get('storeName') as string)?.trim()
  if (!storeName) {
    return { success: false, errors: ['Store name is required.'] }
  }

  const phone = (formData.get('phone') as string)?.trim() || ''
  const address1 = (formData.get('address1') as string)?.trim() || ''
  const address2 = (formData.get('address2') as string)?.trim() || ''
  const city = (formData.get('city') as string)?.trim() || ''
  const regionCode = formData.get('regionCode') as string
  const zip = (formData.get('zip') as string)?.trim() || ''

  const formattedPhone = formatPhoneE164(phone)
  const region = NZ_REGIONS.find((r) => r.code === regionCode)

  const { error } = await adminClient.from('stores').insert({
    organization_id: membership.organization_id,
    name: storeName,
    address: address1 || null,
    location: address2 || null,
    city: city || null,
    state: region?.name || regionCode || null,
    country: 'New Zealand',
    postal_code: zip || null,
    phone: formattedPhone || phone || null,
    created_by: user.id,
  })

  if (error) {
    console.error('[Account] Create location error:', error)
    return { success: false, errors: ['Failed to create store location.'] }
  }

  return { success: true, message: `Store "${storeName}" has been created successfully!` }
}
