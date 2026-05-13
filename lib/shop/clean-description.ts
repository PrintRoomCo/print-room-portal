const ENTITY_MAP: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
  mdash: '—',
  ndash: '–',
  hellip: '…',
}

// Some suppliers (and a few master imports) stored descriptions as escaped
// HTML, e.g. literal "<p><span style=\"font-weight: 400;\">..." with `&rsquo;`
// entities. Rendering that as text shows the markup verbatim. Strip tags +
// decode common entities + collapse whitespace so the customer PDP shows a
// clean paragraph.
export function cleanDescription(raw: string | null | undefined): string | null {
  if (raw == null) return null
  const trimmed = String(raw).trim()
  if (!trimmed) return null

  const withoutTags = trimmed.replace(/<[^>]*>/g, ' ')
  const decoded = withoutTags
    .replace(/&#(\d+);/g, (_, code) => {
      const n = Number(code)
      return Number.isFinite(n) ? String.fromCodePoint(n) : _
    })
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => {
      const n = parseInt(hex, 16)
      return Number.isFinite(n) ? String.fromCodePoint(n) : _
    })
    .replace(/&([a-zA-Z]+);/g, (_, name: string) => ENTITY_MAP[name.toLowerCase()] ?? _)

  const collapsed = decoded.replace(/\s+/g, ' ').trim()
  return collapsed || null
}
