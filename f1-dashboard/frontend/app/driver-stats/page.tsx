'use client'

/**
 * Driver Stats — per-driver season breakdown from `/api/analysis/driver/{abbr}/{year}`.
 *
 * Standalone page with its own driver picker (rather than a tab on the driver
 * profile) because the whole point is comparing one driver's season shape
 * against another's, and the picker makes that a single click.
 */

import { useState, useEffect, useMemo } from 'react'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import { motion } from 'framer-motion'
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  BarChart, Bar, Cell,
} from 'recharts'
import { Trophy, Medal, Flag, Gauge, TriangleAlert, ChevronRight, BarChart3 } from 'lucide-react'
import { useApi } from '@/lib/api/client'
import { useStandings } from '@/lib/api/hooks'
import { useSeason } from '@/lib/season'
import type { FlowRow } from '@/components/charts/PositionFlow'
import { CHART_GRID as GRID } from '@/lib/chartTheme'

const PositionFlow = dynamic(() => import('@/components/charts/PositionFlow'), {
  ssr: false,
  loading: () => <div className="shimmer" style={{ height: 460, borderRadius: 2 }} />,
})

const AXIS = { fill: 'var(--muted)', fontSize: 11 }
const hexish = (c?: string) => (!c ? 'var(--accent)' : c.startsWith('#') ? c : `#${c}`)

interface RaceRow {
  round: number
  name: string
  grid: number | null
  position: number | null
  points: number
  status: string
  laps_led: number
}

interface DriverStats {
  abbr: string
  name: string
  team: string
  team_color: string
  starts: number
  laps_led: number
  wins: number
  podiums: number
  points: number
  points_finishes: number
  dnfs: number
  best_finish: number | null
  avg_finish: number | null
  points_pct: number
  finish_distribution: { position: number; count: number }[]
  points_evolution: { round: number; points: number }[]
  position_flow: FlowRow[]
  races: RaceRow[]
}

function Kpi({ icon: Icon, label, value, sub, accent }: {
  icon: typeof Trophy; label: string; value: React.ReactNode; sub?: string; accent?: string
}) {
  return (
    <div className="glass-card" style={{ padding: '16px 18px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 9 }}>
        <Icon size={13} style={{ color: accent || 'var(--muted)' }} />
        <span style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>{label}</span>
      </div>
      <div className="stat-num" style={{ fontSize: 30, color: accent || 'var(--foreground)', lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>{sub}</div>}
    </div>
  )
}

function Panel({ title, accent, children, note }: {
  title: string; accent?: string; children: React.ReactNode; note?: string
}) {
  return (
    <div className="glass-card" style={{ padding: 18 }}>
      <h2 className="section-title" style={{ marginBottom: 14, ['--bar' as string]: accent || 'var(--accent)' }}>{title}</h2>
      {children}
      {note && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 10 }}>{note}</div>}
    </div>
  )
}

/** Ring showing what share of starts scored points. */
function PointsRing({ pct, colour }: { pct: number; colour: string }) {
  const r = 54
  const c = 2 * Math.PI * r
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
      <svg width={140} height={140} viewBox="0 0 140 140">
        <circle cx={70} cy={70} r={r} fill="none" stroke="var(--surface)" strokeWidth={14} />
        <circle
          cx={70} cy={70} r={r} fill="none" stroke={colour} strokeWidth={14}
          strokeDasharray={`${(pct / 100) * c} ${c}`}
          strokeLinecap="butt"
          transform="rotate(-90 70 70)"
        />
        <text x={70} y={78} textAnchor="middle" fill="var(--foreground)"
              style={{ fontSize: 24, fontFamily: 'var(--font-mono)', fontWeight: 700 }}>
          {pct.toFixed(1)}%
        </text>
      </svg>
      <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.7, maxWidth: 190 }}>
        Share of race starts that finished in the points.
      </div>
    </div>
  )
}

/**
 * Remounted per season (see `DriverStatsPage`) — the selected driver has to
 * reset, because a 2024 grid entry may not be on the 2026 grid at all and the
 * `<select>` would otherwise sit on a value with no matching option.
 */
