import { NextResponse } from 'next/server'
import { getSupabaseServerComponent } from '@/lib/supabase-server-component'
import { getCompanyAccess } from '@/lib/company'
import { readPreviewSession } from '@/lib/preview/cookie'
import { buildPreviewAccess } from '@/lib/preview/context'

/**
 * GET /api/company-access
 * Returns the B2BCustomerAccess for the authenticated user.
 * Called by CompanyContext on the client side.
 */
export async function GET() {
  const nowSec = Math.floor(Date.now() / 1000)
  const preview = await readPreviewSession(nowSec)
  if (preview) {
    const previewAccess = await buildPreviewAccess(preview)
    if (previewAccess) return NextResponse.json(previewAccess)
  }

  const supabase = await getSupabaseServerComponent()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json(null, { status: 401 })

  const access = await getCompanyAccess(user.id, user.email ?? undefined)
  if (!access) return NextResponse.json(null, { status: 404 })
  return NextResponse.json(access)
}
