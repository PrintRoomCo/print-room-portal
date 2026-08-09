import { describe, it, expect } from 'vitest'
import { cleanDescription } from './clean-description'

describe('cleanDescription', () => {
  it('returns null for null, undefined, empty, and whitespace-only', () => {
    expect(cleanDescription(null)).toBeNull()
    expect(cleanDescription(undefined)).toBeNull()
    expect(cleanDescription('')).toBeNull()
    expect(cleanDescription('   \n\t  ')).toBeNull()
  })

  // The reported bug (Chris / Print Room). Staff type descriptions as plain text
  // with real newlines + `-` bullet lines in the back end. The old cleaner ran
  // `\s+ -> ' '`, flattening every line break into one run-on paragraph on the
  // PDP. Newlines the author typed MUST survive to the front end.
  it('preserves author newlines and bullet lines (plain-text description)', () => {
    const raw =
      "AS Colour Staple Tee\n" +
      "A premium Always Be Naturing t-shirt made for life outdoors and in between. Designed for comfort, durability, and a clean, modern fit, it's an easy staple for wherever your naturing takes you.\n\n\n" +
      "- AS Colour Staple T-Shirt\n" +
      "- Classic fit\n" +
      "- Premium cotton construction\n" +
      "- Soft, durable fabric designed for everyday wear\n"

    expect(cleanDescription(raw)).toBe(
      "AS Colour Staple Tee\n" +
        "A premium Always Be Naturing t-shirt made for life outdoors and in between. Designed for comfort, durability, and a clean, modern fit, it's an easy staple for wherever your naturing takes you.\n\n" +
        "- AS Colour Staple T-Shirt\n" +
        "- Classic fit\n" +
        "- Premium cotton construction\n" +
        "- Soft, durable fabric designed for everyday wear",
    )
  })

  it('caps three or more consecutive newlines at a single blank line', () => {
    expect(cleanDescription('one\n\n\n\n\ntwo')).toBe('one\n\ntwo')
  })

  it('collapses runs of horizontal whitespace within a line but keeps newlines', () => {
    expect(cleanDescription('a   b\n\tc    d')).toBe('a b\nc d')
  })

  // Supplier / master imports store descriptions as real HTML. Block boundaries
  // (paragraphs and list items) carry the line-break structure; the old cleaner
  // stripped every tag to a space and produced a run-on paragraph too.
  it('turns paragraph and list HTML into newline-separated lines', () => {
    const raw =
      '<p><strong>Fabric:</strong> 65% Cotton, 30% Polyester, 5% Elastane, UPF Rating 50+</p>\n' +
      '<ul><li>Open neckline with slimline placket</li><li>Cuffed sleeve and curved hemline</li></ul>'

    expect(cleanDescription(raw)).toBe(
      'Fabric: 65% Cotton, 30% Polyester, 5% Elastane, UPF Rating 50+\n\n' +
        'Open neckline with slimline placket\n' +
        'Cuffed sleeve and curved hemline',
    )
  })

  it('converts <br> tags to newlines', () => {
    expect(cleanDescription('line one<br>line two<br/>line three')).toBe(
      'line one\nline two\nline three',
    )
  })

  // Existing behaviour that must not regress: strip escaped inline markup and
  // decode common HTML entities to a clean single paragraph.
  it('strips inline tags and decodes entities (escaped-HTML import)', () => {
    const raw = '<p><span style="font-weight: 400;">It&rsquo;s a staple &amp; more</span></p>'
    expect(cleanDescription(raw)).toBe('It’s a staple & more')
  })

  it('decodes numeric and named entities and collapses nbsp runs', () => {
    expect(cleanDescription('a&nbsp;&nbsp;b &#8212; c')).toBe('a b — c')
  })

  it('returns a single trimmed line for a plain sentence (no false line breaks)', () => {
    const raw =
      'The AS Colour Staple Tee. Enduring comfort in a regular fit. Built to last.'
    expect(cleanDescription(raw)).toBe(raw)
  })
})

import { cleanDescriptionForDisplay } from './clean-description'

describe('cleanDescriptionForDisplay', () => {
  it('returns null for null / empty / whitespace', () => {
    expect(cleanDescriptionForDisplay(null)).toBeNull()
    expect(cleanDescriptionForDisplay(undefined)).toBeNull()
    expect(cleanDescriptionForDisplay('   ')).toBeNull()
  })

  it('routes tagless text to the plain branch with cleanDescription semantics', () => {
    expect(cleanDescriptionForDisplay('one\n- two\n- three')).toEqual({
      format: 'plain',
      text: 'one\n- two\n- three',
    })
    // entity decoding still happens on the plain branch (no tags present)
    expect(cleanDescriptionForDisplay('a&nbsp;&nbsp;b &#8212; c')).toEqual({
      format: 'plain',
      text: 'a b — c',
    })
  })

  it('routes staff-authored rich HTML to the rich branch, allowlist intact', () => {
    const raw = '<p><strong>Pre-orders close 15 July.</strong></p><ul><li>MOQ 100 units</li></ul>'
    expect(cleanDescriptionForDisplay(raw)).toEqual({ format: 'rich', html: raw })
  })

  it('sanitises hostile markup on the rich branch', () => {
    expect(cleanDescriptionForDisplay('<p onclick="x()">hi</p><script>bad()</script>')).toEqual({
      format: 'rich',
      html: '<p>hi</p>',
    })
  })

  it('renders legacy supplier HTML as sanitised structure (spans unwrapped, styles dropped)', () => {
    expect(
      cleanDescriptionForDisplay(
        '<p><span style="font-weight: 400;">It&rsquo;s a staple &amp; more</span></p>',
      ),
    ).toEqual({ format: 'rich', html: '<p>It’s a staple &amp; more</p>' })
  })

  it('returns null when rich input sanitises to nothing', () => {
    expect(cleanDescriptionForDisplay('<script>x()</script>')).toBeNull()
  })
})
