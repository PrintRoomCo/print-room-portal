/**
 * Shared branded-email shell + design tokens for customer-facing transactional
 * mail (order confirmation today; any future customer email that wants the look).
 *
 * Aesthetic: "Peaceful Engineering" — the same language the staff portal's
 * launch email uses: a white field, near-black grotesque headings, bold grey
 * copy, a single electric-blue accent, and a full-bleed blue footer. It is
 * mirrored here rather than imported because the two portals are separate apps.
 * If the brand palette ever shifts, keep this in sync with
 * print-room-staff-portal/src/lib/email/templates/shared.ts.
 */

/** Grotesque heading/body stack. Neuzeit Grotesk isn't an email-safe font, so
 *  the Helvetica fallback carries the look in clients that lack it. */
export const BRAND_FONT = `'Neuzeit Grotesk','Helvetica Neue',Helvetica,Arial,sans-serif`
/** Tabular monospace stack for the order reference and money figures — the
 *  small "engineering" tic that keeps columns aligned. */
export const BRAND_MONO = `'SFMono-Regular',Consolas,'Liberation Mono',Menlo,monospace`
/** The single vibrant accent: links, the order reference, the footer bar. */
export const BRAND_ACCENT = '#0600ff'
/** Darker accent for link hover (best-effort; only honoured by some clients). */
export const BRAND_ACCENT_HOVER = '#0400cc'
/** Near-black heading ink. */
export const INK = '#222222'
/** Primary body copy — dark enough to read a receipt by. */
export const BODY = '#444444'
/** Muted labels / secondary copy. */
export const MUTED = '#8a8a8a'
/** Hairline rules + panel borders. */
export const LINE = '#e8e8e8'
/** Light neutral panel surface (provisional note, details block). */
export const SURFACE = '#f6f6f7'

/** Customer-portal-hosted logo (served from /public/print-room-logo.png). */
const BRAND_LOGO_URL = 'https://portal.theprintroom.nz/print-room-logo.png'

/** Minimal HTML-entity escape for any value interpolated into email markup. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export interface BrandedEmailOptions {
  /** Hidden inbox-preview text (the grey line shown next to the subject). */
  preheader?: string
  /** Absolute, hosted logo URL. Defaults to the production customer-portal logo. */
  logoUrl?: string
  /** Footer sentence shown on the left of the blue footer bar. */
  footerNote?: string
}

const BRANDED_EMAIL_STYLES = `
  body { margin:0; padding:0; background-color:#ffffff; font-family:${BRAND_FONT}; -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%; }
  img { border:0; line-height:100%; outline:none; text-decoration:none; -ms-interpolation-mode:bicubic; display:block; }
  table { border-collapse:collapse !important; }
  a { color:${BRAND_ACCENT}; }

  /* Best-effort enhancement; every critical style is also inline. */
  .b-link:hover { color:${BRAND_ACCENT_HOVER} !important; }

  @media only screen and (max-width:600px) {
    .b-container { width:100% !important; }
    .b-pad { padding-left:22px !important; padding-right:22px !important; }
    .b-h1 { font-size:24px !important; }
  }
`

/**
 * Wrap inner body HTML in the branded shell: white page, left-aligned logo
 * header, white content area, a hidden inbox preheader, and a full-bleed
 * electric-blue footer carrying the reply prompt + copyright.
 */
export function wrapBrandedEmail(
  subject: string,
  bodyContent: string,
  opts: BrandedEmailOptions = {},
): string {
  const preheader = opts.preheader ?? ''
  const logoUrl = opts.logoUrl ?? BRAND_LOGO_URL
  const footerNote =
    opts.footerNote ??
    'Questions? Just reply to this email or contact hello@theprint-room.co.nz.'
  const year = new Date().getFullYear()

  // Hidden preheader + spacer entities push real body text out of the inbox
  // preview line so it doesn't leak boilerplate.
  const preheaderSpacer = '&nbsp;&zwnj;'.repeat(60)

  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1.0"/>
  <meta http-equiv="X-UA-Compatible" content="IE=edge"/>
  <meta name="x-apple-disable-message-reformatting"/>
  <meta name="color-scheme" content="light"/>
  <meta name="supported-color-schemes" content="light"/>
  <title>${subject}</title>
  <!--[if mso]>
  <noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript>
  <![endif]-->
  <style>${BRANDED_EMAIL_STYLES}</style>
</head>
<body style="margin:0;padding:0;background-color:#ffffff;">
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:#ffffff;opacity:0;">
    ${preheader}${preheaderSpacer}
  </div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#ffffff;width:100%;">
    <tr>
      <td align="center" style="padding:0;">
        <table role="presentation" class="b-container" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;">
          <tr>
            <td class="b-pad" align="left" style="padding:32px 32px 20px;">
              <img src="${logoUrl}" alt="The Print Room" width="132" height="auto" style="width:132px;max-width:132px;height:auto;margin:0;" />
            </td>
          </tr>
          <tr>
            <td class="b-pad" style="background-color:#ffffff;padding:4px 32px 36px;">
              ${bodyContent}
            </td>
          </tr>
          <tr>
            <td class="b-pad" style="background-color:${BRAND_ACCENT};padding:28px 32px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="left" valign="bottom" style="font-family:${BRAND_FONT};font-size:14px;line-height:1.6;color:#ffffff;">${footerNote}</td>
                  <td align="right" valign="bottom" style="font-family:${BRAND_FONT};font-size:14px;line-height:1.6;color:#ffffff;white-space:nowrap;padding-left:14px;">&copy; ${year} The Print Room</td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}
