'use client'

import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import { motion } from 'framer-motion'
import { Flag, Zap, Radio } from 'lucide-react'
import { formatLapTime } from '@/lib/ist'
import { TEAM_COLORS, COMPOUND_COLORS } from '@/lib/constants'
import { useApiList } from '@/lib/api/client'
import { useCalendar } from '@/lib/api/hooks'
import type { LapData, SectorBest } from '@/lib/types'

type QSession = 'Qualifying' | 'Sprint Shootout' | 'Sprint Qualifying'
const Q_STAGES = ['Q1', 'Q2', 'Q3'] as const
type QStage = typeof Q_STAGES[number]

const SECTOR_COLOR_MAP: Record<string, string> = {
  purple: 'var(--sector-purple)',
  green: 'var(--sector-green)',
  yellow: 'var(--sector-yellow)',
}

const SECTOR_FIELDS = [
  { key: 'best_s1' as const, label: 'S1' },
  { key: 'best_s2' as const, label: 'S2' },
  { key: 'best_s3' as const, label: 'S3' },
]

/* ---------- small building blocks ---------- */

function HeaderStat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="glass-card" style={{ padding: '10px 16px', minWidth: 108 }}>
      <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>{label}</div>
      <div className="stat-num" style={{ fontSize: 17, marginTop: 3, color: accent || 'var(--foreground)', whiteSpace: 'nowrap' }}>{value}</div>
    </div>
  )
}

/* Segmented control per DESIGN.md §7 */
function SegmentedControl<T extends string>({ options, value, onChange, wrap }: {
  options: readonly T[]; value: T; onChange: (v: T) => void; wrap?: boolean
}) {
  return (
    <div style={{
      display: wrap ? 'flex' : 'inline-flex', flexWrap: wrap ? 'wrap' : 'nowrap',
      gap: 3, padding: 3, background: 'var(--surface)', border: '1px solid var(--border)', width: wrap ? 'fit-content' : undefined,
    }}>
      {options.map(o => (
        <button key={o} onClick={() => onChange(o)} style={{
          padding: '7px 15px', border: 'none', cursor: 'pointer',
          fontFamily: 'var(--font-display)', fontSize: 11, fontWeight: 600,
          letterSpacing: '0.06em', textTransform: 'uppercase',
          background: value === o ? 'var(--accent)' : 'transparent',
          color: value === o ? '#fff' : 'var(--muted)',
        }}>{o}</button>
      ))}
    </div>
  )
}

/* Marked divider row for the Q1/Q2 elimination cuts */
function CutRow({ label, sub, active }: { label: string; sub: string; active: boolean }) {
  return (
    <tr>
      <td colSpan={9} style={{ padding: 0, border: 'none' }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, padding: '6px 12px',
          background: active ? 'rgba(225,6,0,0.10)' : 'var(--surface)',
          borderTop: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
          borderBottom: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
        }}>
          <span className="font-num" style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', color: active ? 'var(--accent)' : 'var(--muted)' }}>{label}</span>
          <span style={{ fontSize: 10, color: 'var(--muted)' }}>{sub}</span>
        </div>
      </td>
    </tr>
  )
}

