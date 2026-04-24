import type { SupabaseClient } from '@supabase/supabase-js'
import type { B2BCustomerContext } from '@/lib/checkout/server'

export interface QuoteRequestLineInput {
  product_id: string
  product_name: string
  variant_id?: string | null
  qty: number
}

export async function createQuoteRequest(
  admin: SupabaseClient,
  context: B2BCustomerContext,
  lines: QuoteRequestLineInput[]
): Promise<string> {
  const priced = await Promise.all(
    lines.map(async (l) => {
      const { data: unit } = await admin.rpc('get_unit_price', {
        p_product_id: l.product_id,
        p_org_id: context.organizationId,
        p_qty: l.qty,
      })
      const unitPrice = Number(unit ?? 0)
      return {
        ...l,
        unit_price: unitPrice,
        total_price: unitPrice * l.qty,
      }
    })
  )
  const subtotal = priced.reduce((sum, l) => sum + l.total_price, 0)

  const quote_data = {
    source: 'customer-portal',
    items: priced.map((l) => ({
      productId: l.product_id,
      name: l.product_name,
      quantity: l.qty,
      unitPrice: l.unit_price,
      variantId: l.variant_id ?? null,
    })),
    orderExtras: [],
    customerName: context.organizationName,
    customerEmail: context.email,
    customerCompany: context.organizationName,
    submittedAt: new Date().toISOString(),
  }

  const { data, error } = await admin
    .from('staff_quotes')
    .insert({
      submitted_by_user_id: context.userId,
      staff_user_id: null,
      status: 'draft',
      quote_data,
      subtotal,
      discount_percent: 0,
      total: subtotal,
      customer_name: context.organizationName,
      customer_email: context.email,
      customer_company: context.organizationName,
    })
    .select('id')
    .single()
  if (error) throw new Error(error.message)
  return (data as { id: string }).id
}
