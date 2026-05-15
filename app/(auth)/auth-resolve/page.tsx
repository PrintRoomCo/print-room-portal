import type { Metadata } from 'next'
import AuthResolveClient from './AuthResolveClient'

export const metadata: Metadata = {
  title: 'Signing in',
}

export default function AuthResolvePage() {
  return <AuthResolveClient />
}
