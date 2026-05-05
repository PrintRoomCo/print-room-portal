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
    <label className="inline-flex items-center gap-2 text-sm text-gray-700">
      <input
        ref={ref}
        type="checkbox"
        name={name}
        value="1"
        defaultChecked={defaultChecked}
        onChange={handleChange}
        className="rounded border-gray-200"
      />
      {label}
    </label>
  )
}
