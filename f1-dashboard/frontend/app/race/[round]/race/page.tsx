'use client'

import { useState } from 'react'
import { useParams } from 'next/navigation'
import { motion } from 'framer-motion'
import { Flag, Zap, Users, ShieldAlert, Radio, CloudSun } from 'lucide-react'
import { formatLapTime } from '@/lib/ist'
import { TEAM_COLORS, COMPOUND_COLORS } from '@/lib/constants'
import { isClassifiedFinish } from '@/lib/utils'
import { useApiList } from '@/lib/api/client'
import type { SessionResult, Stint, RaceControlMessage, WeatherData } from '@/lib/types'

const STATUS_COLOR: Record<string, string> = {
  'Finished': 'var(--sector-green)', 'Retired': 'var(--accent)', '+1 Lap': 'var(--muted)', '+2 Laps': 'var(--muted)',
}
const MEDAL = ['#FFD700', '#C0C0C0', '#CD7F32']
const FLAG_COLORS: Record<string, string> = {
  'YELLOW': 'var(--sector-yellow)', 'DOUBLE YELLOW': 'var(--sector-yellow)', 'RED': 'var(--accent)',
  'SC DEPLOYED': 'var(--amber)', 'VIRTUAL SC DEPLOYED': 'var(--amber)',
  'CLEAR': 'var(--sector-green)', 'CHEQUERED': 'var(--foreground)',
}

