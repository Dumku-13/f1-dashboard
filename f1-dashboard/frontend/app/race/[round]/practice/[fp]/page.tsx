'use client'

import { useState } from 'react'
import { useParams } from 'next/navigation'
import { motion } from 'framer-motion'
import { Timer, Zap, Layers, Info, Gauge } from 'lucide-react'
import { formatLapTime } from '@/lib/ist'
import { TEAM_COLORS, COMPOUND_COLORS } from '@/lib/constants'
import { useApiList } from '@/lib/api/client'
import type { LapData, SectorBest, Stint } from '@/lib/types'

const SECTOR_COLOR_MAP: Record<string, string> = {
  purple: 'var(--sector-purple)',
  green: 'var(--sector-green)',
  yellow: 'var(--sector-yellow)',
}

const TABS = ['timing', 'sectors', 'stints'] as const
type Tab = typeof TABS[number]

/* ---------- small building blocks ---------- */

function HeaderStat({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <div className="glass-card" style={{ padding: '10px 16px', minWidth: 112 }}>
      <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>{label}</div>
      <div className="stat-num" style={{ fontSize: 17, marginTop: 3, color: accent || 'var(--foreground)', whiteSpace: 'nowrap' }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

/* Segmented control per DESIGN.md §7 */
function TabBar({ tab, onChange }: { tab: Tab; onChange: (t: Tab) => void }) {
  return (
    <div style={{ display: 'inline-flex', gap: 3, padding: 3, background: 'var(--surface)', border: '1px solid var(--border)' }}>
      {TABS.map(t => (
        <button key={t} onClick={() => onChange(t)} style={{
          padding: '7px 16px', border: 'none', cursor: 'pointer',
          fontFamily: 'var(--font-display)', fontSize: 12, fontWeight: 600,
          letterSpacing: '0.06em', textTransform: 'uppercase',
          background: tab === t ? 'var(--accent)' : 'transparent',
          color: tab === t ? '#fff' : 'var(--muted)',
        }}>{t}</button>
      ))}
    </div>
  )
}

function TelemetryBar({ value, max, color }: { value: number; max: number; color: string }) {
  return (
    <div style={{ height: 4, background: 'var(--hairline)', overflow: 'hidden', width: 60 }}>
      <div style={{ height: '100%', width: `${Math.min(100, (value / max) * 100)}%`, background: color }} />
    </div>
  )
}

export default function PracticeDashboard() {
  const params = useParams()
  const round = params.round as string
  const fp = params.fp as string

  const sessionType = `Practice ${fp}`
  const [tab, setTab] = useState<Tab>('timing')

  const enc = encodeURIComponent(sessionType)
  const { data: laps, isLoading: lapsLoading, error: lapsErr } = useApiList<LapData>(`/api/sessions/2026/${round}/${enc}/laps`)
  const { data: bestSectors, isLoading: sectorsLoading, error: sectorsErr } = useApiList<SectorBest>(`/api/sessions/2026/${round}/${enc}/best-sectors`)
  const { data: stints, isLoading: stintsLoading, error: stintsErr } = useApiList<Stint>(`/api/sessions/2026/${round}/${enc}/stints`)
  const loading =
    (lapsLoading && laps.length === 0) ||
    (sectorsLoading && bestSectors.length === 0) ||
    (stintsLoading && stints.length === 0)
  const fetchError = lapsErr || sectorsErr || stintsErr
  const error = fetchError ? String(fetchError) : null

  // Build timing table from laps — best lap per driver
  const bestByDriver: Record<string, LapData> = {}
  laps.forEach(lap => {
    if (!lap.lap_time_seconds) return
    const curr = bestByDriver[lap.driver]
    if (!curr || lap.lap_time_seconds < curr.lap_time_seconds!) {
      bestByDriver[lap.driver] = lap
    }
  })
  const timingRows = Object.values(bestByDriver).sort((a, b) => (a.lap_time_seconds || 99) - (b.lap_time_seconds || 99))
  const paceRef = timingRows[0]?.lap_time_seconds

  // KPI: most laps run
  const lapCounts: Record<string, number> = {}
  laps.forEach(l => { lapCounts[l.driver] = (lapCounts[l.driver] || 0) + 1 })
  const mostLaps = Object.entries(lapCounts).sort((a, b) => b[1] - a[1])[0]

  // Rail: compound legend — every compound actually run this session
  const compoundsUsed = Array.from(new Set(stints.map(s => s.compound).filter(Boolean)))

  // Rail: longest single run
  const longestStint = stints.reduce<(Stint & { laps: number }) | null>((best, s) => {
    const len = (s.lap_end - s.lap_start) + 1
    if (!best || len > best.laps) return { ...s, laps: len }
    return best
  }, null)

  const stintsByDriver = stints.reduce((acc, s) => {
    if (!acc[s.driver]) acc[s.driver] = []
    acc[s.driver].push(s)
    return acc
  }, {} as Record<string, Stint[]>)
  const maxStintLen = Math.max(...stints.map(s => (s.lap_end - s.lap_start) + 1), 1)

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
          <h1 className="display-title" style={{ fontSize: 'clamp(26px, 4.2vw, 44px)', margin: 0 }}>Practice {fp}</h1>
          <p style={{ color: 'var(--muted)', fontSize: 13, margin: '7px 0 0', maxWidth: 640 }}>
            Best lap per driver, sector splits and tyre stints for the session — switch tabs to drill in.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <HeaderStat
            label="Fastest Lap"
            value={timingRows[0]?.lap_time_seconds != null ? formatLapTime(timingRows[0].lap_time_seconds) : '—'}
            sub={timingRows[0]?.driver}
            accent="var(--sector-purple)"
          />
          <HeaderStat label="Most Laps" value={mostLaps ? String(mostLaps[1]) : '—'} sub={mostLaps?.[0]} />
          <HeaderStat label="Session" value={sessionType} />
        </div>
      </motion.div>

      {/* Tabs */}
      <div style={{ marginBottom: 20 }}>
        <TabBar tab={tab} onChange={setTab} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2.4fr) minmax(280px, 1fr)', gap: 16, alignItems: 'start' }} className="live-grid">
        {/* ---- Main column ---- */}
        <div>
          {loading ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div className="shimmer" style={{ height: 420 }} />
              <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                FastF1 will download this session on first access — may take 30–60s.
              </div>
            </div>
          ) : error ? (
            <div className="glass-card" style={{ padding: '40px 24px', textAlign: 'center', borderLeft: '2px solid var(--accent)' }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--accent)' }}>Couldn&apos;t load session data</div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 6 }}>{error}</div>
            </div>
          ) : timingRows.length === 0 ? (
            <div className="glass-card" style={{ padding: '56px 24px', textAlign: 'center' }}>
              <Timer size={26} style={{ color: 'var(--muted)', marginBottom: 12 }} />
              <div style={{ fontSize: 14, fontWeight: 600 }}>No data available</div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 6 }}>Session may not have started yet.</div>
            </div>
          ) : tab === 'timing' ? (
            <div className="glass-card" style={{ overflow: 'hidden' }}>
              <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)' }}>
                <h2 className="section-title">
                  <Timer size={13} />
                  Best Lap — {sessionType}
                </h2>
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table className="f1-table">
                  <thead>
                    <tr>
                      <th>POS</th><th>DRIVER</th><th>BEST LAP</th><th>GAP</th><th>LAPS</th><th>COMPOUND</th><th>SPEED TRAP</th>
                    </tr>
                  </thead>
                  <tbody>
                    {timingRows.map((row, i) => {
                      const gap = paceRef && row.lap_time_seconds ? row.lap_time_seconds - paceRef : 0
                      const color = TEAM_COLORS[row.team || ''] || '#555'
                      return (
                        <motion.tr
                          key={row.driver}
                          initial={{ opacity: 0, x: -10 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: Math.min(i * 0.02, 0.4) }}
                        >
                          <td className="font-num" style={{ color: 'var(--muted)', fontWeight: 700 }}>
                            {i === 0 ? <span style={{ color: 'var(--amber)' }}>{i + 1}</span> : i + 1}
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
                          <td className="font-num" style={{ color: 'var(--muted)' }}>
                            {i === 0 ? '—' : gap > 0 ? `+${gap.toFixed(3)}` : '—'}
                          </td>
                          <td className="font-num" style={{ color: 'var(--muted)' }}>{laps.filter(l => l.driver === row.driver).length}</td>
                          <td>
                            {row.compound && (
                              <span style={{
                                width: 20, height: 20, borderRadius: '50%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                                fontWeight: 700, fontSize: 10,
                                background: COMPOUND_COLORS[row.compound as keyof typeof COMPOUND_COLORS] || '#555',
                                color: row.compound === 'MEDIUM' ? '#000' : row.compound === 'HARD' ? '#000' : '#fff',
                              }}>
                                {row.compound[0]}
                              </span>
                            )}
                          </td>
                          <td className="font-num" style={{ color: 'var(--muted)' }}>
                            {row.speed_trap ? `${row.speed_trap} km/h` : '—'}
                          </td>
                        </motion.tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ) : tab === 'sectors' ? (
            <div className="glass-card" style={{ overflow: 'hidden' }}>
              <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)' }}>
                <h2 className="section-title" style={{ ['--bar' as string]: 'var(--sector-purple)' }}>
                  <Zap size={13} />
                  Best Sectors — {sessionType}
                </h2>
              </div>
              {bestSectors.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 40, color: 'var(--muted)', fontSize: 12 }}>Sector data not available</div>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table className="f1-table">
                    <thead>
                      <tr><th>DRIVER</th><th>S1</th><th>S2</th><th>S3</th><th>THEORETICAL BEST</th></tr>
                    </thead>
                    <tbody>
                      {bestSectors.map((row, i) => {
                        const theoretical = (row.best_s1 || 0) + (row.best_s2 || 0) + (row.best_s3 || 0)
                        const sColors = [row.best_s1_color, row.best_s2_color, row.best_s3_color]
                        const sVals = [row.best_s1, row.best_s2, row.best_s3]
                        return (
                          <motion.tr
                            key={row.driver}
                            initial={{ opacity: 0, x: -10 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ delay: Math.min(i * 0.02, 0.4) }}
                          >
                            <td style={{ fontWeight: 700 }}>{row.driver}</td>
                            {sVals.map((val, si) => (
                              <td key={si} className="font-num" style={{ color: sColors[si] ? SECTOR_COLOR_MAP[sColors[si] as string] : 'var(--muted)' }}>
                                {val ? val.toFixed(3) : '—'}
                              </td>
                            ))}
                            <td className="font-num" style={{ color: 'var(--muted)' }}>
                              {theoretical > 0 ? formatLapTime(theoretical) : '—'}
                            </td>
                          </motion.tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ) : (
            /* Stints */
            <div className="glass-card" style={{ padding: 18 }}>
              <h2 className="section-title" style={{ marginBottom: 14 }}>
                <Layers size={13} />
                Tyre Stints — {sessionType}
              </h2>
              {stints.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 40, color: 'var(--muted)', fontSize: 12 }}>Stint data not available</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {Object.entries(stintsByDriver).map(([driver, driverStints], di) => (
                    <motion.div
                      key={driver}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: Math.min(di * 0.03, 0.4) }}
                      style={{ background: 'var(--surface)', border: '1px solid var(--border)', padding: '12px 16px' }}
                    >
                      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>{driver}</div>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {driverStints.map((s, i) => {
                          const cmpColor = COMPOUND_COLORS[s.compound as keyof typeof COMPOUND_COLORS] || '#555'
                          const stintLen = (s.lap_end - s.lap_start) + 1
                          return (
                            <div key={i} style={{ background: 'var(--card)', border: '1px solid var(--border)', padding: '6px 10px', fontSize: 12, minWidth: 76 }}>
                              <span style={{ width: 14, height: 14, borderRadius: '50%', background: cmpColor, display: 'inline-block', marginRight: 5, verticalAlign: 'middle' }} />
                              <span className="font-num" style={{ color: 'var(--muted)' }}>{s.lap_start}–{s.lap_end}</span>
                              <div className="font-num" style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>Age: {s.tyre_age_at_start || 0}→{s.tyre_age_at_end || 0}</div>
                              <div style={{ marginTop: 6 }}>
                                <TelemetryBar value={stintLen} max={maxStintLen} color={cmpColor} />
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </motion.div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ---- Rail ---- */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="glass-card" style={{ padding: 16 }}>
            <h2 className="section-title" style={{ marginBottom: 12 }}>
              <Gauge size={13} />
              Compound Legend
            </h2>
            {compoundsUsed.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>No stint data yet.</div>
            ) : (
              <div style={{ display: 'grid', gap: 8 }}>
                {compoundsUsed.map(c => (
                  <div key={c} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{
                      width: 14, height: 14, borderRadius: '50%', flexShrink: 0,
                      background: COMPOUND_COLORS[c as keyof typeof COMPOUND_COLORS] || '#555',
                      border: '1px solid var(--border)',
                    }} />
                    <span style={{ fontSize: 12, color: 'var(--foreground)' }}>{c}</span>
                    <span className="font-num" style={{ fontSize: 11, color: 'var(--muted)', marginLeft: 'auto' }}>
                      {stints.filter(s => s.compound === c).length} stint{stints.filter(s => s.compound === c).length === 1 ? '' : 's'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="glass-card" style={{ padding: 16 }}>
            <h2 className="section-title" style={{ marginBottom: 12 }}>
              <Layers size={13} />
              Longest Run
            </h2>
            {longestStint ? (
              <div>
                <div style={{ fontWeight: 700, fontSize: 14 }}>{longestStint.driver}</div>
                <div className="font-num" style={{ fontSize: 22, fontWeight: 700, marginTop: 4 }}>{longestStint.laps} laps</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
                  <span style={{
                    width: 12, height: 12, borderRadius: '50%', flexShrink: 0,
                    background: COMPOUND_COLORS[longestStint.compound as keyof typeof COMPOUND_COLORS] || '#555',
                    border: '1px solid var(--border)',
                  }} />
                  <span style={{ fontSize: 12, color: 'var(--muted)' }}>{longestStint.compound} · laps {longestStint.lap_start}–{longestStint.lap_end}</span>
                </div>
              </div>
            ) : (
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>No stint data yet.</div>
            )}
          </div>

          <div className="glass-card" style={{ padding: 16 }}>
            <h2 className="section-title" style={{ marginBottom: 12 }}>
              <Info size={13} />
              Session Notes
            </h2>
            <div style={{ fontSize: 11.5, color: 'var(--muted)', lineHeight: 1.6 }}>
              Best lap is the fastest valid lap per driver across the whole session — not just a single run.
              Sector splits come from the best-sectors endpoint; theoretical best combines each driver&apos;s
              own fastest sectors. First load of a session can take 30–60s while FastF1 downloads and caches it.
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
