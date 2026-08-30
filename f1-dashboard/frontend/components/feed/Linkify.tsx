'use client'

import { TEAM_COLORS } from '@/lib/constants'
import { safeExternalUrl, displayUrl } from '@/lib/sanitize'

/**
 * Renders post text, turning `@TLA` mentions of known driver abbreviations
 * into colored inline chips and bare URLs into links. `driverTeam` maps
 * abbreviation -> team name so the chip can borrow the team's accent color.
 *
 * The URL half is the part that needs care: this is text one user wrote and
 * every other user's browser renders. `safeExternalUrl` is what stands between
 * a post and a `javascript:` href — anything it rejects is rendered as plain
 * text, so a hostile link degrades into something inert and visible rather
 * than into a working attack.
 */

// One split for both patterns, so a mention and a link in the same sentence
// can't fight over the same run of text. The URL half is deliberately loose
// about what it captures and strict about what it renders: safeExternalUrl
// makes the real decision, this only has to find candidates.
const TOKEN_RE = /(@[A-Z]{3}|https?:\/\/[^\s<>"']+)/g

// Trailing punctuation is almost always the sentence's, not the URL's:
// "see https://example.com/x." should link .../x and leave the full stop.
const TRAILING_PUNCT_RE = /[.,;:!?)\]}'"]+$/

export default function Linkify({ text, driverTeam }: { text: string; driverTeam: Record<string, string> }) {
  const parts = text.split(TOKEN_RE)
  return (
    <>
      {parts.map((part, i) => {
        const mention = /^@([A-Z]{3})$/.exec(part)
        if (mention && driverTeam[mention[1]]) {
          const abbr = mention[1]
          const color = TEAM_COLORS[driverTeam[abbr]] || 'var(--accent)'
          return (
            <span
              key={i}
              style={{
                display: 'inline-flex', alignItems: 'center', padding: '0 6px', margin: '0 1px',
                borderRadius: '5px', fontSize: '0.92em', fontWeight: 700,
                background: `${color}22`, color, border: `1px solid ${color}55`,
              }}
            >
              @{abbr}
            </span>
          )
        }

        if (/^https?:\/\//.test(part)) {
          const trailing = TRAILING_PUNCT_RE.exec(part)?.[0] ?? ''
          const candidate = trailing ? part.slice(0, -trailing.length) : part
          const href = safeExternalUrl(candidate)
          // Rejected: render the text the poster typed, unlinked. They can see
          // what they wrote; it just doesn't do anything.
          if (!href) return <span key={i}>{part}</span>
          return (
            <span key={i}>
              <a
                href={href}
                target="_blank"
                // noopener: the opened page must not get a handle on this one
                // via window.opener. nofollow: post text is user-submitted and
                // shouldn't pass ranking to whatever a spammer drops in it.
                rel="noopener noreferrer nofollow"
                style={{ color: 'var(--accent)', textDecoration: 'underline', textUnderlineOffset: '2px', wordBreak: 'break-all' }}
              >
                {displayUrl(candidate)}
              </a>
              {trailing}
            </span>
          )
        }

        return <span key={i}>{part}</span>
      })}
    </>
  )
}
