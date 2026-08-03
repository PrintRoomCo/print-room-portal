'use server'

import { getSupabaseServerComponent } from '@/lib/supabase-server-component'
import {
  updateCollection,
  deleteCollection,
  submitCollection,
  reviseCollection,
  addDesignToCollection,
  removeDesignFromCollection,
  getCollectionById,
  getCollectionWithDesigns,
} from '@/lib/collections-detail'
import { createMondayCollectionItem, createMondayDesignSubitems } from '@/lib/monday/collections'

async function requireAuthAndOwnership(collectionId: string) {
  const supabase = await getSupabaseServerComponent()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user || !user.email) {
    return { error: 'You must be signed in.' }
  }

  const collection = await getCollectionById(collectionId)
  if (!collection) {
    return { error: 'Collection not found.' }
  }

  if (collection.customer_email.toLowerCase() !== user.email.toLowerCase()) {
    return { error: 'Access denied.' }
  }

  return { user, collection }
}

export async function updateCollectionAction(
  formData: FormData
): Promise<{ error: string | null }> {
  const collectionId = formData.get('collectionId') as string
  const name = formData.get('name') as string
  const description = formData.get('description') as string

  if (!name?.trim()) {
    return { error: 'Collection name is required.' }
  }

  const auth = await requireAuthAndOwnership(collectionId)
  if ('error' in auth && typeof auth.error === 'string') return { error: auth.error }

  try {
    await updateCollection(collectionId, {
      name: name.trim(),
      description: description?.trim() || undefined,
    })
    return { error: null }
  } catch {
    return { error: 'Failed to update collection.' }
  }
}

export async function deleteCollectionAction(
  collectionId: string
): Promise<{ error: string | null }> {
  const auth = await requireAuthAndOwnership(collectionId)
  if ('error' in auth && typeof auth.error === 'string') return { error: auth.error }

  try {
    await deleteCollection(collectionId)
    return { error: null }
  } catch {
    return { error: 'Failed to delete collection.' }
  }
}

export async function submitCollectionAction(
  collectionId: string
): Promise<{ error: string | null }> {
  const auth = await requireAuthAndOwnership(collectionId)
  if ('error' in auth && typeof auth.error === 'string') return { error: auth.error }

  try {
    // Get full collection with designs for Monday push
    const fullCollection = await getCollectionWithDesigns(collectionId)

    // Try to create Monday item first (non-blocking on failure)
    let mondayItemId: string | undefined
    if (fullCollection) {
      try {
        const customer = {
          email: auth.user!.email!,
          name: auth.collection!.customer_id || auth.user!.email!,
          company: auth.collection!.company_id || undefined,
        }
        const mondayResult = await createMondayCollectionItem(fullCollection, customer)
        mondayItemId = mondayResult.itemId

        // Create sub-items for each design (fire-and-forget)
        if (fullCollection.designs.length > 0) {
          createMondayDesignSubitems(mondayResult.itemId, fullCollection.designs).catch((err) => {
            console.error('[SubmitCollection] Monday sub-items failed (non-blocking):', err)
          })
        }
      } catch (err) {
        console.error('[SubmitCollection] Monday push failed (non-blocking):', err)
      }
    }

    await submitCollection(collectionId, mondayItemId)
    return { error: null }
  } catch {
    return { error: 'Failed to submit collection.' }
  }
}

export async function reviseCollectionAction(
  collectionId: string
): Promise<{ error: string | null }> {
  const auth = await requireAuthAndOwnership(collectionId)
  if ('error' in auth && typeof auth.error === 'string') return { error: auth.error }

  try {
    await reviseCollection(collectionId)
    return { error: null }
  } catch {
    return { error: 'Failed to revise collection.' }
  }
}

export async function addDesignAction(
  collectionId: string,
  designId: string
): Promise<{ error: string | null }> {
  const auth = await requireAuthAndOwnership(collectionId)
  if ('error' in auth && typeof auth.error === 'string') return { error: auth.error }

  try {
    await addDesignToCollection(collectionId, designId)
    return { error: null }
  } catch {
    return { error: 'Failed to add design.' }
  }
}

export async function removeDesignAction(
  collectionId: string,
  designId: string
): Promise<{ error: string | null }> {
  const auth = await requireAuthAndOwnership(collectionId)
  if ('error' in auth && typeof auth.error === 'string') return { error: auth.error }

  try {
    await removeDesignFromCollection(collectionId, designId)
    return { error: null }
  } catch {
    return { error: 'Failed to remove design.' }
  }
}
