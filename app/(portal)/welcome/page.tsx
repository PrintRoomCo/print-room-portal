import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { getSupabaseServerComponent } from '@/lib/supabase-server-component'
import { getSupabaseServer } from '@/lib/supabase'
import { getCompanyAccess } from '@/lib/company'
import { TierBadge } from '@/components/pricing/TierBadge'
import { WelcomeContinueButton } from '@/components/welcome/WelcomeContinueButton'

export const dynamic = 'force-dynamic'

interface AccountManager {
  name: string
  email: string
  phone: string
}

function accountManagerFromSettings(settings: Record<string, unknown> | null): AccountManager {
  const manager = settings?.account_manager
  if (manager && typeof manager === 'object') {
    const row = manager as Record<string, unknown>
    return {
      name: String(row.name ?? 'The Print Room team'),
      email: String(row.email ?? 'sales@theprint-room.co.nz'),
      phone: String(row.phone ?? '+64 9 600 1234'),
    }
  }
  return {
    name: 'The Print Room team',
    email: 'sales@theprint-room.co.nz',
    phone: '+64 9 600 1234',
  }
}

export default async function WelcomePage() {
  const cookieStore = await cookies()
  if (cookieStore.get('welcome_seen')?.value === 'true') {
    redirect('/shop')
  }

  const supabase = await getSupabaseServerComponent()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/sign-in')

  const access = await getCompanyAccess(user.id, user.email ?? undefined)
  if (!access) redirect('/account')

  let accountManager = accountManagerFromSettings(null)
  if (access.companyId) {
    const { data: org } = await getSupabaseServer()
      .from('organizations')
      .select('settings')
      .eq('id', access.companyId)
      .maybeSingle()
    accountManager = accountManagerFromSettings((org?.settings as Record<string, unknown> | null) ?? null)
  }

  const firstName = access.firstName || user.email?.split('@')[0] || 'there'
  const companyName = access.companyName ?? 'your account'
  const pricingCopy =
    access.pricingMode === 'catalogue'
      ? 'Your dedicated catalogue pricing is ready in the shop.'
      : access.pricingMode === 'tiered'
        ? `Your ${access.tierLabel ?? 'account'} pricing is applied automatically.`
        : 'Your account pricing is applied automatically.'

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 md:p-8">
      <section className="rounded-2xl bg-[rgb(var(--color-brand-blue))] p-6 text-white shadow-md md:p-8">
        <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="mb-3">
              <TierBadge
                label={access.tierLabel}
                pricingMode={access.pricingMode}
                className="border-white/25 bg-white/15 text-white"
              />
            </div>
            <h1 className="text-3xl font-semibold tracking-normal md:text-4xl">
              Welcome, {firstName}
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-white/85">
              You are connected to {companyName} on The Print Room portal. {pricingCopy}
            </p>
          </div>
          <WelcomeContinueButton />
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        {[
          ['Browse your catalogue', `${companyName}'s curated products and account pricing.`],
          ['Place repeat orders', 'Add products to cart, choose quantities, and submit against your account terms.'],
          ['Track production', 'Follow active projects and reorder from completed work.'],
        ].map(([title, body]) => (
          <div key={title} className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
            <p className="mt-2 text-sm leading-6 text-gray-600">{body}</p>
          </div>
        ))}
      </section>

      <section className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
        <p className="text-xs font-medium uppercase tracking-wide text-gray-400">Account manager</p>
        <div className="mt-3 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">{accountManager.name}</h2>
            <p className="text-sm text-gray-600">Questions about catalogues, orders, or proofs.</p>
          </div>
          <div className="text-sm text-gray-600">
            <a className="font-medium text-[rgb(var(--color-brand-blue))]" href={`mailto:${accountManager.email}`}>
              {accountManager.email}
            </a>
            <span className="mx-2 text-gray-300">/</span>
            <span>{accountManager.phone}</span>
          </div>
        </div>
      </section>
    </div>
  )
}
