import { describe, it, expect } from 'vitest'
import {
  ALLOWED_DESCRIPTION_TAGS,
  hasHtmlTags,
  sanitizeRichDescriptionHtml,
  sanitizeDescription,
} from './sanitize-description'

describe('hasHtmlTags', () => {
  it('detects tags and ignores bare angle brackets', () => {
    expect(hasHtmlTags('<p>x</p>')).toBe(true)
    expect(hasHtmlTags('sizes < 10 and > 4')).toBe(false)
  })
})

describe('sanitizeRichDescriptionHtml', () => {
  it('keeps the allowlist unchanged', () => {
    const raw =
      '<p><strong>Bold</strong>, <em>italic</em>, <u>underline</u></p>' +
      '<ul><li>one</li></ul><ol><li>two</li></ol>'
    expect(sanitizeRichDescriptionHtml(raw)).toBe(raw)
  })

  it('strips hostile markup and non-allowlist attributes', () => {
    expect(
      sanitizeRichDescriptionHtml('<p class="c" onclick="x()">hi<script>bad()</script></p>'),
    ).toBe('<p>hi</p>')
  })

  it('keeps https links with forced rel/target, unwraps everything else', () => {
    const ok = sanitizeRichDescriptionHtml('<p><a href="https://example.com">site</a></p>')
    expect(ok).toContain('href="https://example.com"')
    expect(ok).toContain('rel="noopener noreferrer"')
    expect(ok).toContain('target="_blank"')
    expect(sanitizeRichDescriptionHtml('<p><a href="http://example.com">x</a></p>')).toBe('<p>x</p>')
    expect(sanitizeRichDescriptionHtml('<p><a href="javascript:alert(1)">x</a></p>')).toBe('<p>x</p>')
  })

  it('returns null when nothing textual survives', () => {
    expect(sanitizeRichDescriptionHtml('<p></p>')).toBeNull()
    expect(sanitizeRichDescriptionHtml('<script>x()</script>')).toBeNull()
  })
})

describe('sanitizeDescription (API-route variant)', () => {
  it('passes plain text through with trim-or-null semantics', () => {
    expect(sanitizeDescription('plain\n- bullet')).toBe('plain\n- bullet')
    expect(sanitizeDescription('   ')).toBeNull()
    expect(sanitizeDescription(null)).toBeNull()
  })
  it('sanitises rich input', () => {
    expect(sanitizeDescription('<p>hi<img src="https://x/y.png"></p>')).toBe('<p>hi</p>')
  })
})

describe('allowlist constant', () => {
  it('matches the staff-portal allowlist (spec 2026-08-10)', () => {
    expect(ALLOWED_DESCRIPTION_TAGS).toEqual(['p', 'br', 'strong', 'em', 'u', 'ul', 'ol', 'li', 'a'])
  })
})
