import { NextResponse } from 'next/server'
import { getSupabaseServerComponent } from '@/lib/supabase-server-component'
import { getCustomerCollections } from '@/lib/collections'

export async function GET() {
  const supabase = await getSupabaseServerComponent()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user || !user.email) {
    return NextResponse.json({ collections: [] })
  }

  try {
    const collections = await getCustomerCollections(user.email)
    return NextResponse.json({ collections })
  } catch {
    return NextResponse.json({ collections: [] })
  }
}
