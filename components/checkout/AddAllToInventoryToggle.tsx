'use client'

interface Props {
  checked: boolean
  onChange: (next: boolean) => void
  disabled?: boolean
}

/**
 * Compact "Add all to my inventory" pill rendered bottom-right of the
 * items section on the checkout page. The whole pill is one big
 * role="switch" button — clicking anywhere on the chip flips state.
 */
export function AddAllToInventoryToggle({ checked, onChange, disabled }: Props) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label="Add all lines to my inventory"
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={
        'inline-flex items-center gap-2.5 rounded-full border border-gray-200 ' +
        'bg-white px-3.5 py-1.5 text-xs font-medium text-gray-800 ' +
        'transition-colors hover:border-gray-300 ' +
        'disabled:cursor-not-allowed disabled:opacity-60 ' +
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-900/50 focus-visible:ring-offset-2'
      }
    >
      <span>Add all to my inventory</span>
      <span
        aria-hidden="true"
        className={
          'relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors ' +
          (checked ? 'bg-gray-900' : 'bg-gray-300')
        }
      >
        <span
          className={
            'ml-0.5 inline-block h-3 w-3 rounded-full bg-white shadow-sm transition-transform ' +
            (checked ? 'translate-x-3' : 'translate-x-0')
          }
        />
      </span>
    </button>
  )
}
