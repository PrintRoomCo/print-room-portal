import { redirect } from 'next/navigation'

// 2026-07-30 Anna portal feedback: the order tracker moved to /past-orders (URL
// + page title renamed from "Current orders"). This stub keeps old /tracking
// bookmarks — and the /projects and /quote-requests redirect targets — alive.
export default function TrackingRedirect() {
  redirect('/past-orders')
}
