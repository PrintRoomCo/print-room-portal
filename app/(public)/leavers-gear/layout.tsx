import Image from 'next/image'
import Link from 'next/link'

export const metadata = {
  title: 'Leavers Gear Quote Builder — The Print Room',
  description: 'Get a free quote for your school leavers gear. Hoodies, sweatshirts, rugbys and more.',
}

export default function LeaversGearLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      {/* Branded header — no auth, no sidebar */}
      <header className="border-b border-gray-100 bg-white">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-3">
            <Image
              src="/print-room-logo.png"
              alt="The Print Room"
              width={40}
              height={40}
              className="object-contain"
              style={{ width: 'auto', height: 'auto' }}
            />
            <span className="text-[rgb(var(--color-brand-blue))] text-lg font-normal lowercase hidden sm:inline">
              leavers gear
            </span>
          </Link>
          <Link href="https://theprint-room.co.nz/pages/school-leavers-gear" className="btn-secondary text-sm">
            Back to site
          </Link>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8">
        {children}
      </main>
    </div>
  )
}
