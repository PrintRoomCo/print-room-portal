import { NextResponse } from 'next/server'
import { getPortalAccountData } from '@/lib/portal-data'

export async function GET() {
  return NextResponse.json(await getPortalAccountData())
}
