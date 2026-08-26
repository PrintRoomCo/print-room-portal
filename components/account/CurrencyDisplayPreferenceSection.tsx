import { CurrencySelector } from '@/components/currency/CurrencySelector'

interface Props {
  fetchedAt: string | null
}

export function CurrencyDisplayPreferenceSection({ fetchedAt }: Props) {
  const fetchedLabel = fetchedAt
    ? new Date(fetchedAt).toLocaleString('en-NZ', {
        dateStyle: 'medium',
        timeStyle: 'short',
      })
    : 'unknown'

  return (
    <section className="card-elevated p-6">
      <h2 className="text-lg font-semibold text-gray-900">Display preferences</h2>
      <div className="mt-4 flex items-center gap-3">
        <label className="text-sm text-gray-600">Currency for display</label>
        <div className="rounded-full border border-gray-200 bg-white px-3 py-1">
          <CurrencySelector />
        </div>
      </div>
      <p className="mt-3 text-sm text-gray-500">
        Prices throughout the app are stored in NZD and converted for display only.
        Last rate update: {fetchedLabel}.
      </p>
    </section>
  )
}
