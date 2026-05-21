import type { CSSProperties } from 'react'

interface SkeletonProps {
  className?: string
  style?: CSSProperties
  ariaLabel?: string
}

export function Skeleton({ className = '', style, ariaLabel }: SkeletonProps) {
  return (
    <div
      role={ariaLabel ? 'status' : undefined}
      aria-label={ariaLabel}
      aria-hidden={ariaLabel ? undefined : true}
      style={style}
      className={`pr-skeleton relative isolate overflow-hidden rounded-full bg-gray-100 ${className}`}
    />
  )
}
