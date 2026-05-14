'use client'

import { useRef, ChangeEvent } from 'react'

interface Option {
  value: string
  label: string
}

interface Props {
  name: string
  defaultValue: string
  options: Option[]
  ariaLabel: string
  className?: string
}

const DEFAULT_CLASSNAME =
  'w-full appearance-none rounded-full bg-gray-50 px-4 py-2 text-sm focus:bg-white focus:outline-none focus:ring-2 focus:ring-gray-300'

export function FilterAutoSubmitSelect({
  name,
  defaultValue,
  options,
  ariaLabel,
  className = DEFAULT_CLASSNAME,
}: Props) {
  const ref = useRef<HTMLSelectElement>(null)

  function handleChange(_: ChangeEvent<HTMLSelectElement>) {
    ref.current?.form?.requestSubmit()
  }

  return (
    <select
      ref={ref}
      name={name}
      defaultValue={defaultValue}
      onChange={handleChange}
      aria-label={ariaLabel}
      className={className}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
}
