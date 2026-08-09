// Rich-description sanitiser — customer-portal twin of the staff portal's
// src/lib/products/sanitize-description.ts. The allowlist MUST stay identical
// on both sides (spec 2026-08-10). Server-side only: imported by the PDP
// loader and API routes, never by client components.
import sanitizeHtml from 'sanitize-html'

export const ALLOWED_DESCRIPTION_TAGS = ['p', 'br', 'strong', 'em', 'u', 'ul', 'ol', 'li', 'a']

const HTML_TAG_RE = /<[a-z][^>]*>/i
const HTTPS_RE = /^https:\/\//i

export function hasHtmlTags(value: string): boolean {
  return HTML_TAG_RE.test(value)
}

/** Sanitise a value already known to contain HTML. Null when no text survives. */
export function sanitizeRichDescriptionHtml(raw: string): string | null {
  const cleaned = sanitizeHtml(raw, {
    allowedTags: ALLOWED_DESCRIPTION_TAGS,
    allowedAttributes: { a: ['href', 'rel', 'target'] },
    allowedSchemes: ['https'],
    allowProtocolRelative: false,
    transformTags: {
      a: (tagName, attribs) => ({
        tagName: 'a',
        attribs: {
          ...(attribs.href && HTTPS_RE.test(attribs.href) ? { href: attribs.href } : {}),
          rel: 'noopener noreferrer',
          target: '_blank',
        },
      }),
    },
  })
    // An anchor whose href was rejected keeps its text but loses the dead <a>
    // shell. ([\s\S] rather than the dotAll `s` flag, which requires ES2018.)
    .replace(/<a(?![^>]*\bhref=)[^>]*>([\s\S]*?)<\/a>/gi, '$1')
    .trim()

  const textContent = cleaned.replace(/<[^>]*>/g, '').replace(/&nbsp;/gi, ' ').trim()
  return textContent === '' ? null : cleaned
}

/** Plain text passes through (trim-or-null); anything with tags is sanitised.
 *  Used by the raw shop-products API route so nothing unsanitised leaves it. */
export function sanitizeDescription(input: unknown): string | null {
  if (typeof input !== 'string') return null
  const raw = input.trim()
  if (raw === '') return null
  if (!hasHtmlTags(raw)) return raw
  return sanitizeRichDescriptionHtml(raw)
}
