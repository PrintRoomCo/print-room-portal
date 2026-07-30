import type { Metadata } from 'next'
import OrderTrackerPage from '../order-tracker/page'

export const metadata: Metadata = {
  title: 'Past orders',
}

// Canonical customer route for the order tracker (Anna portal feedback: the URL
// + page title read "Past orders"). The page body, the admin-only guard and the
// data fetching all live in ../order-tracker, which stays as the internal
// implementation because already-sent tracker emails deep-link to
// /order-tracker/[token]. Old /tracking bookmarks redirect here.
export default OrderTrackerPage
