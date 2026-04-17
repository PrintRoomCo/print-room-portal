'use client'

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
    <div className="glass-modal-backdrop" onClick={onClose}>
      <div className="glass-modal-content max-w-lg w-full max-h-[80vh] overflow-y-auto p-6" onClick={e => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-bold">Choose a Standard Design</h3>
          <button className="btn-ghost" onClick={onClose}>Close</button>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {designs.map(design => (
            <button
              key={design.id}
              className="card-interactive p-3 text-center"
              onClick={() => onSelect(design.id)}
            >
              {design.imageUrl ? (
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
      </div>
    </div>
  )
}
