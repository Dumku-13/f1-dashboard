'use client'

import { useMemo } from 'react'
import { ChevronUp, ChevronDown, Crown } from 'lucide-react'
import type { ConstructorStanding, RoundInfo } from '@/lib/types'
import TeamColorBar from '@/components/shared/TeamColorBar'
import { TEAM_COLORS } from '@/lib/constants'

interface Props {
  constructors: ConstructorStanding[]
  rounds: RoundInfo[]
  compact?: boolean
}

const MEDAL = ['#FFD700', '#C0C0C0', '#CD7F32']

/** Mirrors DriverStandingsTable's prevPositions — ranks teams by points
 * scored before the latest completed round so POS can show a move arrow. */
function prevPositions(constructors: ConstructorStanding[], rounds: RoundInfo[]): Record<string, number> {
  const complete = rounds.filter(r => r.status === 'complete')
  if (!complete.length) return {}
  const lastRound = complete[complete.length - 1].round
  const before = constructors
    .map(c => {
      const rpts = c.rounds[lastRound]
      const delta = (rpts?.race || 0) + (rpts?.sprint || 0)
      return { id: c.id, pts: c.points - delta }
    })
    .sort((a, b) => b.pts - a.pts)
  const map: Record<string, number> = {}
  before.forEach((c, i) => { map[c.id] = i + 1 })
  return map
}

export default function ConstructorStandingsTable({ constructors, rounds, compact = false }: Props) {
  const completeRounds = rounds.filter(r => r.status === 'complete')
  const prevPos = useMemo(() => prevPositions(constructors, rounds), [constructors, rounds])

  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="f1-table">
        <thead>
          <tr>
            <th style={{ width: '46px' }}>POS</th>
            <th>TEAM</th>
            {!compact && completeRounds.map(r => (
              <th key={r.round} style={{ minWidth: '34px', textAlign: 'center', ...(r.is_sprint ? { borderTop: '2px solid var(--amber)' } : {}) }}>
                R{r.round}
                {r.is_sprint && <span style={{ color: 'var(--amber)', marginLeft: '2px' }}>S</span>}
              </th>
            ))}
            <th style={{ textAlign: 'right' }}>PTS</th>
            {!compact && <th style={{ textAlign: 'center' }}>W</th>}
          </tr>
        </thead>
        <tbody>
          {constructors.map(c => {
            const color = c.color ? `#${c.color.replace('#', '')}` : TEAM_COLORS[c.name] || '#555'
            const leader = c.position === 1
            const medal = c.position <= 3 ? MEDAL[c.position - 1] : null
            const prev = prevPos[c.id]
            const moved = prev && prev !== c.position ? prev - c.position : 0
            return (
              <tr
                key={c.id}
                style={{ background: leader ? 'linear-gradient(90deg, rgba(255,200,0,0.07), transparent 60%)' : 'transparent' }}
              >
                <td>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                    <span className="font-num" style={{ fontSize: '12px', fontWeight: 700, color: medal || 'var(--muted)' }}>{c.position}</span>
                    {leader && <Crown size={11} style={{ color: 'var(--amber)', flexShrink: 0 }} />}
                    {moved !== 0 && (
                      <span style={{ display: 'inline-flex', color: moved > 0 ? 'var(--sector-green)' : 'var(--accent)' }}>
                        {moved > 0 ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                      </span>
                    )}
                  </span>
                </td>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <TeamColorBar color={color} width="12px" height="12px" />
                    <span className="font-display" style={{ fontWeight: 700, fontSize: '13px', letterSpacing: '0.01em' }}>{c.name}</span>
                  </div>
                </td>
                {!compact && completeRounds.map(r => {
                  const rpts = c.rounds[r.round]
                  const total = (rpts?.race || 0) + (rpts?.sprint || 0)
                  return (
                    <td
                      key={r.round}
                      className="font-num"
                      style={{
                        textAlign: 'center', fontSize: '11px',
                        color: total > 0 ? 'var(--foreground)' : 'var(--muted)',
                        opacity: total > 0 ? 1 : 0.4,
                        background: total > 0 ? 'rgba(225,6,0,0.05)' : 'transparent',
                      }}
                    >
                      {total > 0 ? total : '—'}
                    </td>
                  )
                })}
                <td className="font-num" style={{ textAlign: 'right', fontWeight: 700, color: 'var(--foreground)', fontSize: '13px' }}>{c.points}</td>
                {!compact && (
                  <td className="font-num" style={{ textAlign: 'center', fontSize: '12px', color: c.wins > 0 ? 'var(--amber)' : 'var(--muted)', opacity: c.wins > 0 ? 1 : 0.4 }}>
                    {c.wins || '—'}
                  </td>
                )}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
