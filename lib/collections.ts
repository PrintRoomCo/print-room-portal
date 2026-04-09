import { getSupabaseServer } from '@/lib/supabase'

export type CollectionStatus = 'draft' | 'submitted' | 'approved' | 'rejected'

export interface DesignCollection {
  id: string
  name: string
  description: string | null
  quote_id: string | null
  customer_id: string
  customer_email: string
  company_id: string | null
  catalog_id: string | null
  status: CollectionStatus
  monday_item_id: string | null
  shopify_collection_id: string | null
  created_at: string
  updated_at: string
  submitted_at: string | null
  approved_at: string | null
  notes: string | null
  platform: string
}

export interface DesignSubmission {
  id: string
  customer_id: string
  customer_email: string
  company_id: string | null
  design_id: string
  design_name: string
  design_data: Record<string, unknown>
  pricing_data: Record<string, unknown> | null
  images: string[] | null
  status: string | null
  shopify_product_id: string | null
  submitted_at: string | null
  reviewed_at: string | null
  reviewed_by: string | null
  notes: string | null
  created_at: string
  updated_at: string
  catalog_id: string | null
  collection_id: string | null
  monday_subitem_id: string | null
}

export interface CollectionWithDesigns extends DesignCollection {
  designs: DesignSubmission[]
  design_count: number
}

export interface CreateCollectionInput {
  name: string
  description?: string
  customer_id: string
  customer_email: string
  company_id?: string
  catalog_id?: string
}

export async function getCustomerCollections(
  customerEmail: string
): Promise<CollectionWithDesigns[]> {
  const supabase = getSupabaseServer()

  const { data: collections, error } = await supabase
    .from('design_collections')
    .select('*')
    .eq('customer_email', customerEmail.toLowerCase())
    .order('created_at', { ascending: false })

  if (error) {
    if (error.code === '42P01') return []
    console.error('[Collections] Failed to get customer collections:', error)
    throw error
  }

  const collectionsWithDesigns = await Promise.all(
    (collections as DesignCollection[]).map(async (collection) => {
      const { count } = await supabase
        .from('design_submissions')
        .select('*', { count: 'exact', head: true })
        .eq('collection_id', collection.id)

      const { data: thumbnailDesigns } = await supabase
        .from('design_submissions')
        .select('id, design_name, images')
        .eq('collection_id', collection.id)
        .order('submitted_at', { ascending: false })
        .limit(4)

      return {
        ...collection,
        designs: (thumbnailDesigns || []) as DesignSubmission[],
        design_count: count || 0,
      }
    })
  )

  return collectionsWithDesigns
}

export async function createCollection(
  input: CreateCollectionInput
): Promise<DesignCollection> {
  const supabase = getSupabaseServer()

  const { data, error } = await supabase
    .from('design_collections')
    .insert({
      name: input.name,
      description: input.description || null,
      customer_id: input.customer_id,
      customer_email: input.customer_email.toLowerCase(),
      company_id: input.company_id || null,
      catalog_id: input.catalog_id || null,
      status: 'draft',
    })
    .select()
    .single()

  if (error) {
    console.error('[Collections] Failed to create collection:', error)
    throw error
  }

  return data as DesignCollection
}
