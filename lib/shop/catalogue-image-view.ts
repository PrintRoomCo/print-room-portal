const VIEW_ALIASES: Record<string, string> = {
  // `front` is the canonical front token; `hero` is the legacy alias kept readable
  // so old `product_images` / catalogue rows resolve to the same slot as `front`.
  hero: 'front',
  front: 'front',
  front_center: 'front',
  front_chest: 'front',
  back: 'back',
  back_center: 'back',
  back_full: 'back',
  left: 'left',
  side_left: 'left',
  right: 'right',
  side_right: 'right',
  left_sleeve: 'left_sleeve',
  sleeve_left: 'left_sleeve',
  right_sleeve: 'right_sleeve',
  sleeve_right: 'right_sleeve',
  side: 'side',
  top: 'top',
  bottom: 'bottom',
}

export function normalizeCatalogueImageView(
  view: string | null | undefined,
  imageUrl?: string | null,
): string | null {
  const key = (view ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_')
  if (VIEW_ALIASES[key]) return VIEW_ALIASES[key]

  const filename = filenameStem(imageUrl)
  if (filename) {
    const normalizedFilename = filename.toLowerCase().replace(/[^a-z0-9]+/g, '_')
    if (/(^|_)(back|rear)($|_)/.test(normalizedFilename)) return 'back'
    if (/(^|_)(left_sleeve|sleeve_left)($|_)/.test(normalizedFilename)) return 'left_sleeve'
    if (/(^|_)(right_sleeve|sleeve_right)($|_)/.test(normalizedFilename)) return 'right_sleeve'
    if (/(^|_)left($|_)/.test(normalizedFilename)) return 'left'
    if (/(^|_)(right|side)($|_)/.test(normalizedFilename)) return 'right'
  }

  if (/^detail[_-]?\d+$/i.test(key)) return 'front'
  return null
}

function filenameStem(imageUrl: string | null | undefined): string {
  if (!imageUrl) return ''
  const withoutQuery = imageUrl.split('?')[0] ?? imageUrl
  const leaf = withoutQuery.split('/').pop() ?? ''
  try {
    return decodeURIComponent(leaf).replace(/\.[a-z0-9]+$/i, '')
  } catch {
    return leaf.replace(/\.[a-z0-9]+$/i, '')
  }
}