export default function QualifyingDashboard() {
  const params = useParams()
  const round = params.round as string

  const [sessionType, setSessionType] = useState<QSession>('Qualifying')
  const [tab, setTab] = useState<QStage>('Q1')

  // Only offer the sprint-qualifying variants on an actual sprint weekend —
  // otherwise those buttons load a session that doesn't exist.
  const { data: calendarData } = useCalendar(2026)
  const isSprintWeekend = !!calendarData.find(e => String(e.round) === String(round))?.is_sprint

  // SWR keys each request by round + session, so clicking through the session
  // chips while a cold fastf1 load is in flight can no longer paint whichever
  // response lands last.
  const enc = encodeURIComponent(sessionType)
  const { data: allLaps, isLoading: lapsLoading } = useApiList<LapData>(`/api/sessions/2026/${round}/${enc}/laps`)
  const { data: bestSectors, isLoading: sectorsLoading } = useApiList<SectorBest>(`/api/sessions/2026/${round}/${enc}/best-sectors`)
  const loading = (lapsLoading && allLaps.length === 0) || (sectorsLoading && bestSectors.length === 0)

  // A non-sprint round can't show sprint sessions — snap back if the weekend
  // turns out to be conventional after the chip was already selected.
  useEffect(() => {
    if (!isSprintWeekend && sessionType !== 'Qualifying') setSessionType('Qualifying')
  }, [isSprintWeekend, sessionType])

  // Group laps into Q1/Q2/Q3 by timing — Q1 = laps in first 18min window, etc.
  // Since FastF1 returns all Q laps with session_time, group by driver best per each Q stage
  // Simplification: group by lap position in session — first 20, next 15, last 10 drivers ranked
  const bestByDriver: Record<string, LapData & { count: number }> = {}
  allLaps.forEach(lap => {
    if (!lap.lap_time_seconds || lap.lap_time_seconds > 200) return
    const ex = bestByDriver[lap.driver]
    if (!ex) bestByDriver[lap.driver] = { ...lap, count: 1 }
    else {
      ex.count++
      if (lap.lap_time_seconds < ex.lap_time_seconds!) Object.assign(ex, lap)
    }
  })
  const ranked = Object.values(bestByDriver).sort((a, b) => (a.lap_time_seconds || 99) - (b.lap_time_seconds || 99))

  // Ideal lap from best sectors — Infinity marks "no data for this sector" so a
  // missing sector can never leak a bogus 99.000s into the theoretical lap.
  const idealRaw = bestSectors.length > 0
    ? bestSectors.reduce((best, row) => ({
      s1: Math.min(best.s1, row.best_s1 ?? Infinity),
      s2: Math.min(best.s2, row.best_s2 ?? Infinity),
      s3: Math.min(best.s3, row.best_s3 ?? Infinity),
    }), { s1: Infinity, s2: Infinity, s3: Infinity })
    : null
  const idealTime = idealRaw && Number.isFinite(idealRaw.s1) && Number.isFinite(idealRaw.s2) && Number.isFinite(idealRaw.s3)
    ? idealRaw
    : null

  const paceRef = ranked[0]?.lap_time_seconds

  const gapP1P2 = ranked.length > 1 && paceRef && ranked[1].lap_time_seconds
    ? ranked[1].lap_time_seconds - paceRef
    : null
  const maxGap = Math.max(
    ...ranked.slice(1).map(r => (paceRef && r.lap_time_seconds ? r.lap_time_seconds - paceRef : 0)),
    0.001
  )

  const sectorLeaders = SECTOR_FIELDS.map(({ key, label }) => {
    const best = bestSectors.reduce<{ driver: string; val: number } | null>((acc, row) => {
      const v = row[key]
      if (typeof v === 'number' && (!acc || v < acc.val)) return { driver: row.driver, val: v }
      return acc
    }, null)
    return { label, best }
  })

  const sessionOptions = (isSprintWeekend
    ? ['Qualifying', 'Sprint Qualifying', 'Sprint Shootout']
    : ['Qualifying']) as QSession[]

  const buildRow = (row: LapData & { count: number }, i: number) => {
    const gap = paceRef && row.lap_time_seconds ? row.lap_time_seconds - paceRef : 0
    const isElimQ2 = i >= 10
    const color = TEAM_COLORS[row.team || ''] || '#555'
    const driverSectors = bestSectors.find(s => s.driver === row.driver)
    const barPct = i === 0 ? 0 : Math.min(100, (gap / maxGap) * 100)
    return (
      <motion.tr
        key={row.driver}
        initial={{ opacity: 0, x: -10 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ delay: Math.min(i * 0.02, 0.4) }}
        style={{ opacity: isElimQ2 && tab === 'Q3' ? 0.4 : 1 }}
      >
        <td className="font-num" style={{ fontWeight: 700 }}>
          {i === 0 ? <span style={{ color: 'var(--amber)' }}>P{i + 1}</span> : `P${i + 1}`}
          {i >= 15 && tab === 'Q1' && <span style={{ fontSize: 9, color: 'var(--accent)', marginLeft: 5, fontWeight: 700 }}>OUT</span>}
          {i >= 10 && tab === 'Q2' && <span style={{ fontSize: 9, color: 'var(--accent)', marginLeft: 5, fontWeight: 700 }}>OUT</span>}
        </td>
        <td>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 3, height: 16, background: color, flexShrink: 0 }} />
            <span style={{ fontWeight: 700 }}>{row.driver}</span>
          </div>
        </td>
        <td className="font-num" style={{ fontWeight: 700, color: i === 0 ? 'var(--sector-purple)' : 'var(--foreground)' }}>
          {row.lap_time_seconds ? formatLapTime(row.lap_time_seconds) : '—'}
        </td>
        <td>
          <div className="font-num" style={{ fontSize: 12, color: i === 0 ? 'var(--amber)' : 'var(--muted)' }}>
            {i === 0 ? 'POLE' : gap > 0 ? `+${gap.toFixed(3)}` : '—'}
          </div>
          {i !== 0 && (
            <div style={{ height: 3, width: 64, marginTop: 5, background: 'var(--hairline)' }}>
              <div style={{ height: '100%', width: `${barPct}%`, background: 'var(--accent)' }} />
            </div>
          )}
        </td>
        {[
          { val: driverSectors?.best_s1, color: driverSectors?.best_s1_color },
          { val: driverSectors?.best_s2, color: driverSectors?.best_s2_color },
          { val: driverSectors?.best_s3, color: driverSectors?.best_s3_color },
        ].map((s, si) => (
          <td key={si} className="font-num" style={{ fontSize: 11, color: s.color ? SECTOR_COLOR_MAP[s.color] : 'var(--muted)' }}>
            {s.val?.toFixed(3) || '—'}
          </td>
        ))}
        <td className="font-num" style={{ color: 'var(--muted)' }}>{row.count}</td>
        <td>
          {row.compound && (
            <span style={{
              width: 20, height: 20, borderRadius: '50%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              fontWeight: 700, fontSize: 10,
              background: COMPOUND_COLORS[row.compound as keyof typeof COMPOUND_COLORS] || '#555',
              color: ['MEDIUM', 'HARD'].includes(row.compound) ? '#000' : '#fff',
            }}>{row.compound[0]}</span>
          )}
        </td>
      </motion.tr>
    )
  }

  return (
    <div style={{ maxWidth: '1560px', margin: '0 auto', padding: '26px clamp(16px, 3vw, 34px) 40px', position: 'relative', zIndex: 1 }}>
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 20, flexWrap: 'wrap', marginBottom: 22 }}
      >
        <div>
          <div className="kicker" style={{ marginBottom: 8 }}>R{round} · 2026 F1</div>
          <h1 className="display-title" style={{ fontSize: 'clamp(26px, 4.2vw, 44px)', margin: 0 }}>{sessionType}</h1>
          <p style={{ color: 'var(--muted)', fontSize: 13, margin: '7px 0 0', maxWidth: 640 }}>
            Best lap per driver across the full session. Purple/green sector splits and elimination cuts track the Q-stage selector on the right.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <HeaderStat label="Pole" value={ranked[0]?.driver ?? '—'} accent="var(--amber)" />
          <HeaderStat label="Pole Time" value={ranked[0]?.lap_time_seconds != null ? formatLapTime(ranked[0].lap_time_seconds) : '—'} accent="var(--sector-purple)" />
          <HeaderStat label="P1 → P2 Gap" value={gapP1P2 != null ? `+${gapP1P2.toFixed(3)}` : '—'} />
          <HeaderStat label="Session" value={sessionType} />
        </div>
      </motion.div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2.4fr) minmax(280px, 1fr)', gap: 16, alignItems: 'start' }} className="live-grid">
        {/* ---- Main column ---- */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {loading ? (
            <>
              <div className="shimmer" style={{ height: 140 }} />
              <div className="shimmer" style={{ height: 420 }} />
            </>
          ) : ranked.length === 0 ? (
            <div className="glass-card" style={{ padding: '56px 24px', textAlign: 'center' }}>
              <Flag size={26} style={{ color: 'var(--muted)', marginBottom: 12 }} />
              <div style={{ fontSize: 14, fontWeight: 600 }}>No qualifying data available</div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 6 }}>
                This session may not have run yet, or FastF1 hasn&apos;t cached it.
              </div>
            </div>
          ) : (
            <>
              {/* Theoretical ideal lap — featured block */}
              {idealTime && (
                <motion.div
                  initial={{ opacity: 0, y: 14 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="featured-card"
                  style={{ padding: 20 }}
                >
                  <h2 className="section-title" style={{ marginBottom: 14, ['--bar' as string]: 'var(--sector-purple)' }}>
                    <Zap size={13} />
                    Theoretical Ideal Lap
                  </h2>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 16, flexWrap: 'wrap', marginBottom: 16 }}>
                    <div className="stat-num" style={{ fontSize: 38, color: 'var(--sector-purple)' }}>
                      {formatLapTime(idealTime.s1 + idealTime.s2 + idealTime.s3)}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--muted)', maxWidth: 340 }}>
                      Best possible lap combining each driver&apos;s fastest recorded sector this session.
                    </div>
                  </div>
                  <div style={{ display: 'flex', height: 34, overflow: 'hidden', border: '1px solid var(--border)' }}>
                    {[
                      { label: 'S1', v: idealTime.s1, op: 1 },
                      { label: 'S2', v: idealTime.s2, op: 0.72 },
                      { label: 'S3', v: idealTime.s3, op: 0.48 },
                    ].map((seg, i) => {
                      const total = idealTime.s1 + idealTime.s2 + idealTime.s3
                      const pct = (seg.v / total) * 100
                      return (
                        <div
                          key={seg.label}
                          style={{
                            width: `${pct}%`, background: 'var(--sector-purple)', opacity: seg.op,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            borderRight: i < 2 ? '1px solid var(--background)' : 'none',
                          }}
                        >
                          <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', color: '#fff' }}>{seg.label}</span>
                        </div>
                      )
                    })}
                  </div>
                  <div style={{ display: 'flex', gap: 24, marginTop: 12, flexWrap: 'wrap' }}>
                    {[
                      { label: 'S1', v: idealTime.s1 },
                      { label: 'S2', v: idealTime.s2 },
                      { label: 'S3', v: idealTime.s3 },
                    ].map(s => (
                      <div key={s.label}>
                        <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{s.label}</div>
                        <div className="font-num" style={{ fontSize: 15, fontWeight: 700, color: 'var(--sector-purple)' }}>{s.v.toFixed(3)}</div>
                      </div>
                    ))}
                  </div>
                </motion.div>
              )}

              {/* Results table */}
              <div className="glass-card" style={{ overflow: 'hidden' }}>
                <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                  <h2 className="section-title">
                    <Flag size={13} />
                    Results — {sessionType}
                  </h2>
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>{ranked.length} drivers classified</div>
                </div>
                <div style={{ overflowX: 'auto' }}>
                  <table className="f1-table">
                    <thead>
                      <tr>
                        <th>POS</th><th>DRIVER</th><th>BEST LAP</th><th>GAP TO POLE</th>
                        <th>S1</th><th>S2</th><th>S3</th>
                        <th>LAPS</th><th>COMPOUND</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ranked.flatMap((row, i) => {
                        const els: React.ReactNode[] = [buildRow(row, i)]
                        if (i === 14 && ranked.length > 15) {
                          els.push(<CutRow key="cut-q1" label="Q1 CUT" sub="P16–20 eliminated" active={tab === 'Q1'} />)
                        }
                        if (i === 9 && ranked.length > 10) {
                          els.push(<CutRow key="cut-q2" label="Q2 CUT" sub="P11–15 eliminated" active={tab === 'Q2'} />)
                        }
                        return els
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>

        {/* ---- Rail ---- */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="glass-card" style={{ padding: 16 }}>
            <h2 className="section-title" style={{ marginBottom: 12 }}>
              <Radio size={13} />
              Session
            </h2>
            <SegmentedControl options={sessionOptions} value={sessionType} onChange={setSessionType} wrap />
          </div>

          <div className="glass-card" style={{ padding: 16 }}>
            <h2 className="section-title" style={{ marginBottom: 12 }}>
              <Flag size={13} />
              Stage
            </h2>
            <SegmentedControl options={Q_STAGES} value={tab} onChange={setTab} />
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 10 }}>
              {tab === 'Q1' ? 'P16+ eliminated' : tab === 'Q2' ? 'P11+ eliminated' : 'Top 10 shoot-out'}
            </div>
          </div>

          <div className="glass-card" style={{ padding: 16 }}>
            <h2 className="section-title" style={{ marginBottom: 12, ['--bar' as string]: 'var(--sector-purple)' }}>
              <Zap size={13} />
              Sector Leaders
            </h2>
            {bestSectors.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>No sector data yet.</div>
            ) : (
              <div style={{ display: 'grid', gap: 10 }}>
                {sectorLeaders.map(sl => (
                  <div key={sl.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em', minWidth: 20 }}>{sl.label}</span>
                    <span style={{ fontWeight: 700, fontSize: 13, flex: 1 }}>{sl.best?.driver ?? '—'}</span>
                    <span className="font-num" style={{ fontSize: 12, color: 'var(--sector-purple)' }}>{sl.best ? sl.best.val.toFixed(3) : '—'}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={{ fontSize: 11, color: 'var(--muted)', padding: '2px 4px' }}>
            Showing best lap per driver across full session · Deleted laps excluded by FastF1
          </div>
        </div>
      </div>
    </div>
  )
}
