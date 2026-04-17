'use client'

import type { CustomerDetails } from './QuoteBuilder'

interface Props {
  customerDetails: CustomerDetails
  onChange: (d: Partial<CustomerDetails>) => void
  onBack: () => void
  onSubmit: () => void
  submitting: boolean
  totalUnits: number
}

export function CustomerDetailsModal({ customerDetails, onChange, onBack, onSubmit, submitting, totalUnits }: Props) {
  const d = customerDetails

  return (
    <div className="card p-6">
      <h2 className="text-lg font-bold mb-6">Your Details</h2>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1 uppercase tracking-wide">Full Name *</label>
          <input className="input-glass" value={d.fullName} onChange={e => onChange({ fullName: e.target.value })} placeholder="Your full name" />
        </div>
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1 uppercase tracking-wide">Email *</label>
          <input className="input-glass" type="email" value={d.email} onChange={e => onChange({ email: e.target.value })} placeholder="you@email.com" />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1 uppercase tracking-wide">School Name *</label>
          <input className="input-glass" value={d.schoolName} onChange={e => onChange({ schoolName: e.target.value })} placeholder="School name" />
        </div>
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1 uppercase tracking-wide">Phone Number</label>
          <input className="input-glass" type="tel" value={d.phoneNumber} onChange={e => onChange({ phoneNumber: e.target.value })} placeholder="021 000 0000" />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1 uppercase tracking-wide">Teacher in Charge *</label>
          <input className="input-glass" value={d.teacherName} onChange={e => onChange({ teacherName: e.target.value })} placeholder="Teacher name" />
        </div>
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1 uppercase tracking-wide">Teacher Email *</label>
          <input className="input-glass" type="email" value={d.teacherEmail} onChange={e => onChange({ teacherEmail: e.target.value })} placeholder="teacher@school.nz" />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1 uppercase tracking-wide">Required Order Date *</label>
          <input className="input-glass" type="date" value={d.requiredOrderDate} onChange={e => onChange({ requiredOrderDate: e.target.value })} />
        </div>
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1 uppercase tracking-wide">Ordering Method *</label>
          <select className="select-glass" value={d.orderingMethod} onChange={e => onChange({ orderingMethod: e.target.value as 'spreadsheet' | 'online_store' })}>
            <option value="spreadsheet">Spreadsheet (we collect sizes for you)</option>
            <option value="online_store">Online Store (students order directly)</option>
          </select>
        </div>
      </div>

      {d.orderingMethod === 'online_store' && totalUnits < 50 && (
        <div className="glass-warning-box px-4 py-3 mb-4 text-sm text-amber-800">
          Online store ordering requires a minimum of 50 total units. Current total: {totalUnits}
        </div>
      )}

      <div className="flex items-center justify-between mt-6 gap-4">
        <button className="btn-secondary" onClick={onBack}>
          &larr; Back to builder
        </button>
        <button
          className="btn-accent py-3 px-8 text-lg italic"
          onClick={onSubmit}
          disabled={submitting}
        >
          {submitting ? 'Submitting...' : 'Submit Quote Request'}
        </button>
      </div>
    </div>
  )
}
