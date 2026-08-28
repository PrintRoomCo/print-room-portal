'use client'

interface SplitShipmentToggleProps {
  pressed: boolean
  onChange: (next: boolean) => void
  disabled?: boolean
}

/**
 * Split shipment is a MODE, not a ship-to choice, so it gets its own control
 * rather than an option inside the "Ships to" dropdown. Rendered unconditionally
 * beneath that dropdown: a customer who has never split before should be able to
 * see that they can, without opening a select to find out.
 *
 * Pressing it suspends the dropdown (the destinations below become the answer to
 * "where does this go") but does not overwrite it, so unpressing returns the
 * order to the store the customer already had selected.
 */
export function SplitShipmentToggle({
  pressed,
  onChange,
  disabled = false,
}: SplitShipmentToggleProps) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      disabled={disabled}
      onClick={() => onChange(!pressed)}
      className={
        'inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-xs ' +
        'font-medium transition-colors ' +
        'disabled:cursor-not-allowed disabled:opacity-60 ' +
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-pr-blue/40 focus-visible:ring-offset-2 ' +
        (pressed
          ? 'border-gray-900 bg-gray-900 text-white hover:bg-gray-800'
          : 'border-gray-200 bg-white text-gray-800 hover:border-gray-300')
      }
    >
      <span aria-hidden="true" className="text-sm leading-none">
        {pressed ? '✓' : '+'}
      </span>
      <span>Split shipment across destinations</span>
    </button>
  )
}
