'use client'

import { useRouter } from 'next/navigation'

export function WelcomeContinueButton() {
  const router = useRouter()

  function continueToShop() {
    document.cookie = 'welcome_seen=true; path=/; max-age=31536000; SameSite=Lax'
    router.push('/shop')
  }

  return (
    <button type="button" onClick={continueToShop} className="btn-accent">
      Continue to shop
    </button>
  )
}
