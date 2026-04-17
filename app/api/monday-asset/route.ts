import { NextResponse } from 'next/server'
import { getSupabaseServerComponent } from '@/lib/supabase-server-component'

const ALLOWED_HOSTS = new Set(['theprint-room-group.monday.com'])

function authHeader(): string {
  let token = process.env.MONDAY_API_TOKEN || ''
  if (token.toLowerCase().startsWith('bearer ')) token = token.slice(7).trim()
  return token
}

export async function GET(request: Request) {
  const rawUrl = new URL(request.url).searchParams.get('url')
  if (!rawUrl) {
    return NextResponse.json({ error: 'Missing url parameter' }, { status: 400 })
  }

  let target: URL
  try {
    target = new URL(rawUrl)
  } catch {
    return NextResponse.json({ error: 'Invalid url' }, { status: 400 })
  }

  if (target.protocol !== 'https:' || !ALLOWED_HOSTS.has(target.hostname)) {
    return NextResponse.json({ error: 'Host not allowed' }, { status: 400 })
  }

  const supabase = await getSupabaseServerComponent()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const token = authHeader()
  if (!token) {
    return NextResponse.json(
      { error: 'MONDAY_API_TOKEN not configured' },
      { status: 500 }
    )
  }

  const upstream = await fetch(target.toString(), {
    headers: { Authorization: token },
    redirect: 'follow',
  })

  if (!upstream.ok || !upstream.body) {
    return NextResponse.json(
      { error: `Upstream ${upstream.status}` },
      { status: upstream.status >= 400 && upstream.status < 600 ? upstream.status : 502 }
    )
  }

  const headers = new Headers()
  const ct = upstream.headers.get('content-type')
  if (ct) headers.set('content-type', ct)
  const cl = upstream.headers.get('content-length')
  if (cl) headers.set('content-length', cl)
  headers.set('cache-control', 'private, max-age=300')

  return new Response(upstream.body, { status: 200, headers })
}
