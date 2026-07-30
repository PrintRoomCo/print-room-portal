import { redirect } from 'next/navigation'

// The order tracker lives at /current-orders (page title "Current Orders").
// This stub keeps old /tracking bookmarks — and the /projects and
// /quote-requests redirect targets — alive.
export default function TrackingRedirect() {
  redirect('/current-orders')
}
