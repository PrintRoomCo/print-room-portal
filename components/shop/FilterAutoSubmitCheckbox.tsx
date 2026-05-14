'use client'

import { useRef, ChangeEvent } from 'react'

interface Props {
  name: string
  defaultChecked: boolean
  label: string
}

export function FilterAutoSubmitCheckbox({ name, defaultChecked, label }: Props) {
  const ref = useRef<HTMLInputElement>(null)

  function handleChange(_: ChangeEvent<HTMLInputElement>) {
    ref.current?.form?.requestSubmit()
  }

  return (
    <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-gray-700">
      <input
        ref={ref}
        type="checkbox"
        name={name}
        value="1"
        defaultChecked={defaultChecked}
        onChange={handleChange}
        className="h-4 w-4 rounded border-gray-300 text-gray-900 focus:ring-2 focus:ring-gray-300"
      />
      {label}
    </label>
  )
}
