'use client'

import { Switch } from '@/components/ui/Switch'

interface Props {
  checked: boolean
  onChange: (next: boolean) => void
  disabled?: boolean
}

/**
 * Master "Add all to my inventory" toggle that flips every per-line
 * inventory tick in CheckoutClient. Rendered as its own card between the
 * line-list section and the Required-by/Notes section.
 */
export function AddAllToInventoryToggle({ checked, onChange, disabled }: Props) {
  const labelId = 'add-all-to-inventory-label'
  const descId = 'add-all-to-inventory-desc'

  return (
    <section className="rounded-[32px] bg-white p-7 md:p-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0 flex-1">
          <p id={labelId} className="text-sm font-semibold text-gray-900">
            Add all to my inventory
          </p>
          <p id={descId} className="mt-1 text-xs text-gray-500">
            Route every line to your inventory shelf instead of shipping to a customer address.
          </p>
        </div>
        <Switch
          checked={checked}
          onChange={onChange}
          disabled={disabled}
          ariaLabelledBy={labelId}
          ariaDescribedBy={descId}
        />
      </div>
    </section>
  )
}
