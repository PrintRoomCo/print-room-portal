'use client'

import { useEffect, useState } from 'react'
import { useCompany } from '@/contexts/CompanyContext'
import { CustomerInventoryTable } from '@/components/inventory/CustomerInventoryTable'
import type { CustomerInventoryRow } from '@/app/api/inventory/route'

export default function CustomerInventoryPage() {
  const { access, loading: companyLoading } = useCompany()
  const [rows, setRows] = useState<CustomerInventoryRow[]>([])
  const [dataLoading, setDataLoading] = useState(true)

  useEffect(() => {
    if (companyLoading) return
    if (!access) {
      setDataLoading(false)
      return
    }
    fetch('/api/inventory')
      .then((res) => (res.ok ? res.json() : { rows: [] }))
      .then((data) => {
        setRows(data.rows ?? [])
        setDataLoading(false)
      })
      .catch(() => setDataLoading(false))
  }, [access, companyLoading])

  if (companyLoading || dataLoading) {
    return (
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="animate-pulse space-y-6">
          <div className="h-8 bg-gray-200 rounded w-48" />
          <div className="h-40 bg-gray-200 rounded-2xl" />
        </div>
      </div>
    )
  }

  if (!access) return null

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Inventory</h1>
        <p className="text-sm text-gray-600 mt-1">
          Stock your Print Room account manager is holding for you. Click a
          product name to view details.
        </p>
      </div>

      <CustomerInventoryTable rows={rows} />
    </div>
  )
}
