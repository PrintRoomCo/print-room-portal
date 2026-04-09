import type { Metadata } from 'next'
import { DM_Sans } from 'next/font/google'
import { AuthProvider } from '@/contexts/AuthContext'
import './globals.css'

const dmSans = DM_Sans({
  subsets: ['latin'],
  variable: '--font-dm-sans',
})

export const metadata: Metadata = {
  title: {
    default: 'B2B Portal | The Print Room',
    template: '%s | The Print Room B2B Portal',
  },
  description: 'The Print Room B2B customer portal',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className={`${dmSans.variable} antialiased`}>
        <AuthProvider>
          {children}
        </AuthProvider>
      </body>
    </html>
  )
}
