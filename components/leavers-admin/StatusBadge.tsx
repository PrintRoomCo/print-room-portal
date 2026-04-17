'use client'

interface Props {
  status: string
}

const statusStyles: Record<string, string> = {
  pending: 'glass-badge-yellow',
  approved: 'glass-badge-green',
  rejected: 'glass-badge-red',
  completed: 'glass-badge-blue',
  draft: 'glass-badge-gray',
}

export function StatusBadge({ status }: Props) {
  return (
    <span className={statusStyles[status] || 'glass-badge-gray'}>
      {status}
    </span>
  )
}
