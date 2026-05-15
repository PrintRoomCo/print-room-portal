import { NextResponse } from 'next/server'
import { getPortalOrderTrackerData } from '@/lib/portal-data'

export async function GET() {
  return NextResponse.json(await getPortalOrderTrackerData())
}
