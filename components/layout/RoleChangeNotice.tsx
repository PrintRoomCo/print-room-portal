'use client'

import { useEffect, useState } from 'react'

/**
 * Buyer Roles step 6 — surfaces a one-shot banner when the cart was cleared
 * because the member's role changed mid-session (CartProvider sets the flag).
 * Auto-dismisses after 8s; stays put otherwise so the user reads it before
 * navigating away.
 */
export function RoleChangeNotice() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    function check() {
      if (sessionStorage.getItem('pr-cart-role-change-toast') === '1') {
        sessionStorage.removeItem('pr-cart-role-change-toast')
        setVisible(true)
      }
    }
    check()
    window.addEventListener('pr:cart-role-cleared', check)
    return () => window.removeEventListener('pr:cart-role-cleared', check)
  }, [])

  useEffect(() => {
    if (!visible) return
    const t = setTimeout(() => setVisible(false), 8000)
    return () => clearTimeout(t)
  }, [visible])

  if (!visible) return null

  return (
    <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 shadow-lg">
      Your buying scope changed. Your cart has been cleared.
    </div>
  )
}
