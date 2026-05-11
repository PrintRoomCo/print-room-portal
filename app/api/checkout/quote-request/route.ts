import { NextResponse } from 'next/server'

// MF-6 Quote retirement (2026-05-13): the customer "Submit as quote request"
// flow is gone — every catalogue submit now lands directly in `orders` with
// status `awaiting-approval` and waits for staff approval. This route is kept
// as a 410 gate so any stale clients (cached PWAs, old bookmarks, scripts)
// get a clean signal instead of a 404.
export async function POST() {
  return NextResponse.json({ error: 'retired' }, { status: 410 })
}
