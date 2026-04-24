import type { SupabaseClient } from '@supabase/supabase-js'
import type { B2BCustomerContext } from '@/lib/checkout/server'

export interface ReorderRequestInput {
  variant_id: string
  requested_qty: number
  note?: string
}

export interface ReorderRequestRow {
  id: string
  organization_id: string
  variant_id: string
  requested_qty: number
  requested_by: string
  note: string | null
  status: string
  created_at: string
  resolved_at: string | null
}

export async function createReorderRequest(
  admin: SupabaseClient,
  context: B2BCustomerContext,
  payload: ReorderRequestInput
): Promise<ReorderRequestRow> {
  const { data, error } = await admin
    .from('variant_reorder_requests')
    .insert({
      organization_id: context.organizationId,
      variant_id: payload.variant_id,
      requested_qty: payload.requested_qty,
      requested_by: context.userId,
      note: payload.note ?? null,
    })
    .select('*')
    .single()
  if (error) throw new Error(error.message)

  // v1: console log. v1.1: Slack / email via notifyStaffReorder().
  console.info('[variant-reorder-request]', {
    org: context.organizationName,
    variant: payload.variant_id,
    qty: payload.requested_qty,
    note: payload.note,
  })
  return data as ReorderRequestRow
}
