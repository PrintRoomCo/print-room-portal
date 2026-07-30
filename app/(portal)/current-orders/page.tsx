import type { Metadata } from 'next'
import OrderTrackerPage from '../order-tracker/page'

export const metadata: Metadata = {
  title: 'Current Orders',
}

// Canonical customer route for the order tracker (the URL + page title read
// "Current Orders"). The page body, the admin-only guard and the data fetching
// all live in ../order-tracker, which stays as the internal implementation
// because already-sent tracker emails deep-link to /order-tracker/[token]. Old
// /past-orders, /tracking, /projects and /quote-requests bookmarks redirect here.
export default OrderTrackerPage