function SeasonDriverStats({ year }: { year: number }) {
  const { data: standings, isLoading: standingsLoading } = useStandings(year)
  const drivers = standings?.drivers || []
  const [abbr, setAbbr] = useState('')

  useEffect(() => {
    if (!abbr && drivers.length) setAbbr(drivers[0].abbreviation)
  }, [drivers, abbr])

  const { data, isLoading } = useApi<DriverStats>(abbr ? `/api/analysis/driver/${abbr}/${year}` : null)

  const colour = hexish(data?.team_color)

  // Full P1..P22 axis so gaps read as gaps, not as missing categories.
  const distribution = useMemo(() => {
    if (!data) return []
    const byPos: Record<number, number> = {}
    data.finish_distribution.forEach(d => { byPos[d.position] = d.count })
    const max = Math.max(22, ...data.finish_distribution.map(d => d.position))
    return Array.from({ length: max }, (_, i) => ({
      label: `P${i + 1}`,
      position: i + 1,
      count: byPos[i + 1] || 0,
    }))
  }, [data])

  const lapsLedByRace = useMemo(
    () => (data?.races || []).map(r => ({ label: `R${r.round}`, laps: r.laps_led, name: r.name })),
    [data],
  )

  return (
    <div style={{ maxWidth: '1560px', margin: '0 auto', padding: '26px clamp(16px, 3vw, 34px) 40px' }}>
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 20, flexWrap: 'wrap', marginBottom: 20 }}
      >
        <div>
          <div className="kicker" style={{ marginBottom: 8 }}>{year} Season</div>
          <h1 className="display-title" style={{ fontSize: 'clamp(26px, 4.2vw, 44px)', margin: 0 }}>
            {data ? data.name : 'Driver Stats'}
          </h1>
          <p style={{ color: 'var(--muted)', fontSize: 13, margin: '7px 0 0' }}>
            {data ? `${data.team} · ${data.starts} starts` : 'Season breakdown for every driver on the grid.'}
          </p>
        </div>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          <span style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Driver</span>
          <select
            value={abbr}
            onChange={e => setAbbr(e.target.value)}
            style={{
              background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--foreground)',
              padding: '9px 12px', borderRadius: 2, fontSize: 13, minWidth: 230,
            }}
          >
            {drivers.map(d => (
              <option key={d.abbreviation} value={d.abbreviation}>
                {d.abbreviation} — {d.name}
              </option>
            ))}
          </select>
        </label>
      </motion.div>

      {/* `standingsLoading` guards the cold-season case: the driver list itself
          comes from standings, so until that resolves there is no driver to ask
          about and the page would otherwise read as "no data". */}
      {(isLoading && !data) || (!abbr && standingsLoading) ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>
            Loading the {year} season… the first load of a season can take a minute.
          </div>
          <div className="shimmer" style={{ height: 110, borderRadius: 2 }} />
          <div className="shimmer" style={{ height: 420, borderRadius: 2 }} />
        </div>
      ) : !data ? (
        <div className="glass-card" style={{ padding: '48px 24px', textAlign: 'center' }}>
          <TriangleAlert size={22} style={{ color: 'var(--muted)', marginBottom: 10 }} />
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>No {year} data for this driver</div>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>They may not have started a race this season.</div>
        </div>
      ) : (
        <>
          {/* KPI row */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 16 }}>
            <Kpi icon={Trophy} label="Grand Prix Wins" value={data.wins} accent="#FFD700" sub={data.wins ? `${((data.wins / data.starts) * 100).toFixed(0)}% win rate` : 'No wins yet'} />
            <Kpi icon={Medal} label="Podiums" value={data.podiums} accent="#C0C0C0" sub={`${data.points_finishes} points finishes`} />
            <Kpi icon={BarChart3} label="Season Points" value={data.points} accent="var(--amber)" sub={`Avg ${(data.points / Math.max(data.starts, 1)).toFixed(1)} per race`} />
            <Kpi icon={Flag} label="Laps Led" value={data.laps_led} accent={colour} sub="Race laps (sprints excluded)" />
            <Kpi icon={Gauge} label="Avg Finish" value={data.avg_finish != null ? `P${data.avg_finish.toFixed(1)}` : '—'} sub={data.best_finish ? `Best P${data.best_finish}` : undefined} />
            <Kpi icon={TriangleAlert} label="DNFs" value={data.dnfs} accent={data.dnfs > 0 ? 'var(--accent)' : undefined} sub={`${data.starts - data.dnfs} classified`} />
          </div>

          {/* Charts */}
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.7fr) minmax(300px, 1fr)', gap: 16, alignItems: 'start' }} className="live-grid">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <Panel title="Start to Finish Position Flow" accent={colour}
                     note="Every race this season: where the car started on the grid and where it finished.">
                <PositionFlow rows={data.position_flow} />
              </Panel>

              <Panel title="Finish Positions Distribution" accent="var(--sector-purple)">
                <div style={{ width: '100%', height: 300 }}>
                  <ResponsiveContainer>
                    <BarChart data={distribution} margin={{ top: 6, right: 14, bottom: 4, left: -18 }}>
                      <CartesianGrid stroke={GRID} vertical={false} />
                      <XAxis dataKey="label" tick={{ ...AXIS, fontSize: 9 }} stroke={GRID} interval={0} />
                      <YAxis allowDecimals={false} tick={AXIS} stroke={GRID} />
                      <Tooltip
                        cursor={{ fill: 'rgba(255,255,255,0.04)' }}
                        contentStyle={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 2, fontSize: 11 }}
                        formatter={(v: any) => [`${v} ${v === 1 ? 'race' : 'races'}`, 'Finishes']}
                      />
                      <Bar dataKey="count" radius={[2, 2, 0, 0]}>
                        {distribution.map(d => (
                          <Cell key={d.position} fill={d.position <= 3 ? '#FFD700' : d.position <= 10 ? colour : 'var(--border)'} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </Panel>

              <Panel title="Points Evolution" accent="var(--amber)" note="Cumulative championship points across the season.">
                <div style={{ width: '100%', height: 260 }}>
                  <ResponsiveContainer>
                    <LineChart data={data.points_evolution} margin={{ top: 6, right: 14, bottom: 4, left: -14 }}>
                      <CartesianGrid stroke={GRID} />
                      <XAxis dataKey="round" tick={AXIS} stroke={GRID} tickFormatter={(v: number) => `R${v}`} />
                      <YAxis tick={AXIS} stroke={GRID} />
                      <Tooltip
                        contentStyle={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 2, fontSize: 11 }}
                        labelFormatter={(l) => `Round ${l}`}
                        formatter={(v: any) => [`${v} pts`, 'Total']}
                      />
                      <Line type="monotone" dataKey="points" stroke={colour} strokeWidth={2.5} dot={{ r: 2.5 }} isAnimationActive={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </Panel>
            </div>

            {/* Rail */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <Panel title="Points Finishes" accent="var(--sector-green)">
                <PointsRing pct={data.points_pct} colour={colour} />
              </Panel>

              {data.laps_led > 0 && (
                <Panel title="Laps Led per Race" accent={colour}>
                  <div style={{ width: '100%', height: 220 }}>
                    <ResponsiveContainer>
                      <BarChart data={lapsLedByRace} margin={{ top: 6, right: 10, bottom: 4, left: -20 }}>
                        <CartesianGrid stroke={GRID} vertical={false} />
                        <XAxis dataKey="label" tick={{ ...AXIS, fontSize: 9 }} stroke={GRID} interval={0} />
                        <YAxis allowDecimals={false} tick={AXIS} stroke={GRID} />
                        <Tooltip
                          cursor={{ fill: 'rgba(255,255,255,0.04)' }}
                          contentStyle={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 2, fontSize: 11 }}
                          labelFormatter={(l) => lapsLedByRace.find(r => r.label === l)?.name || String(l)}
                          formatter={(v: any) => [`${v} laps`, 'Led']}
                        />
                        <Bar dataKey="laps" fill={colour} radius={[2, 2, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </Panel>
              )}

              <Panel title="Race by Race">
                <div style={{ overflowX: 'auto' }}>
                  <table className="f1-table">
                    <thead>
                      <tr><th>R</th><th>GRID</th><th>FIN</th><th style={{ textAlign: 'right' }}>PTS</th></tr>
                    </thead>
                    <tbody>
                      {data.races.map(r => {
                        const moved = r.grid != null && r.position != null ? r.grid - r.position : 0
                        return (
                          <tr key={r.round}>
                            <td className="font-num" style={{ fontSize: 11, color: 'var(--muted)' }}>{r.round}</td>
                            <td className="font-num" style={{ fontSize: 11 }}>{r.grid ?? '—'}</td>
                            <td className="font-num" style={{
                              fontSize: 11, fontWeight: 700,
                              color: r.position === 1 ? '#FFD700' : moved > 0 ? 'var(--sector-green)' : moved < 0 ? 'var(--accent)' : 'var(--foreground)',
                            }}>
                              {r.position ?? 'DNF'}
                            </td>
                            <td className="font-num" style={{
                              textAlign: 'right', fontSize: 11, fontWeight: 700,
                              color: r.points > 0 ? 'var(--amber)' : 'var(--muted)',
                              opacity: r.points > 0 ? 1 : 0.4,
                            }}>
                              {r.points > 0 ? r.points : '—'}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                <Link
                  href="/analysis"
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 14,
                    fontSize: 11, color: 'var(--accent)', fontWeight: 700, letterSpacing: '0.05em',
                    textTransform: 'uppercase', fontFamily: 'var(--font-display)', textDecoration: 'none',
                  }}
                >
                  Compare drivers <ChevronRight size={12} />
                </Link>
              </Panel>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

export default function DriverStatsPage() {
  const [season] = useSeason()
  return <SeasonDriverStats key={season} year={season} />
}
