'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { motion } from 'framer-motion'
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts'
import { Trophy, TrendingUp, SlidersHorizontal, RotateCcw, Layers } from 'lucide-react'
import DriverStandingsTable from '@/components/standings/DriverStandingsTable'
import ConstructorStandingsTable from '@/components/standings/ConstructorStandingsTable'
import dynamic from 'next/dynamic'

// recharts is heavy — load it only when this page actually renders.
const StandingsEvolution = dynamic(() => import('@/components/charts/StandingsEvolution'), {
  ssr: false,
  loading: () => <div className="shimmer" style={{ height: 440, borderRadius: 2 }} />,
})
import DriverIndex from '@/components/standings/DriverIndex'
import { BACKEND_URL, TEAM_COLORS } from '@/lib/constants'
import { useStandings } from '@/lib/api/hooks'
import { useSeason } from '@/lib/season'
import { hexColor } from '@/lib/utils'
import type { Standings, DriverStanding, RoundInfo } from '@/lib/types'
import { CHART_GRID } from '@/lib/chartTheme'

/* ---- shared dark chart theme (mirrors app/battle/page.tsx) ---- */
const CHART_AXIS = { fill: '#8C939E', fontSize: 11 }
const CHART_TOOLTIP = { background: '#16181C', border: '1px solid #26282E', borderRadius: 2, fontSize: 12 }
const CHART_TOOLTIP_ITEM = { color: '#EDEFF2' }
const CHART_TOOLTIP_LABEL = { color: '#8C939E', fontSize: 11 }

function driverColor(d: DriverStanding): string {
  return hexColor(d.team_color) || TEAM_COLORS[d.team] || '#888'
}

