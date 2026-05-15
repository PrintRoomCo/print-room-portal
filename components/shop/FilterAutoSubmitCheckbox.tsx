'use client'

import { ChangeEvent, useEffect, useState, useTransition } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'

interface Props {
  name: string
  defaultChecked: boolean
  label: string
}

export function FilterAutoSubmitCheckbox({ name, defaultChecked, label }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [checked, setChecked] = useState(defaultChecked)
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    setChecked(defaultChecked)
  }, [defaultChecked])

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const nextChecked = event.target.checked
    setChecked(nextChecked)

    const params = new URLSearchParams(searchParams.toString())
    if (nextChecked) {
      params.set(name, '1')
    } else {
      params.delete(name)
    }
    params.set('page', '1')
    const query = params.toString()
    const nextUrl = query ? `${pathname}?${query}` : pathname
    startTransition(() => router.push(nextUrl, { scroll: false }))
  }

  return (
    <label
      className={`inline-flex cursor-pointer items-center gap-2 text-sm text-gray-700 transition-opacity duration-150 ${
        isPending ? 'opacity-60' : ''
      }`}
    >
      <input
        type="checkbox"
        name={name}
        value="1"
        checked={checked}
        onChange={handleChange}
        className="h-4 w-4 rounded border-gray-300 text-gray-900 focus:ring-2 focus:ring-gray-300"
      />
      {label}
      {isPending && (
        <span className="h-1.5 w-1.5 rounded-full bg-gray-500 animate-pulse" />
      )}
    </label>
  )
}
