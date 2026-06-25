import { redirect } from 'next/navigation'

// /invite-accept is RETIRED (2026-06-25). B2B members are now onboarded with a
// single branded "sign-in code" email that lands on /sign-in's Email-code flow.
// This page used to verify a 6-digit invite OTP (verifyOtp type:'invite') that
// nothing sends anymore. Redirect any stale invite links to /sign-in so they
// don't dead-end.
export default function InviteAcceptRetired() {
  redirect('/sign-in')
}
