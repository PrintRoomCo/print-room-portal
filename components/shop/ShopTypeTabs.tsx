import Link from 'next/link'
import type { ShopType } from '@/lib/shop/filter-params'

interface Props {
  active: ShopType
}

const TABS: Array<{ value: ShopType; label: string }> = [
  { value: 'catalogue', label: 'Catalogue' },
  { value: 'inventory', label: 'Inventory' },
]

export function ShopTypeTabs({ active }: Props) {
  return (
    <div
      role="tablist"
      aria-label="Shop view mode"
      className="inline-flex rounded-full border border-gray-200 bg-gray-50 p-1"
    >
      {TABS.map((tab) => {
        const isActive = tab.value === active
        return (
          <Link
            key={tab.value}
            href={`/shop?type=${tab.value}`}
            role="tab"
            aria-selected={isActive}
            className={
              isActive
                ? 'rounded-full bg-white px-4 py-1.5 text-sm font-medium text-gray-900 shadow-sm'
                : 'rounded-full px-4 py-1.5 text-sm font-medium text-gray-500 hover:text-gray-700'
            }
          >
            {tab.label}
          </Link>
        )
      })}
    </div>
  )
}
