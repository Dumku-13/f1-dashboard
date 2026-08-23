'use client'

import { TEAM_COLORS } from '@/lib/constants'

/**
 * Renders post text, turning `@TLA` mentions of known driver abbreviations
 * into colored inline chips. `driverTeam` maps abbreviation -> team name so
 * the chip can borrow the team's accent color.
 */
export default function Linkify({ text, driverTeam }: { text: string; driverTeam: Record<string, string> }) {
  const parts = text.split(/(@[A-Z]{3})/g)
  return (
    <>
      {parts.map((part, i) => {
        const match = /^@([A-Z]{3})$/.exec(part)
        if (match && driverTeam[match[1]]) {
          const abbr = match[1]
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
        return <span key={i}>{part}</span>
      })}
    </>
  )
}
