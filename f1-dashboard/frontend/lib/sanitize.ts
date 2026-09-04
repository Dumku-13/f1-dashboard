/**
 * URL vetting for anything a user typed that another user's browser will act on.
 *
 * There is deliberately no HTML sanitiser here. This codebase has zero
 * `dangerouslySetInnerHTML` calls, so React escapes every piece of user text
 * on its own and an HTML sanitiser would only exist to make adding one feel
 * safe. Keep it that way: render user content as text children, not markup.
 *
 * What React does NOT escape is a URL you hand to `href` or `src`. A string
 * beginning `javascript:` in an href runs on click, and a `data:text/html`
 * document runs in the page's own origin. Those two cases are what this file
 * is for. The backend applies the matching rule to `image_url` at write time
 * (safe_url.py); this is the read-side half, because feed rows written before
 * that guard existed are still in the database.
 */

/** Protocols that execute rather than fetch. Everything not on the allowlist
 *  below is rejected anyway — this list is here to name the actual threat. */
const EXECUTABLE_PROTOCOLS = ['javascript:', 'data:', 'vbscript:', 'file:', 'blob:']

const MAX_URL_LENGTH = 2048

function parse(raw: string | null | undefined): URL | null {
  const trimmed = (raw || '').trim()
  if (!trimmed || trimmed.length > MAX_URL_LENGTH) return null
  // A protocol-relative "//evil.com" inherits the page's scheme and would
  // otherwise sail through as same-protocol. Reject before parsing, since
  // `new URL` with a base would happily resolve it.
  if (trimmed.startsWith('//')) return null
  try {
    // No base argument on purpose: a relative URL is not an external link, and
    // treating one as such is how an open-redirect starts.
    return new URL(trimmed)
  } catch {
    return null
  }
}

/**
 * The URL if it is safe to put in an `href`, otherwise null so the caller can
 * render plain text instead. `http:` is allowed only for localhost, which is
 * how the dev tunnel serves the app to a phone on the same network.
 */
export function safeExternalUrl(raw: string | null | undefined): string | null {
  const url = parse(raw)
  if (!url) return null
  if (EXECUTABLE_PROTOCOLS.includes(url.protocol)) return null

  const isLocal = url.hostname === 'localhost' || url.hostname === '127.0.0.1'
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLocal)) return null

  // Credentials in a link leak into the referrer and into browser history.
  if (url.username || url.password) return null

  return url.toString()
}

/**
 * The URL if it is safe to put in an `<img src>`. Stricter than a link: an
 * image loads without the user doing anything, so http:// is out entirely
 * (it is mixed content on an https page and renders as a broken image), and
 * private hosts are out because the request would be aimed at whatever sits
 * at that address on the *viewer's* network.
 */
export function safeImageUrl(raw: string | null | undefined): string | null {
  const url = parse(raw)
  if (!url) return null
  if (url.protocol !== 'https:') return null
  if (url.username || url.password) return null
  if (url.port && url.port !== '443') return null

  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (host === 'localhost' || host === '::1') return null
  // Literal private ranges. Names that resolve to them are not caught here and
  // are not meant to be — see safe_url.py for why chasing that is a dead end.
  if (/^127\./.test(host)) return null
  if (/^10\./.test(host)) return null
  if (/^192\.168\./.test(host)) return null
  if (/^169\.254\./.test(host)) return null
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return null

  return url.toString()
}

/**
 * A URL shortened for display — the host plus a little path, never the raw
 * 300-character tracking link. Returns the input unchanged if it will not
 * parse, since at that point it is just text.
 */
export function displayUrl(raw: string, maxLength = 42): string {
  try {
    const url = new URL(raw)
    const shown = `${url.hostname.replace(/^www\./, '')}${url.pathname === '/' ? '' : url.pathname}`
    return shown.length > maxLength ? `${shown.slice(0, maxLength - 1)}…` : shown
  } catch {
    return raw.length > maxLength ? `${raw.slice(0, maxLength - 1)}…` : raw
  }
}
