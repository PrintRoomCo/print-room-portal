import { NextResponse } from 'next/server'
import { requireB2BCustomerApi } from '@/lib/checkout/server'
import { createQuoteRequest, type QuoteRequestLineInput } from '@/lib/checkout/quote-request'

interface QuoteRequestBody {
  lines?: QuoteRequestLineInput[]
}

export async function POST(request: Request) {
  const auth = await requireB2BCustomerApi()
  if ('error' in auth) return auth.error

  let body: QuoteRequestBody
  try {
    body = (await request.json()) as QuoteRequestBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!Array.isArray(body.lines) || body.lines.length === 0) {
    return NextResponse.json({ error: 'lines required' }, { status: 400 })
  }

  for (const l of body.lines) {
    if (!l.product_id || !l.product_name || !l.qty || !Number.isInteger(l.qty) || l.qty <= 0) {
      return NextResponse.json(
        { error: 'each line needs product_id, product_name, positive integer qty' },
        { status: 400 }
      )
    }
  }

  try {
    const id = await createQuoteRequest(auth.admin, auth.context, body.lines)
    return NextResponse.json({ staff_quote_id: id })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
