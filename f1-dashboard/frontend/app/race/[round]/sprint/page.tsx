'use client'

import { useParams } from 'next/navigation'
import { motion } from 'framer-motion'
import { Zap, Flag, Timer, Users } from 'lucide-react'
import { TEAM_COLORS, COMPOUND_COLORS } from '@/lib/constants'
import { useApiList } from '@/lib/api/client'
import type { SessionResult, Stint } from '@/lib/types'

const SPRINT_POINTS = [8, 7, 6, 5, 4, 3, 2, 1]
const MEDAL = ['#FFD700', '#C0C0C0', '#CD7F32']

/* Compact header readout — DESIGN.md §2 */
function HeaderStat({ label, value, accent }: { label: string; value: React.ReactNode; accent?: string }) {
  return (
    <div style={{ padding: '9px 16px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 2, minWidth: 96, textAlign: 'center' }}>
      <div className="font-num stat-num" style={{ fontSize: 18, color: accent || 'var(--foreground)' }}>{value}</div>
      <div style={{ fontSize: 9, color: 'var(--muted)', letterSpacing: '0.12em', textTransform: 'uppercase', marginTop: 3 }}>{label}</div>
    </div>
  )
}

function CompoundDot({ compound }: { compound: string }) {
  return (
    <span
      title={compound}
      style={{
        width: 20, height: 20, borderRadius: '50%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 10,
        background: COMPOUND_COLORS[compound as keyof typeof COMPOUND_COLORS] || 'var(--border)',
        color: ['MEDIUM', 'HARD'].includes(compound) ? '#000' : '#fff',
      }}
    >
      {compound[0]}
    </span>
  )
}

export default function SprintDashboard() {
  const params = useParams()
  const round = params.round as string

  const { data: results, isLoading: resultsLoading } = useApiList<SessionResult>(`/api/sessions/2026/${round}/Sprint/results`)
  const { data: stints, isLoading: stintsLoading } = useApiList<Stint>(`/api/sessions/2026/${round}/Sprint/stints`)
  const loading = (resultsLoading && results.length === 0) || (stintsLoading && stints.length === 0)

  const stintsByDriver: Record<string, Stint[]> = {}
  stints.forEach(s => {
    if (!stintsByDriver[s.driver]) stintsByDriver[s.driver] = []
    stintsByDriver[s.driver].push(s)
  })

  const winner = results[0]
  const scorers = results.filter(r => (r.points ?? 0) > 0).length
  const biggestGain = results.reduce<{ drv: string; gain: number } | null>((best, r) => {
    const grid = r.grid_position ?? r.grid
    if (grid == null || r.position == null) return best
    const gain = grid - r.position
    return !best || gain > best.gain ? { drv: r.abbreviation || r.driver || '', gain } : best
  }, null)

  return (
    <div style={{ maxWidth: '1560px', margin: '0 auto', padding: '26px clamp(16px, 3vw, 34px) 40px' }}>
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 20, flexWrap: 'wrap', marginBottom: 22 }}
      >
        <div>
          <div className="kicker" style={{ marginBottom: 8 }}>Round {round} / 2026 F1</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <h1 className="display-title" style={{ fontSize: 'clamp(26px, 4.2vw, 44px)', margin: 0 }}>Sprint Race</h1>
            <span className="font-display" style={{
              background: 'var(--amber)', color: '#000', fontSize: 11, padding: '4px 10px',
              borderRadius: 2, fontWeight: 800, letterSpacing: '0.08em',
            }}>SPRINT</span>
          </div>
          <p style={{ color: 'var(--muted)', fontSize: 13, margin: '7px 0 0' }}>
            Points 8-7-6-5-4-3-2-1 to the top eight · no fastest-lap bonus.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <HeaderStat label="Winner" value={winner ? (winner.abbreviation || winner.driver) : '—'} accent={MEDAL[0]} />
          <HeaderStat label="In Points" value={results.length ? scorers : '—'} accent="var(--amber)" />
          <HeaderStat label="Classified" value={results.length || '—'} />
          <HeaderStat
            label="Biggest Gain"
            value={biggestGain && biggestGain.gain > 0 ? `${biggestGain.drv} +${biggestGain.gain}` : '—'}
            accent="var(--sector-green)"
          />
        </div>
      </motion.div>

      {loading ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2.4fr) minmax(280px, 1fr)', gap: 16 }} className="live-grid">
          <div className="shimmer" style={{ height: 460, borderRadius: 2 }} />
          <div className="shimmer" style={{ height: 300, borderRadius: 2 }} />
        </div>
      ) : results.length === 0 ? (
        <div className="glass-card" style={{ padding: '48px 24px', textAlign: 'center' }}>
          <Flag size={22} style={{ color: 'var(--muted)', marginBottom: 10 }} />
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>No sprint results yet</div>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>
            This round either isn&apos;t a sprint weekend, or the sprint hasn&apos;t run.
          </div>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2.4fr) minmax(280px, 1fr)', gap: 16, alignItems: 'start' }} className="live-grid">
          {/* Main — classification */}
          <motion.div
            initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.04 }}
            className="glass-card" style={{ padding: 18 }}
          >
            <h2 className="section-title" style={{ marginBottom: 14, ['--bar' as string]: 'var(--amber)' }}>
              Sprint Classification
            </h2>
            <div style={{ overflowX: 'auto' }}>
              <table className="f1-table">
                <thead>
                  <tr>
                    <th style={{ width: 46 }}>POS</th>
                    <th>DRIVER</th>
                    <th>TEAM</th>
                    <th style={{ textAlign: 'center' }}>GRID</th>
                    <th style={{ textAlign: 'center' }}>+/−</th>
                    <th style={{ textAlign: 'right' }}>PTS</th>
                    <th style={{ textAlign: 'center' }}>TYRE</th>
                    <th>STATUS</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((r, i) => {
                    const color = TEAM_COLORS[r.team || ''] || 'var(--border)'
                    const dStints = stintsByDriver[r.abbreviation || r.driver || ''] || []
                    const lastCmp = dStints[dStints.length - 1]?.compound
                    // Use the real classified points; deriving them from the row
                    // index awards points to retired/DSQ drivers sitting in the
                    // top 8 rows.
                    const sprintPts = r.points ?? (r.position != null ? SPRINT_POINTS[r.position - 1] || 0 : 0)
                    const grid = r.grid_position ?? r.grid
                    const moved = grid != null && r.position != null ? grid - r.position : 0
                    const medal = i < 3 ? MEDAL[i] : null
                    return (
                      <tr key={r.driver || i} style={{
                        background: i === 0 ? 'linear-gradient(90deg, rgba(255,200,0,0.07), transparent 60%)' : 'transparent',
                      }}>
                        <td className="font-num" style={{ fontWeight: 700, color: medal || 'var(--muted)', fontSize: 12 }}>
                          {r.position ?? '—'}
                        </td>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                            <span style={{ width: 3, height: 16, background: color, display: 'inline-block', flexShrink: 0 }} />
                            <span className="font-display" style={{ fontWeight: 700, fontSize: 13 }}>{r.abbreviation || r.driver}</span>
                          </div>
                        </td>
                        <td style={{ fontSize: 12, color: 'var(--muted)' }}>{r.team}</td>
                        <td className="font-num" style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 12 }}>
                          {grid ?? '—'}
                        </td>
                        <td className="font-num" style={{
                          textAlign: 'center', fontSize: 12, fontWeight: 700,
                          color: moved > 0 ? 'var(--sector-green)' : moved < 0 ? 'var(--accent)' : 'var(--muted)',
                          opacity: moved === 0 ? 0.4 : 1,
                        }}>
                          {moved > 0 ? `+${moved}` : moved < 0 ? moved : '—'}
                        </td>
                        <td className="font-num" style={{
                          textAlign: 'right', fontWeight: 700, fontSize: 13,
                          color: sprintPts > 0 ? 'var(--amber)' : 'var(--muted)',
                          opacity: sprintPts > 0 ? 1 : 0.4,
                        }}>
                          {sprintPts > 0 ? sprintPts : '—'}
                        </td>
                        <td style={{ textAlign: 'center' }}>{lastCmp && <CompoundDot compound={lastCmp} />}</td>
                        <td style={{ fontSize: 12, color: r.status === 'Finished' ? 'var(--sector-green)' : 'var(--muted)' }}>
                          {r.status || '—'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </motion.div>

          {/* Rail */}
          <motion.div
            initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 }}
            style={{ display: 'flex', flexDirection: 'column', gap: 16 }}
          >
            {/* Points payout */}
            <div className="glass-card" style={{ padding: 18 }}>
              <h2 className="section-title" style={{ marginBottom: 14, ['--bar' as string]: 'var(--amber)' }}>
                <Zap size={13} style={{ marginRight: -4 }} />
                Points Payout
              </h2>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(78px, 1fr))', gap: 6 }}>
                {SPRINT_POINTS.map((pts, i) => {
                  const taken = results[i]
                  return (
                    <div key={i} style={{
                      padding: '9px 6px', textAlign: 'center',
                      background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 2,
                    }}>
                      <div className="font-num" style={{ fontSize: 9, color: 'var(--muted)', letterSpacing: '0.08em' }}>P{i + 1}</div>
                      <div className="stat-num" style={{ fontSize: 16, color: 'var(--amber)', margin: '3px 0' }}>{pts}</div>
                      <div className="font-display" style={{ fontSize: 10, fontWeight: 700, color: taken ? 'var(--foreground)' : 'var(--muted)', opacity: taken ? 1 : 0.35 }}>
                        {taken ? (taken.abbreviation || taken.driver) : '—'}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Tyre choice */}
            <div className="glass-card" style={{ padding: 18 }}>
              <h2 className="section-title" style={{ marginBottom: 14, ['--bar' as string]: 'var(--sector-purple)' }}>
                <Timer size={13} style={{ marginRight: -4 }} />
                Tyre Choice
              </h2>
              {(() => {
                const counts: Record<string, number> = {}
                results.forEach(r => {
                  const ds = stintsByDriver[r.abbreviation || r.driver || ''] || []
                  const c = ds[ds.length - 1]?.compound
                  if (c) counts[c] = (counts[c] || 0) + 1
                })
                const entries = Object.entries(counts).sort((a, b) => b[1] - a[1])
                if (!entries.length) {
                  return <div style={{ fontSize: 12, color: 'var(--muted)' }}>No stint data for this sprint.</div>
                }
                return (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                    {entries.map(([cmp, n]) => (
                      <div key={cmp} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <CompoundDot compound={cmp} />
                        <span className="font-display" style={{ fontSize: 12, fontWeight: 600, flex: 1 }}>{cmp}</span>
                        <span className="font-num" style={{ fontSize: 12, color: 'var(--muted)' }}>{n} car{n === 1 ? '' : 's'}</span>
                      </div>
                    ))}
                  </div>
                )
              })()}
            </div>

            {/* Format note */}
            <div className="glass-card" style={{ padding: 18 }}>
              <h2 className="section-title" style={{ marginBottom: 12 }}>
                <Users size={13} style={{ marginRight: -4 }} />
                Sprint Format
              </h2>
              <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.7 }}>
                A sprint is a short race with no mandatory pit stop. The grid is set by Sprint
                Qualifying, and the result does not set the grid for Sunday&apos;s Grand Prix —
                that comes from the separate Qualifying session.
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  )
}