/* Compact header readout — DESIGN.md §2 */
function HeaderStat({ label, value, sub, accent }: { label: string; value: React.ReactNode; sub?: string; accent?: string }) {
  return (
    <div style={{ padding: '9px 16px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 2, minWidth: 100, textAlign: 'center' }}>
      <div className="font-num stat-num" style={{ fontSize: 19, color: accent || 'var(--foreground)' }}>{value}</div>
      <div style={{ fontSize: 9, color: 'var(--muted)', letterSpacing: '0.12em', textTransform: 'uppercase', marginTop: 3 }}>{label}</div>
      {sub && (
        <div style={{ fontSize: 9, color: 'var(--muted)', marginTop: 2, maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {sub}
        </div>
      )}
    </div>
  )
}

/* ================== Points Projector (hypothetical finish order) ================== */
function PointsProjector({ drivers, year }: { drivers: DriverStanding[]; year: number }) {
  const POINTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1]
  const [assignments, setAssignments] = useState<Record<number, string>>({})
  const [fastestLap, setFastestLap] = useState('')
  // Mirrors FASTEST_LAP_POINT_LAST_YEAR in backend/routers/standings.py.
  const awardsFastestLapPoint = year <= 2024

  const projected: Record<string, number> = {}
  drivers.forEach(d => { projected[d.abbreviation] = d.points })
  Object.entries(assignments).forEach(([pos, drv]) => {
    if (drv && projected[drv] !== undefined) {
      projected[drv] += POINTS[parseInt(pos) - 1] || 0
    }
  })
  // The fastest-lap point was abolished for 2025 onwards. standings.py gates
  // the real calculation on FASTEST_LAP_POINT_LAST_YEAR = 2024; projecting a
  // point the season does not award contradicted the table beside it.
  if (awardsFastestLapPoint && fastestLap && projected[fastestLap] !== undefined) projected[fastestLap] += 1

  const sorted = [...drivers].sort((a, b) => (projected[b.abbreviation] || 0) - (projected[a.abbreviation] || 0))
  const selectStyle: React.CSSProperties = { flex: 1, background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--foreground)', padding: '5px 8px', borderRadius: 2, fontSize: 12 }

  return (
    <div className="glass-card" style={{ padding: 20 }}>
      <h2 className="section-title">Points Projector</h2>
      <div style={{ fontSize: 11, color: 'var(--muted)', margin: '5px 0 16px' }}>Set a hypothetical finish order to see the points swing.</div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 8, marginBottom: 16 }}>
        {POINTS.slice(0, 10).map((pts, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span className="font-num" style={{ fontSize: 11, color: 'var(--muted)', width: 62, textAlign: 'right', flexShrink: 0 }}>P{i + 1} (+{pts})</span>
            <select
              aria-label={`Driver finishing P${i + 1}`}
              value={assignments[i + 1] || ''}
              onChange={e => setAssignments(prev => ({ ...prev, [i + 1]: e.target.value }))}
              style={selectStyle}
            >
              <option value="">—</option>
              {drivers.map(d => <option key={d.abbreviation} value={d.abbreviation}>{d.abbreviation}</option>)}
            </select>
          </div>
        ))}
      </div>

      {awardsFastestLapPoint && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
          <span style={{ fontSize: 11, color: 'var(--sector-purple)', flexShrink: 0 }}>Fastest Lap (+1)</span>
          <select aria-label="Fastest lap driver" value={fastestLap} onChange={e => setFastestLap(e.target.value)} style={{ ...selectStyle, flex: 'none', minWidth: 100 }}>
            <option value="">—</option>
            {drivers.map(d => <option key={d.abbreviation} value={d.abbreviation}>{d.abbreviation}</option>)}
          </select>
        </div>
      )}

      <div style={{ overflowX: 'auto' }}>
        <table className="f1-table">
          <thead>
            <tr>
              <th>PROJ POS</th><th>DRIVER</th><th>CURRENT PTS</th><th>GAINED</th><th style={{ textAlign: 'right' }}>PROJECTED PTS</th>
            </tr>
          </thead>
          <tbody>
            {sorted.slice(0, 10).map((d, i) => {
              const gained = (projected[d.abbreviation] || 0) - d.points
              return (
                <tr key={d.abbreviation}>
                  <td className="font-num" style={{ fontWeight: 600 }}>P{i + 1}</td>
                  <td style={{ fontWeight: 600, fontSize: 13 }}>{d.abbreviation}</td>
                  <td className="font-num">{d.points}</td>
                  <td className="font-num" style={{ color: gained > 0 ? 'var(--sector-green)' : 'var(--muted)', opacity: gained > 0 ? 1 : 0.4 }}>
                    {gained > 0 ? `+${gained}` : '—'}
                  </td>
                  <td className="font-num" style={{ textAlign: 'right', fontWeight: 700 }}>{projected[d.abbreviation] || d.points}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <button
        onClick={() => { setAssignments({}); setFastestLap('') }}
        style={{
          marginTop: 12, padding: '7px 16px', background: 'transparent', border: '1px solid var(--border)',
          color: 'var(--muted)', borderRadius: 2, cursor: 'pointer', fontSize: 11, fontFamily: 'var(--font-display)',
          fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase',
        }}
      >
        Reset
      </button>
    </div>
  )
}

/* ================== Points progression chart (rail) ================== */
function PointsProgressionChart({ drivers, rounds }: { drivers: DriverStanding[]; rounds: RoundInfo[] }) {
  const { data, top } = useMemo(() => {
    const complete = [...rounds].filter(r => r.status === 'complete').sort((a, b) => a.round - b.round)
    const top = [...drivers].sort((a, b) => a.position - b.position).slice(0, 6)
    const running: Record<string, number> = {}
    top.forEach(d => { running[d.abbreviation] = 0 })
    const data = complete.map(r => {
      const row: Record<string, number | string> = { round: `R${r.round}` }
      top.forEach(d => {
        const rpts = d.rounds[r.round]
        running[d.abbreviation] += (rpts?.race || 0) + (rpts?.sprint || 0)
        row[d.abbreviation] = running[d.abbreviation]
      })
      return row
    })
    return { data, top }
  }, [drivers, rounds])

  if (!data.length) {
    return <div style={{ fontSize: 12, color: 'var(--muted)', padding: '18px 4px', textAlign: 'center' }}>No completed rounds to chart yet.</div>
  }

  return (
    <div style={{ width: '100%', height: 280 }}>
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 6, right: 10, bottom: 4, left: -16 }}>
          <CartesianGrid stroke={CHART_GRID} />
          <XAxis dataKey="round" tick={CHART_AXIS} stroke={CHART_GRID} />
          <YAxis tick={CHART_AXIS} stroke={CHART_GRID} width={30} />
          <Tooltip contentStyle={CHART_TOOLTIP} itemStyle={CHART_TOOLTIP_ITEM} labelStyle={CHART_TOOLTIP_LABEL} />
          <Legend wrapperStyle={{ fontSize: 10 }} />
          {top.map(d => (
            <Line key={d.abbreviation} type="monotone" dataKey={d.abbreviation} name={d.abbreviation} stroke={driverColor(d)} dot={false} strokeWidth={2} isAnimationActive />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

/* =================================================================== */

/**
 * Remounted on every season change (see `StandingsPage`), so no local state —
 * the projector's picks, the open tab — can survive into a year where it makes
 * no sense.
 */
function SeasonStandings({ year }: { year: number }) {
  const { data: standings, isLoading, mutate: reloadStandings } = useStandings(year)
  const [activeTab, setActiveTab] = useState<'drivers' | 'constructors'>('drivers')
  const [showProjector, setShowProjector] = useState(false)
  const loading = isLoading && !standings

  const drivers = standings?.drivers || []
  const leader = drivers[0]
  const p2 = drivers[1]
  const gapToP2 = leader && p2 ? leader.points - p2.points : null
  const completeCount = standings?.rounds.filter(r => r.status === 'complete').length || 0
  const totalRounds = standings?.rounds.length || 0
  const nextRound = standings?.rounds.find(r => r.status === 'upcoming')

  return (
    <div style={{ maxWidth: '1560px', margin: '0 auto', padding: '26px clamp(16px, 3vw, 34px) 40px' }}>
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 20, flexWrap: 'wrap', marginBottom: 22 }}
      >
        <div>
          <div className="kicker" style={{ marginBottom: 8 }}>Championship</div>
          <h1 className="display-title" style={{ fontSize: 'clamp(26px, 4.2vw, 44px)', margin: 0 }}>{year} Standings</h1>
          <p style={{ color: 'var(--muted)', fontSize: 13, margin: '7px 0 0', maxWidth: 620 }}>
            Full points matrix across every completed round of the {year} season — drivers and constructors.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <HeaderStat label="Leader" value={leader?.abbreviation || '—'} accent={leader ? driverColor(leader) : undefined} />
          <HeaderStat label="Gap to P2" value={gapToP2 != null ? `+${gapToP2}` : '—'} accent="var(--amber)" />
          <HeaderStat label="Rounds" value={`${completeCount}/${totalRounds || 23}`} />
          <HeaderStat label="Next Round" value={nextRound ? `R${nextRound.round}` : standings ? 'Final' : '—'} sub={nextRound?.name} />
        </div>
      </motion.div>

      {/* Controls row: tab bar + projector toggle */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 14 }}>
        <div style={{ display: 'inline-flex', gap: 3, padding: 3, background: 'var(--surface)', border: '1px solid var(--border)' }}>
          {(['drivers', 'constructors'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                padding: '8px 20px', border: 'none', cursor: 'pointer',
                fontFamily: 'var(--font-display)', fontSize: 12, fontWeight: 600,
                letterSpacing: '0.06em', textTransform: 'uppercase',
                background: activeTab === tab ? 'var(--accent)' : 'transparent',
                color: activeTab === tab ? '#fff' : 'var(--muted)',
              }}
            >
              {tab === 'drivers' ? 'Drivers' : 'Constructors'}
            </button>
          ))}
        </div>
        <button
          onClick={() => setShowProjector(v => !v)}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 7, padding: '8px 14px', cursor: 'pointer',
            fontFamily: 'var(--font-display)', fontSize: 12, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase',
            background: showProjector ? 'var(--accent)' : 'var(--surface)',
            border: `1px solid ${showProjector ? 'var(--accent)' : 'var(--border)'}`,
            color: showProjector ? '#fff' : 'var(--muted)', borderRadius: 2,
          }}
        >
          <SlidersHorizontal size={13} /> {showProjector ? 'Hide' : 'Show'} Points Projector
        </button>
      </div>

      {/* Main grid: table column + rail */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2.4fr) minmax(280px, 1fr)', gap: 16, alignItems: 'start' }} className="live-grid">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {showProjector && standings && (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
              <PointsProjector drivers={standings.drivers} year={year} />
            </motion.div>
          )}

          {standings && (
            <div style={{ marginBottom: 16 }}>
              <StandingsEvolution standings={standings} mode={activeTab} />
            </div>
          )}

          <div className="featured-card" style={{ overflow: 'hidden' }}>
            <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
              <h2 className="section-title">{activeTab === 'drivers' ? 'Drivers Championship' : 'Constructors Championship'}</h2>
              <div className="font-num" style={{ fontSize: 10, color: 'var(--muted)' }}>{completeCount} ROUNDS SCORED</div>
            </div>

            {loading ? (
              <div style={{ padding: 20 }}>
                {/* The backend scores a season by reading every race session of
                    that year, so the first ever request for one takes minutes,
                    not milliseconds. Say so rather than shimmer in silence. */}
                <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>
                  Scoring the {year} season… the first load of a season can take a minute.
                </div>
                <div className="shimmer" style={{ height: 320, borderRadius: 2 }} />
              </div>
            ) : standings ? (
              activeTab === 'drivers' ? (
                <DriverStandingsTable drivers={standings.drivers} rounds={standings.rounds} />
              ) : (
                <ConstructorStandingsTable constructors={standings.constructors} rounds={standings.rounds} />
              )
            ) : (
              <div className="glass-card" style={{ margin: 18, borderLeft: '2px solid var(--accent)', padding: '20px 24px' }}>
                <div style={{ fontSize: 13, color: 'var(--foreground)', fontWeight: 600, marginBottom: 4 }}>Couldn&apos;t load standings</div>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 14 }}>The server may still be waking up — refresh in a moment.</div>
                <button
                  onClick={() => reloadStandings()}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 7, padding: '7px 14px', cursor: 'pointer',
                    background: 'var(--accent)', border: 'none', color: '#fff', borderRadius: 2,
                    fontSize: 11, fontFamily: 'var(--font-display)', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase',
                  }}
                >
                  <RotateCcw size={12} /> Retry
                </button>
              </div>
            )}
          </div>

          {standings && <DriverIndex drivers={standings.drivers} limit={12} />}

          {/* Legend */}
          <div className="glass-card" style={{ padding: '12px 18px', display: 'flex', gap: 20, flexWrap: 'wrap', fontSize: 11, color: 'var(--muted)' }}>
            <span><span style={{ color: '#FFD700' }}>W</span> = Wins</span>
            <span><span style={{ color: 'var(--muted)' }}>POD</span> = Podiums</span>
            <span><span style={{ color: 'var(--sector-purple)' }}>FL</span> = Fastest Laps</span>
            <span><span style={{ background: 'rgba(0,209,49,0.14)', padding: '0 4px', borderRadius: 2, color: 'var(--sector-green)' }}>25</span> = Race win</span>
            <span><span style={{ color: 'var(--amber)' }}>S</span> after round number = Sprint weekend</span>
          </div>
        </div>

        {/* Rail */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="glass-card" style={{ padding: 18 }}>
            <h2 className="section-title" style={{ marginBottom: 14, ['--bar' as string]: '#FFC800' }}>
              <Layers size={13} style={{ marginRight: -4 }} />
              {activeTab === 'drivers' ? 'Constructors' : 'Drivers'}
            </h2>
            {standings ? (
              activeTab === 'drivers' ? (
                <ConstructorStandingsTable constructors={standings.constructors} rounds={standings.rounds} compact />
              ) : (
                <DriverStandingsTable drivers={standings.drivers} rounds={standings.rounds} compact />
              )
            ) : (
              <div className="shimmer" style={{ height: 180, borderRadius: 2 }} />
            )}
          </div>

          <div className="glass-card" style={{ padding: 18 }}>
            <h2 className="section-title" style={{ marginBottom: 14 }}>
              <TrendingUp size={13} style={{ marginRight: -4 }} />
              Points Progression
            </h2>
            {standings ? (
              <PointsProgressionChart drivers={standings.drivers} rounds={standings.rounds} />
            ) : (
              <div className="shimmer" style={{ height: 280, borderRadius: 2 }} />
            )}
          </div>

          {!standings && !loading && (
            <div className="glass-card" style={{ padding: 20, textAlign: 'center' }}>
              <Trophy size={22} style={{ color: 'var(--muted)', marginBottom: 8 }} />
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>Standings unavailable right now.</div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default function StandingsPage() {
  const [season] = useSeason()
  // Keyed remount: a season switch must start clean, never re-label last
  // season's table with this season's year.
  return <SeasonStandings key={season} year={season} />
}
