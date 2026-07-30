import { redirect } from 'next/navigation'

// 2026-07-31: the order tracker's canonical home moved from /past-orders to
// /current-orders (renamed "Current Orders"). /past-orders shipped only briefly,
// so this stub keeps that URL — and any still-open nav tab — alive.
export default function PastOrdersRedirect() {
  redirect('/current-orders')
}
