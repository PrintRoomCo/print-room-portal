import { getSupabaseServer } from '@/lib/supabase'
import type { DesignCollection, DesignSubmission, CollectionWithDesigns } from '@/lib/collections'

export async function getCollectionById(id: string): Promise<DesignCollection | null> {
  const supabase = getSupabaseServer()

  const { data, error } = await supabase
    .from('design_collections')
    .select('*')
    .eq('id', id)
    .single()

  if (error) {
    if (error.code === 'PGRST116') return null
    console.error('[Collections] Failed to get collection:', error)
    throw error
  }

  return data as DesignCollection
}

export async function getCollectionDesigns(collectionId: string): Promise<DesignSubmission[]> {
  const supabase = getSupabaseServer()

  const { data, error } = await supabase
    .from('design_submissions')
    .select('*')
    .eq('collection_id', collectionId)
    .order('submitted_at', { ascending: false })

  if (error) {
    if (error.code === '42P01') return []
    console.error('[Collections] Failed to get collection designs:', error)
    throw error
  }

  return data as DesignSubmission[]
}

export async function getCollectionWithDesigns(id: string): Promise<CollectionWithDesigns | null> {
  const collection = await getCollectionById(id)
  if (!collection) return null

  const designs = await getCollectionDesigns(id)

  return {
    ...collection,
    designs,
    design_count: designs.length,
  }
}

export async function getAvailableDesigns(customerEmail: string): Promise<DesignSubmission[]> {
  const supabase = getSupabaseServer()

  const { data, error } = await supabase
    .from('design_submissions')
    .select('*')
    .eq('customer_email', customerEmail.toLowerCase())
    .is('collection_id', null)
    .eq('status', 'pending_review')
    .order('created_at', { ascending: false })

  if (error) {
    if (error.code === '42P01') return []
    console.error('[Collections] Failed to get available designs:', error)
    return []
  }

  return data as DesignSubmission[]
}

export async function updateCollection(
  id: string,
  input: { name?: string; description?: string }
): Promise<DesignCollection> {
  const supabase = getSupabaseServer()

  const updateData: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  }
  if (input.name !== undefined) updateData.name = input.name
  if (input.description !== undefined) updateData.description = input.description

  const { data, error } = await supabase
    .from('design_collections')
    .update(updateData)
    .eq('id', id)
    .eq('status', 'draft')
    .select()
    .single()

  if (error) {
    console.error('[Collections] Failed to update collection:', error)
    throw error
  }

  return data as DesignCollection
}

export async function deleteCollection(id: string): Promise<void> {
  const supabase = getSupabaseServer()

  await supabase
    .from('design_submissions')
    .update({ collection_id: null })
    .eq('collection_id', id)

  const { error } = await supabase
    .from('design_collections')
    .delete()
    .eq('id', id)
    .eq('status', 'draft')

  if (error) {
    console.error('[Collections] Failed to delete collection:', error)
    throw error
  }
}

export async function submitCollection(
  id: string,
  mondayItemId?: string
): Promise<DesignCollection> {
  const supabase = getSupabaseServer()

  const updateData: Record<string, unknown> = {
    status: 'submitted',
    submitted_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
  if (mondayItemId) {
    updateData.monday_item_id = mondayItemId
  }

  const { data, error } = await supabase
    .from('design_collections')
    .update(updateData)
    .eq('id', id)
    .eq('status', 'draft')
    .select()
    .single()

  if (error) {
    console.error('[Collections] Failed to submit collection:', error)
    throw error
  }

  return data as DesignCollection
}

export async function reviseCollection(id: string): Promise<DesignCollection> {
  const supabase = getSupabaseServer()

  const { data, error } = await supabase
    .from('design_collections')
    .update({
      status: 'draft',
      notes: null,
      monday_item_id: null,
      submitted_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('status', 'rejected')
    .select()
    .single()

  if (error) {
    console.error('[Collections] Failed to revise collection:', error)
    throw error
  }

  await supabase
    .from('design_submissions')
    .update({ status: 'pending_review' })
    .eq('collection_id', id)

  return data as DesignCollection
}

export async function addDesignToCollection(
  collectionId: string,
  designSubmissionId: string
): Promise<void> {
  const supabase = getSupabaseServer()

  const { error } = await supabase
    .from('design_submissions')
    .update({ collection_id: collectionId })
    .eq('id', designSubmissionId)

  if (error) {
    console.error('[Collections] Failed to add design:', error)
    throw error
  }
}

export async function removeDesignFromCollection(
  collectionId: string,
  designSubmissionId: string
): Promise<void> {
  const supabase = getSupabaseServer()

  const { error } = await supabase
    .from('design_submissions')
    .update({ collection_id: null })
    .eq('id', designSubmissionId)
    .eq('collection_id', collectionId)

  if (error) {
    console.error('[Collections] Failed to remove design:', error)
    throw error
  }
}

export async function getCollectionByQuoteId(quoteId: string): Promise<CollectionWithDesigns | null> {
  const supabase = getSupabaseServer()

  const { data, error } = await supabase
    .from('design_collections')
    .select('*')
    .eq('quote_id', quoteId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    if (error.code === 'PGRST116') return null
    console.error('[Collections] Failed to get collection by quote_id:', error)
    throw error
  }

  if (!data) return null

  const collection = data as DesignCollection
  const designs = await getCollectionDesigns(collection.id)
  return {
    ...collection,
    designs,
    design_count: designs.length,
  }
}
