'use server'

import { revalidateTag } from 'next/cache'
import { getSupabaseServerComponent } from '@/lib/supabase-server-component'
import { getSupabaseServer } from '@/lib/supabase'
import { changePassword } from '@/lib/supabase-auth'
import { cacheTags } from '@/lib/cache/tags'
import { isPreviewRequest } from '@/lib/preview/guard'
import { NZ_REGIONS } from '@/lib/nz-regions'

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

  // Name feeds B2BCustomerAccess (firstName/lastName) — bust the per-user slice.
  revalidateTag(cacheTags.companyAccess, { expire: 0 })

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
  // locationIds also feed company access → bust that per-user slice too.
  revalidateTag(cacheTags.accountData, { expire: 0 })
  revalidateTag(cacheTags.companyAccess, { expire: 0 })

  return { success: true, message: `Store "${storeName}" has been created successfully!` }
}

export async function updateLocationAction(formData: FormData): Promise<ActionResult> {
  if (await isPreviewRequest()) {
    return { success: false, errors: ['Preview only — nothing was saved.'] }
  }
  const supabase = await getSupabaseServerComponent()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, errors: ['Not authenticated.'] }

  const adminClient = getSupabaseServer()

  const { data: membership } = await adminClient
    .from('user_organizations')
    .select('organization_id, role')
    .eq('user_id', user.id)
    .single()

  if (!membership) {
    return { success: false, errors: ['No company associated with your account.'] }
  }

  // Same gate as createLocationAction — the Edit affordance is admin-only in the
  // UI, but this action is directly callable, so re-check the role here.
  if (membership.role !== 'org_admin') {
    return { success: false, errors: ['Only organisation admins can edit locations.'] }
  }

  const storeId = (formData.get('storeId') as string)?.trim()
  if (!storeId) {
    return { success: false, errors: ['Missing location to update.'] }
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

  // Scope the update to BOTH the store id and the caller's organisation. The
  // service-role client bypasses RLS, so this second .eq() is the security
  // boundary: a forged storeId from another org matches no row and no-ops.
  const { error } = await adminClient
    .from('stores')
    .update({
      name: storeName,
      address: address1 || null,
      location: address2 || null,
      city: city || null,
      state: region?.name || regionCode || null,
      country: 'New Zealand',
      postal_code: zip || null,
      phone: formattedPhone || phone || null,
    })
    .eq('id', storeId)
    .eq('organization_id', membership.organization_id)

  if (error) {
    console.error('[Account] Update location error:', error)
    return { success: false, errors: ['Failed to update location.'] }
  }

  // Store list (name/address) lives in getPortalAccountData → bust account-data.
  // Unlike create, no new location id is added, so company-access (which carries
  // locationIds, not address fields) does not need busting.
  revalidateTag(cacheTags.accountData, { expire: 0 })

  return { success: true, message: `"${storeName}" has been updated.` }
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

  // logo_url feeds access.logoUrl, which getPortalCompanyAccess now serves from
  // a persistent per-user cache — bust it so the new logo shows immediately.
  revalidateTag(cacheTags.companyAccess, { expire: 0 })
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

  // See updateOrgLogoAction: bust the per-user access cache so the cleared
  // logo propagates immediately instead of lingering for the revalidate window.
  revalidateTag(cacheTags.companyAccess, { expire: 0 })
  return { success: true, message: 'Logo removed.' }
}
