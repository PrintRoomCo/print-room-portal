'use client'

import * as Dialog from '@radix-ui/react-dialog'

interface Design {
  id: string
  name: string
  imageUrl: string
  category: string
}

interface Props {
  designs: Design[]
  onSelect: (designId: string) => void
  onClose: () => void
}

export function StandardDesignPicker({ designs, onSelect, onClose }: Props) {
  return (
    <Dialog.Root open onOpenChange={(open) => {
      if (!open) onClose()
    }}>
      <Dialog.Portal>
        <Dialog.Overlay className="glass-modal-backdrop" />
        <Dialog.Content className="glass-modal-content fixed left-1/2 top-1/2 z-[60] max-h-[80vh] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto p-6">
          <div className="flex justify-between items-center mb-4">
            <Dialog.Title className="text-lg font-bold">
              Choose a Standard Design
            </Dialog.Title>
            <Dialog.Close asChild>
              <button className="btn-ghost">Close</button>
            </Dialog.Close>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {designs.map(design => (
              <button
                key={design.id}
                className="card-interactive p-3 text-center"
                onClick={() => onSelect(design.id)}
              >
                {design.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={design.imageUrl} alt={design.name} className="w-full h-20 object-contain rounded-lg" />
                ) : (
                  <div className="w-full h-20 bg-gray-50 rounded-lg flex items-center justify-center text-muted-foreground text-xs">
                    Preview
                  </div>
                )}
                <div className="text-sm font-medium mt-2">{design.name}</div>
              </button>
            ))}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
