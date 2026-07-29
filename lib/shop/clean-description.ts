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

// Block-level tags whose boundary implies a line break. Their closing tag (and
// <br>) becomes a newline so paragraph/list structure survives tag stripping.
const BLOCK_CLOSE = /<\/(?:p|div|li|ul|ol|h[1-6]|tr|blockquote|section|article)\s*>/gi

// Descriptions arrive in two shapes and BOTH must render with their line breaks
// intact on the customer PDP:
//   1. Plain text authored in the back end with real newlines + `-` bullets.
//   2. Escaped/real HTML from supplier & master imports, e.g.
//      "<p><span style=\"font-weight: 400;\">...</span></p><ul><li>...</li></ul>"
//      with `&rsquo;` entities.
// We convert HTML block boundaries to newlines, strip remaining inline tags,
// decode common entities, then normalise whitespace WITHOUT collapsing the
// newlines away (the previous `\s+ -> ' '` flattened everything into one
// run-on paragraph — the reported bug).
export function cleanDescription(raw: string | null | undefined): string | null {
  if (raw == null) return null
  const trimmed = String(raw).trim()
  if (!trimmed) return null

  const withBreaks = trimmed
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(BLOCK_CLOSE, '\n')

  const withoutTags = withBreaks.replace(/<[^>]*>/g, ' ')
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

  const normalised = decoded
    .replace(/\r\n?/g, '\n') // normalise CRLF / CR to LF
    .replace(/[^\S\n]+/g, ' ') // collapse horizontal whitespace, keep newlines
    .replace(/ *\n */g, '\n') // trim spaces hugging each newline
    .replace(/\n{3,}/g, '\n\n') // cap consecutive blank lines at one
    .trim()

  return normalised || null
}
