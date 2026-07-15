import { NextResponse } from 'next/server'
import { getPortalPastOrdersData } from '@/lib/portal-data'

export async function GET() {
  return NextResponse.json(await getPortalPastOrdersData())
}
