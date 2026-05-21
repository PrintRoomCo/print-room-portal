'use client'

interface SwitchProps {
  checked: boolean
  onChange: (next: boolean) => void
  disabled?: boolean
  /** Accessible label. Either pass this or wrap the switch in a labelled element. */
  ariaLabel?: string
  ariaLabelledBy?: string
  ariaDescribedBy?: string
  className?: string
  size?: 'sm' | 'md'
}

/**
 * Flat, hand-rolled toggle switch matching the OEM-port aesthetic:
 * no shadows, gray-900 active fill, gray-200 idle fill, gray-900/50
 * focus ring. Activates on click, Space, or Enter (native <button>).
 */
export function Switch({
  checked,
  onChange,
  disabled,
  ariaLabel,
  ariaLabelledBy,
  ariaDescribedBy,
  className = '',
  size = 'md',
}: SwitchProps) {
  const dims =
    size === 'sm'
      ? { track: 'h-4 w-7', thumb: 'h-3 w-3', translate: 'translate-x-3' }
      : { track: 'h-5 w-9', thumb: 'h-4 w-4', translate: 'translate-x-4' }

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
      aria-describedby={ariaDescribedBy}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={
        'relative inline-flex shrink-0 cursor-pointer items-center rounded-full ' +
        'border border-transparent transition-colors duration-200 ease-in-out ' +
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-900/50 focus-visible:ring-offset-2 ' +
        'disabled:cursor-not-allowed disabled:opacity-60 ' +
        dims.track +
        ' ' +
        (checked ? 'bg-gray-900' : 'bg-gray-200') +
        ' ' +
        className
      }
    >
      <span
        aria-hidden="true"
        className={
          'pointer-events-none ml-0.5 inline-block transform rounded-full bg-white shadow-sm ' +
          'transition duration-200 ease-in-out ' +
          dims.thumb +
          ' ' +
          (checked ? dims.translate : 'translate-x-0')
        }
      />
    </button>
  )
}
