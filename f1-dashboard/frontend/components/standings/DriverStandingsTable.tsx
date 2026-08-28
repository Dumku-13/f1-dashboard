'use client'

import { useMemo, useState } from 'react'
import { ChevronUp, ChevronDown, Crown } from 'lucide-react'
import type { DriverStanding, RoundInfo } from '@/lib/types'
import TeamColorBar from '@/components/shared/TeamColorBar'
import { TEAM_COLORS } from '@/lib/constants'
import { useIsPhone } from '@/lib/breakpoint'

interface Props {
  drivers: DriverStanding[]
  rounds: RoundInfo[]
  compact?: boolean
}

const MEDAL = ['#FFD700', '#C0C0C0', '#CD7F32']

/** Rank drivers by points scored *before* the most recently completed round,
 * so the POS column can show a position-change arrow — same idea as the
 * live timing tower's PosDelta, just computed from the season table instead
 * of a live diff. */
function prevPositions(drivers: DriverStanding[], rounds: RoundInfo[]): Record<string, number> {
  const complete = rounds.filter(r => r.status === 'complete')
  if (!complete.length) return {}
  const lastRound = complete[complete.length - 1].round
  const before = drivers
    .map(d => {
      const rpts = d.rounds[lastRound]
      const delta = (rpts?.race || 0) + (rpts?.sprint || 0)
      return { abbreviation: d.abbreviation, pts: d.points - delta }
    })
    .sort((a, b) => b.pts - a.pts)
  const map: Record<string, number> = {}
  before.forEach((d, i) => { map[d.abbreviation] = i + 1 })
  return map
}

export default function DriverStandingsTable({ drivers, rounds, compact = false }: Props) {
  const [expanded, setExpanded] = useState(false)
  const [hovered, setHovered] = useState<string | null>(null)
  const phone = useIsPhone()

  const shown = compact ? drivers.slice(0, 5) : (expanded ? drivers : drivers.slice(0, 22))
  const completeRounds = rounds.filter(r => r.status === 'complete')
  const prevPos = useMemo(() => prevPositions(drivers, rounds), [drivers, rounds])

  return (
    <div style={{ overflowX: 'auto' }}>
      {/* 11 rounds at 34px plus POS/DRIVER/TEAM/PTS/W/POD/FL is 596px wider
          than a 375px screen, and that is legitimate — a season matrix is wide
          data and scrolling it sideways is the right gesture. What was missing
          is an anchor: scrolled to R7 you could no longer see whose row you
          were reading. `f1-table--anchored` pins POS and DRIVER on phones. */}
      <table className={`f1-table${compact ? '' : ' f1-table--anchored'}`}>
        <thead>
          <tr>
            <th style={{ width: '46px' }}>POS</th>
            <th>DRIVER</th>
            {!compact && !phone && <th>TEAM</th>}
            {!compact && completeRounds.map(r => (
              <th key={r.round} style={{ minWidth: '34px', textAlign: 'center', ...(r.is_sprint ? { borderTop: '2px solid var(--amber)' } : {}) }}>
                R{r.round}
                {r.is_sprint && <span style={{ color: 'var(--amber)', marginLeft: '2px' }}>S</span>}
              </th>
            ))}
            <th style={{ textAlign: 'right' }}>PTS</th>
            {!compact && <th style={{ textAlign: 'center' }}>W</th>}
            {!compact && <th style={{ textAlign: 'center' }}>POD</th>}
            {!compact && <th style={{ textAlign: 'center' }}>FL</th>}
          </tr>
        </thead>
        <tbody>
          {shown.map(d => {
            const color = TEAM_COLORS[d.team] || '#555'
            const leader = d.position === 1
            const medal = d.position <= 3 ? MEDAL[d.position - 1] : null
            const prev = prevPos[d.abbreviation]
            const moved = prev && prev !== d.position ? prev - d.position : 0
            return (
              <tr
                key={d.abbreviation}
                onMouseEnter={() => setHovered(d.abbreviation)}
                onMouseLeave={() => setHovered(null)}
                style={{
                  transition: 'background 0.1s',
                  background: leader ? 'linear-gradient(90deg, rgba(255,200,0,0.07), transparent 60%)' : 'transparent',
                }}
              >
                <td>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                    <span className="font-num" style={{ fontSize: '12px', fontWeight: 700, color: medal || 'var(--muted)' }}>
                      {d.position}
                    </span>
                    {leader && <Crown size={11} style={{ color: 'var(--amber)', flexShrink: 0 }} />}
                    {moved !== 0 && (
                      <span style={{ display: 'inline-flex', color: moved > 0 ? 'var(--sector-green)' : 'var(--accent)' }}>
                        {moved > 0 ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                      </span>
                    )}
                  </span>
                </td>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <TeamColorBar color={color} height="18px" />
                    <span className="font-display" style={{ fontWeight: 700, fontSize: '13px', letterSpacing: '0.01em' }}>{d.abbreviation}</span>
                    {!compact && !phone && <span style={{ color: 'var(--muted)', fontSize: '12px' }}>{d.name}</span>}
                  </div>
                </td>
                {!compact && !phone && <td style={{ color: 'var(--muted)', fontSize: '12px' }}>{d.team}</td>}
                {!compact && completeRounds.map(r => {
                  const rpts = d.rounds[r.round]
                  const total = (rpts?.race || 0) + (rpts?.sprint || 0)
                  return (
                    <td
                      key={r.round}
                      className="font-num"
                      style={{
                        textAlign: 'center',
                        fontSize: '11px',
                        color: total > 0 ? 'var(--foreground)' : 'var(--muted)',
                        opacity: total > 0 ? 1 : 0.4,
                        background: total === 25 ? 'rgba(0,209,49,0.14)' : total > 0 ? 'rgba(225,6,0,0.07)' : 'transparent',
                      }}
                    >
                      {total > 0 ? total : '—'}
                    </td>
                  )
                })}
                <td className="font-num" style={{ textAlign: 'right', fontWeight: 700, color: 'var(--foreground)', fontSize: '13px' }}>
                  {d.points}
                </td>
                {!compact && (
                  <td className="font-num" style={{ textAlign: 'center', fontSize: '12px', color: d.wins > 0 ? 'var(--amber)' : 'var(--muted)', opacity: d.wins > 0 ? 1 : 0.4 }}>
                    {d.wins || '—'}
                  </td>
                )}
                {!compact && (
                  <td className="font-num" style={{ textAlign: 'center', fontSize: '12px', color: 'var(--muted)', opacity: d.podiums > 0 ? 1 : 0.4 }}>
                    {d.podiums || '—'}
                  </td>
                )}
                {!compact && (
                  <td className="font-num" style={{ textAlign: 'center', fontSize: '12px', color: d.fastest_laps > 0 ? 'var(--sector-purple)' : 'var(--muted)', opacity: d.fastest_laps > 0 ? 1 : 0.4 }}>
                    {d.fastest_laps || '—'}
                  </td>
                )}
              </tr>
            )
          })}
        </tbody>
      </table>
      {!compact && !expanded && drivers.length > 5 && (
        <button
          onClick={() => setExpanded(true)}
          style={{
            width: '100%', padding: '10px', background: 'transparent', border: 'none',
            borderTop: '1px solid var(--border)', color: 'var(--muted)', cursor: 'pointer',
            fontSize: '11px', fontFamily: 'var(--font-display)', fontWeight: 600,
            letterSpacing: '0.08em', textTransform: 'uppercase',
          }}
        >
          Show all {drivers.length} drivers ↓
        </button>
      )}
    </div>
  )
}
