import { NextResponse } from 'next/server'
import { getSupabaseServerComponent } from '@/lib/supabase-server-component'
import { getCompanyAccess } from '@/lib/company'

/**
 * GET /api/company-access
 * Returns the B2BCustomerAccess for the authenticated user.
 * Called by CompanyContext on the client side.
 */
export async function GET() {
  const supabase = await getSupabaseServerComponent()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json(null, { status: 401 })
  }

  const access = await getCompanyAccess(user.id, user.email ?? undefined)

  if (!access) {
    return NextResponse.json(null, { status: 404 })
  }

  return NextResponse.json(access)
}
