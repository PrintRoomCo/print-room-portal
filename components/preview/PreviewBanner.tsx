'use client'

import { useCompany } from '@/contexts/CompanyContext'

const PERMISSION_LABEL: Record<string, string> = {
  stock_only: 'stock only',
  reorder_only: 'reorder only',
  both: 'stock + reorder',
}

export function PreviewBanner() {
  const { access } = useCompany()
  if (!access?.isPreview) return null
  const who = access.previewAs
  const detail = who
    ? `${who.name} (${who.role === 'staff' ? 'staff' : 'admin'} · ${PERMISSION_LABEL[who.orderingPermission] ?? who.orderingPermission})`
    : 'member'

  return (
    <div className="sticky top-0 z-50 flex items-center justify-center gap-3 bg-amber-500 px-4 py-2 text-center text-sm font-medium text-black">
      <span>Preview only — viewing as {detail}. No changes are saved.</span>
      <a href="/preview/exit" className="underline underline-offset-2">Exit preview</a>
    </div>
  )
}
