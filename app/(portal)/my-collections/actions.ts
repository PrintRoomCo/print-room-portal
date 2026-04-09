'use server'

import { getSupabaseServerComponent } from '@/lib/supabase-server-component'
import { getSupabaseServer } from '@/lib/supabase'
import { createCollection } from '@/lib/collections'

export async function createCollectionAction(
  formData: FormData
): Promise<{ error: string | null; collectionId?: string }> {
  const name = formData.get('name') as string
  const description = formData.get('description') as string

  if (!name?.trim()) {
    return { error: 'Collection name is required.' }
  }

  const supabase = await getSupabaseServerComponent()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user || !user.email) {
    return { error: 'You must be signed in.' }
  }

  // Get company_id if user is in an organization
  const adminClient = getSupabaseServer()
  const { data: membership } = await adminClient
    .from('user_organizations')
    .select('organization_id')
    .eq('user_id', user.id)
    .single()

  let companyId: string | undefined
  if (membership?.organization_id) {
    const { data: b2bAccount } = await adminClient
      .from('b2b_accounts')
      .select('company_id')
      .eq('organization_id', membership.organization_id)
      .single()

    companyId = b2bAccount?.company_id || undefined
  }

  try {
    const collection = await createCollection({
      name: name.trim(),
      description: description?.trim() || undefined,
      customer_id: user.id,
      customer_email: user.email,
      company_id: companyId,
    })

    return { error: null, collectionId: collection.id }
  } catch {
    return { error: 'Failed to create collection. Please try again.' }
  }
}
