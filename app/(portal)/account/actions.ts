'use server'

import { revalidateTag } from 'next/cache'
import { getSupabaseServerComponent } from '@/lib/supabase-server-component'
import { getSupabaseServer } from '@/lib/supabase'
import { changePassword } from '@/lib/supabase-auth'
import { cacheTags } from '@/lib/cache/tags'
import { isPreviewRequest } from '@/lib/preview/guard'

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
  if (await isPreviewRequest()) {
    return { success: false, errors: ['Preview only — nothing was saved.'] }
  }
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
  if (await isPreviewRequest()) {
    return { success: false, errors: ['Preview only — nothing was saved.'] }
  }
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
  if (await isPreviewRequest()) {
    return { success: false, errors: ['Preview only — nothing was saved.'] }
  }
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

  // Server-side mirror of the `access.isOrgAdmin` UI gate on the Add Location
  // card. The UI hides the action from buyers, but the server action is
  // directly callable — only org admins may add locations.
  if (membership.role !== 'org_admin') {
    return { success: false, errors: ['Only organisation admins can add locations.'] }
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

  // Store list lives in getPortalAccountData → bust the account-data cache.
  revalidateTag(cacheTags.accountData, { expire: 0 })

  return { success: true, message: `Store "${storeName}" has been created successfully!` }
}

// Org header logo — public bucket reused from artworks; logos live under an
// org-scoped prefix. See docs/superpowers/specs/2026-06-25-org-header-logo-design.md.
const LOGO_BUCKET = 'org-artworks'
const LOGO_MAX_BYTES = 2 * 1024 * 1024 // 2 MB
const LOGO_EXT_BY_TYPE: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
}

/**
 * Shared guard for the org-logo actions: preview → auth → membership → role.
 * Mirrors the inline checks in createLocationAction; both logo actions need the
 * same gate, so it lives here once. Returns the org id on success, or a ready
 * ActionResult to return verbatim on any failure.
 */
async function resolveOrgAdmin(): Promise<
  { ok: true; organizationId: string } | { ok: false; result: ActionResult }
> {
  if (await isPreviewRequest()) {
    return { ok: false, result: { success: false, errors: ['Preview only — nothing was saved.'] } }
  }

  const supabase = await getSupabaseServerComponent()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, result: { success: false, errors: ['Not authenticated.'] } }

  const adminClient = getSupabaseServer()
  const { data: membership } = await adminClient
    .from('user_organizations')
    .select('organization_id, role')
    .eq('user_id', user.id)
    .single()

  if (!membership) {
    return { ok: false, result: { success: false, errors: ['No company associated with your account.'] } }
  }
  if (membership.role !== 'org_admin') {
    return { ok: false, result: { success: false, errors: ['Only organisation admins can change the logo.'] } }
  }
  return { ok: true, organizationId: membership.organization_id as string }
}

export async function updateOrgLogoAction(formData: FormData): Promise<ActionResult> {
  const auth = await resolveOrgAdmin()
  if (!auth.ok) return auth.result

  const file = formData.get('logo')
  if (!(file instanceof File) || file.size === 0) {
    return { success: false, errors: ['Please choose a logo image to upload.'] }
  }

  const ext = LOGO_EXT_BY_TYPE[file.type]
  if (!ext) {
    return { success: false, errors: ['Logo must be a PNG, JPG, WebP, or SVG image.'] }
  }
  if (file.size > LOGO_MAX_BYTES) {
    return { success: false, errors: ['Logo must be 2 MB or smaller.'] }
  }

  const adminClient = getSupabaseServer()
  const path = `org-logos/${auth.organizationId}/logo-${Date.now()}.${ext}`

  const { error: uploadError } = await adminClient.storage
    .from(LOGO_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: true })

  if (uploadError) {
    console.error('[Account] Logo upload error:', uploadError)
    return { success: false, errors: ['Failed to upload logo. Please try again.'] }
  }

  const { data: urlData } = adminClient.storage.from(LOGO_BUCKET).getPublicUrl(path)
  const publicUrl = urlData?.publicUrl
  if (!publicUrl) {
    return { success: false, errors: ['Failed to resolve the uploaded logo URL.'] }
  }

  const { error } = await adminClient
    .from('organizations')
    .update({ logo_url: publicUrl })
    .eq('id', auth.organizationId)

  if (error) {
    console.error('[Account] Logo save error:', error)
    return { success: false, errors: ['Failed to save logo.'] }
  }

  // No tag revalidation needed: the header reads the logo via
  // getPortalCompanyAccess (request-memoised, not persistently cached) and
  // /api/company-access (dynamic), so the client's post-save reload picks it up.
  return { success: true, message: 'Logo updated successfully!' }
}

export async function removeOrgLogoAction(): Promise<ActionResult> {
  const auth = await resolveOrgAdmin()
  if (!auth.ok) return auth.result

  const adminClient = getSupabaseServer()

  // Best-effort: clear stored objects under the org's logo prefix. Storage
  // cleanup must never block clearing the pointer, so failures are swallowed.
  try {
    const prefix = `org-logos/${auth.organizationId}`
    const { data: existing } = await adminClient.storage.from(LOGO_BUCKET).list(prefix)
    if (existing && existing.length > 0) {
      await adminClient.storage
        .from(LOGO_BUCKET)
        .remove(existing.map((f: { name: string }) => `${prefix}/${f.name}`))
    }
  } catch (cleanupError) {
    console.error('[Account] Logo cleanup error (non-fatal):', cleanupError)
  }

  const { error } = await adminClient
    .from('organizations')
    .update({ logo_url: null })
    .eq('id', auth.organizationId)

  if (error) {
    console.error('[Account] Logo remove error:', error)
    return { success: false, errors: ['Failed to remove logo.'] }
  }

  // See updateOrgLogoAction: the post-save reload refreshes the header.
  return { success: true, message: 'Logo removed.' }
}