/* Compact header readout — DESIGN.md §2 */
function HeaderStat({ label, value, accent }: { label: string; value: React.ReactNode; accent?: string }) {
  return (
    <div style={{ padding: '9px 16px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 2, minWidth: 96, textAlign: 'center' }}>
      <div className="font-num stat-num" style={{ fontSize: 18, color: accent || 'var(--foreground)' }}>{value}</div>
      <div style={{ fontSize: 9, color: 'var(--muted)', letterSpacing: '0.12em', textTransform: 'uppercase', marginTop: 3 }}>{label}</div>
    </div>
  )
}

function TyreBar({ stints }: { stints: Stint[] }) {
  if (!stints.length) return null
  const total = stints[stints.length - 1]?.lap_end || 1
  return (
    <div style={{ display: 'flex', height: '9px', overflow: 'hidden', width: '130px', background: 'var(--surface)', border: '1px solid var(--hairline)' }}>
      {stints.map((s, i) => {
        const width = ((s.lap_end - s.lap_start + 1) / total) * 100
        const cmpColor = COMPOUND_COLORS[s.compound as keyof typeof COMPOUND_COLORS] || '#555'
        return <div key={i} style={{ width: `${width}%`, background: cmpColor }} title={`${s.compound}: L${s.lap_start}–${s.lap_end}`} />
      })}
    </div>
  )
}

/* Featured podium — P1/P2/P3 with team colours */
function PodiumBlock({ results }: { results: SessionResult[] }) {
  const top3 = results.slice(0, 3)
  if (top3.length < 1) return null
  return (
    <div className="featured-card" style={{ padding: 20, marginBottom: 16 }}>
      <h2 className="section-title" style={{ marginBottom: 16 }}>
        <Flag size={13} style={{ marginRight: -4 }} />
        Podium
      </h2>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${top3.length}, minmax(0, 1fr))`, gap: 14 }}>
        {top3.map((r, i) => {
          const color = TEAM_COLORS[r.team || ''] || '#555'
          return (
            <motion.div
              key={r.driver || i}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.06 }}
              style={{
                padding: '18px 14px', textAlign: 'center', background: 'var(--surface)',
                border: `1px solid ${i === 0 ? MEDAL[0] : 'var(--border)'}`, borderTop: `3px solid ${MEDAL[i]}`,
              }}
            >
              <div className="font-num" style={{ fontSize: 11, color: MEDAL[i], fontWeight: 700, marginBottom: 8, letterSpacing: '0.08em' }}>P{r.position}</div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 6 }}>
                <span style={{ width: 3, height: 18, background: color, display: 'inline-block', flexShrink: 0 }} />
                <span className="font-display" style={{ fontWeight: 800, fontSize: i === 0 ? 21 : 16 }}>{r.abbreviation || r.driver}</span>
              </div>
              <div style={{ fontSize: 11, color: 'var(--muted)' }}>{r.team}</div>
              {r.points != null && (
                <div className="font-num" style={{ fontSize: 13, color: 'var(--foreground)', marginTop: 8, fontWeight: 700 }}>{r.points} PTS</div>
              )}
            </motion.div>
          )
        })}
      </div>
    </div>
  )
}

export default function RaceDashboard() {
  const params = useParams()
  const round = params.round as string

  const [tab, setTab] = useState<'results' | 'stints' | 'control' | 'weather'>('results')

  // Cold fastf1 loads take 15-60s. SWR keys each request by round, so
  // switching rounds mid-load can no longer let an older response land last.
  const { data: results, isLoading: resultsLoading } = useApiList<SessionResult>(`/api/sessions/2026/${round}/Race/results`)
  const { data: stints, isLoading: stintsLoading } = useApiList<Stint>(`/api/sessions/2026/${round}/Race/stints`)
  const { data: raceControl, isLoading: rcLoading } = useApiList<RaceControlMessage>(`/api/sessions/2026/${round}/Race/race-control`)
  const { data: weather, isLoading: weatherLoading } = useApiList<WeatherData>(`/api/sessions/2026/${round}/Race/weather`)
  const loading =
    (resultsLoading && results.length === 0) ||
    (stintsLoading && stints.length === 0) ||
    (rcLoading && raceControl.length === 0) ||
    (weatherLoading && weather.length === 0)

  // Build tyre strategy per driver
  const stintsByDriver: Record<string, Stint[]> = {}
  stints.forEach(s => {
    if (!stintsByDriver[s.driver]) stintsByDriver[s.driver] = []
    stintsByDriver[s.driver].push(s)
  })

  const winner = results[0]
  const fastestLapRow = results.find(r => r.fastest_lap)
  // Lapped runners are classified finishers too — see isClassifiedFinish.
  const finishers = results.filter(r => isClassifiedFinish(r.status)).length
  const scEvents = raceControl.filter(m => (m.flag || '').toUpperCase().includes('SC DEPLOYED')).length

  const tabs = [
    { id: 'results' as const, label: 'Results', icon: Flag },
    { id: 'stints' as const, label: 'Stints', icon: Zap },
    { id: 'control' as const, label: 'Race Control', icon: Radio },
    { id: 'weather' as const, label: 'Weather', icon: CloudSun },
  ]

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
          <h1 className="display-title" style={{ fontSize: 'clamp(26px, 4.2vw, 44px)', margin: 0 }}>Race</h1>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <HeaderStat label="Winner" value={winner ? (winner.abbreviation || winner.driver) : '—'} accent="#FFD700" />
          <HeaderStat label="Fastest Lap" value={fastestLapRow ? (fastestLapRow.abbreviation || fastestLapRow.driver) : '—'} accent="var(--sector-purple)" />
          <HeaderStat label="Finishers" value={results.length ? finishers : '—'} />
          <HeaderStat label="SC/VSC" value={scEvents} accent={scEvents > 0 ? 'var(--amber)' : undefined} />
        </div>
      </motion.div>

      {loading ? (
        <>
          <div className="shimmer" style={{ height: 150, borderRadius: 2, marginBottom: 16 }} />
          <div className="shimmer" style={{ height: 60, width: 320, borderRadius: 2, marginBottom: 16 }} />
          <div className="shimmer" style={{ height: 380, borderRadius: 2 }} />
        </>
      ) : results.length === 0 ? (
        <div className="glass-card" style={{ padding: '48px', textAlign: 'center' }}>
          <Flag size={22} style={{ color: 'var(--muted)', marginBottom: 10 }} />
          <div style={{ fontSize: 13, color: 'var(--foreground)', fontWeight: 600, marginBottom: 4 }}>No results yet</div>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>The race may not have started.</div>
        </div>
      ) : (
        <>
          <PodiumBlock results={results} />

          {/* Tabs — DESIGN.md §7 */}
          <div style={{ display: 'inline-flex', gap: 3, padding: 3, background: 'var(--surface)', border: '1px solid var(--border)', marginBottom: 18 }}>
            {tabs.map(t => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                aria-pressed={tab === t.id}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  padding: '7px 16px', border: 'none', cursor: 'pointer',
                  fontFamily: 'var(--font-display)', fontSize: 12, fontWeight: 600,
                  letterSpacing: '0.06em', textTransform: 'uppercase',
                  background: tab === t.id ? 'var(--accent)' : 'transparent',
                  color: tab === t.id ? '#fff' : 'var(--muted)',
                }}
              >
                <t.icon size={12} />
                {t.label}
              </button>
            ))}
          </div>

          {tab === 'results' ? (
            <div className="glass-card" style={{ overflow: 'hidden' }}>
              <div style={{ overflowX: 'auto' }}>
                <table className="f1-table">
                  <thead>
                    <tr>
                      <th>POS</th><th>DRIVER</th><th>TEAM</th>
                      <th>GRID</th><th>POINTS</th><th>BEST LAP</th>
                      <th>FASTEST</th><th>STATUS</th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.map((r, i) => {
                      const color = TEAM_COLORS[r.team || ''] || '#555'
                      return (
                        <tr key={r.driver || i}>
                          <td className="font-num" style={{ fontWeight: 700 }}>
                            {i < 3 ? <span style={{ color: MEDAL[i] }}>{r.position}</span> : r.position}
                          </td>
                          <td>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <span style={{ width: '3px', height: '16px', background: color, display: 'inline-block', flexShrink: 0 }} />
                              <span style={{ fontWeight: 700 }}>{r.abbreviation || r.driver}</span>
                              {r.fastest_lap && <span style={{ fontSize: '9px', background: 'rgba(191,0,255,0.18)', color: 'var(--sector-purple)', padding: '1px 5px', borderRadius: 2 }}>FL</span>}
                            </div>
                          </td>
                          <td style={{ fontSize: '12px', color: 'var(--muted)' }}>{r.team}</td>
                          <td className="font-num" style={{ color: 'var(--muted)' }}>
                            {r.grid_position != null ? (r.grid_position === 0 ? 'PL' : `P${r.grid_position}`) : '—'}
                          </td>
                          <td className="font-num" style={{ fontWeight: 700 }}>{r.points ?? '—'}</td>
                          <td className="font-num" style={{ color: r.fastest_lap ? 'var(--sector-purple)' : 'var(--muted)' }}>
                            {r.best_lap_time ? formatLapTime(r.best_lap_time) : '—'}
                          </td>
                          <td className="font-num" style={{ color: 'var(--muted)' }}>
                            {r.fastest_lap_time ? formatLapTime(r.fastest_lap_time) : '—'}
                          </td>
                          <td style={{ fontSize: '12px', color: STATUS_COLOR[r.status || ''] || 'var(--muted)' }}>
                            {r.status || '—'}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
                <div style={{ fontSize: '11px', color: 'var(--muted)', padding: '10px 12px' }}>
                  FL = Fastest lap of the race (no championship point since 2025) · Battery SoC not available in public F1 data
                </div>
              </div>
            </div>
          ) : tab === 'stints' ? (
            Object.keys(stintsByDriver).length === 0 ? (
              <div className="glass-card" style={{ padding: '48px', textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>No stint data available</div>
            ) : (
              <div className="glass-card" style={{ overflow: 'hidden' }}>
                <div style={{ overflowX: 'auto' }}>
                  <table className="f1-table">
                    <thead>
                      <tr>
                        <th>DRIVER</th><th>STRATEGY</th><th>STOPS</th>
                        {Array.from({ length: Math.max(...Object.values(stintsByDriver).map(s => s.length)) }, (_, i) => (
                          <th key={i}>STINT {i + 1}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {results.map(r => {
                        const dStints = stintsByDriver[r.abbreviation || r.driver || ''] || []
                        return dStints.length > 0 ? (
                          <tr key={r.driver}>
                            <td style={{ fontWeight: 700 }}>{r.abbreviation || r.driver}</td>
                            <td><TyreBar stints={dStints} /></td>
                            <td className="font-num" style={{ color: 'var(--muted)' }}>{dStints.length - 1}</td>
                            {dStints.map((s, si) => (
                              <td key={si}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px' }}>
                                  <span style={{ width: '12px', height: '12px', background: COMPOUND_COLORS[s.compound as keyof typeof COMPOUND_COLORS] || '#555', display: 'inline-block', flexShrink: 0, border: '1px solid var(--hairline)' }} />
                                  <span className="font-num" style={{ color: 'var(--muted)' }}>L{s.lap_start}–{s.lap_end}</span>
                                </div>
                              </td>
                            ))}
                          </tr>
                        ) : null
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )
          ) : tab === 'control' ? (
            <div className="glass-card" style={{ padding: '0', overflow: 'hidden' }}>
              <div style={{ padding: '12px 18px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <ShieldAlert size={13} style={{ color: 'var(--accent)' }} />
                <h2 className="section-title" style={{ fontSize: '12px' }}>Race Control Log</h2>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {raceControl.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '40px', color: 'var(--muted)', fontSize: '13px' }}>No race control messages</div>
                ) : raceControl.map((msg, i) => {
                  // fastf1 leaves Flag empty on non-flag messages; the API used to
                  // stringify that as "None" — treat both as "no flag chip".
                  const flag = msg.flag && msg.flag !== 'None' ? msg.flag : ''
                  const flagColor = flag ? FLAG_COLORS[flag] || 'var(--muted)' : 'var(--muted)'
                  return (
                    <div key={i} className="chat-bubble" style={{ margin: '5px 10px', borderLeftColor: flag ? flagColor : undefined, display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
                      {flag && (
                        <span className="font-num" style={{ fontSize: '9px', background: 'transparent', border: `1px solid ${flagColor}`, color: flagColor, padding: '2px 7px', borderRadius: 2, fontWeight: 700, flexShrink: 0, marginTop: '1px' }}>
                          {flag}
                        </span>
                      )}
                      <div>
                        <div style={{ fontSize: '12px' }}>{msg.message}</div>
                        {msg.lap_number && <div className="font-num" style={{ fontSize: '10px', color: 'var(--muted)', marginTop: '2px' }}>LAP {msg.lap_number}</div>}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ) : (
            /* Weather */
            <div>
              {weather.length === 0 ? (
                <div className="glass-card" style={{ padding: '48px', textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>No weather data available</div>
              ) : (
                <>
                  {(() => {
                    const latest = weather[weather.length - 1]
                    return (
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '10px', marginBottom: '16px' }}>
                        {[
                          // The backend sends null for channels the session didn't
                          // record — interpolating those straight in prints
                          // "undefined°C", which the `|| '—'` fallback can't catch.
                          { label: 'Air Temp', value: latest.air_temp != null ? `${latest.air_temp.toFixed(1)}°C` : '—' },
                          { label: 'Track Temp', value: latest.track_temp != null ? `${latest.track_temp.toFixed(1)}°C` : '—' },
                          { label: 'Humidity', value: latest.humidity != null ? `${latest.humidity.toFixed(0)}%` : '—' },
                          { label: 'Wind Speed', value: latest.wind_speed != null ? `${latest.wind_speed.toFixed(1)} m/s` : '—' },
                          { label: 'Pressure', value: latest.pressure != null ? `${latest.pressure.toFixed(0)} hPa` : '—' },
                          { label: 'Rainfall', value: latest.rainfall ? 'YES' : 'NO', color: latest.rainfall ? 'var(--sector-green)' : 'var(--muted)' },
                        ].map(item => (
                          <div key={item.label} className="glass-card" style={{ padding: '12px 14px' }}>
                            <div style={{ fontSize: '10px', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{item.label}</div>
                            <div className="font-num stat-num" style={{ fontSize: '20px', color: item.color || 'var(--foreground)', marginTop: '4px' }}>{item.value || '—'}</div>
                          </div>
                        ))}
                      </div>
                    )
                  })()}
                  <div style={{ fontSize: '12px', color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Users size={12} />
                    Weather samples: {weather.length} · AoA activation data available in telemetry view · Battery SoC not available in public F1 data
                  </div>
                </>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
