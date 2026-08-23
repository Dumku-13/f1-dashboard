'use client'

import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell,
  ScatterChart, Scatter, ZAxis,
} from 'recharts'
import {
  Activity, ChartColumnBig, ChevronDown, ChevronRight, CircleDot, CloudRain, Flag,
  Fuel, Gauge, Info, ListOrdered, Play, RefreshCw, Route, Timer, TriangleAlert, Trophy,
} from 'lucide-react'
import { BACKEND_URL } from '@/lib/constants'
import { TEAM_COLORS, COMPOUND_COLORS } from '@/lib/constants'
import { formatLapTime } from '@/lib/ist'
import { useApiList } from '@/lib/api/client'
import { useStandings } from '@/lib/api/hooks'
import { useSeason } from '@/lib/season'
import type { PaceData } from '@/lib/types'

interface DegradationData {
  driver: string
  team: string
  compound: string
  /** null when the regression couldn't be fitted for that stint */
  deg_rate: number | null
  avg_pace: number
  stint_laps: number
}

interface TimelinePoint { lap: number; cumulative_s: number }

interface StrategyResult {
  driver: string
  predicted_finish: number
  time_delta: number
  notes: string
  estimated_total_s?: number
  timeline?: TimelinePoint[]
}

interface ChampSimDriver {
  driver: string
  current_points: number
  position: number
  finish_pos?: number
}

export const ANALYTICS_TABS = ['Pace Ranking', 'Tyre Degradation', 'Strategy Sim', 'Championship Sim'] as const
export type AnalyticsTab = typeof ANALYTICS_TABS[number]

export const ANALYTICS_TAB_ICON: Record<AnalyticsTab, React.ReactNode> = {
  'Pace Ranking': <ChartColumnBig size={12} />,
  'Tyre Degradation': <CircleDot size={12} />,
  'Strategy Sim': <Route size={12} />,
  'Championship Sim': <Trophy size={12} />,
}

/* ----------------------------------------------------------------------------
   Chart theme — SVG paint comes from `currentColor` so the colour itself is
   still a token, set on the wrapping element (see ChartFrame).
   -------------------------------------------------------------------------- */
const AXIS_TICK = { fill: 'currentColor', fontSize: 11 }
const AXIS_LINE = { stroke: 'currentColor', strokeOpacity: 0.35 }
const GRID_STROKE = 'currentColor'
const AXIS_LABEL = { fill: 'currentColor', fontSize: 10 }
const tooltipStyle: React.CSSProperties = {
  background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 2,
  fontSize: 12, fontFamily: 'var(--font-mono)',
}
const tooltipItem: React.CSSProperties = { color: 'var(--foreground)' }
const tooltipLabel: React.CSSProperties = { color: 'var(--muted)', fontSize: 11 }

const teamColor = (team: string) => TEAM_COLORS[team] || '#888'
const compoundColor = (c: string) => COMPOUND_COLORS[c] || COMPOUND_COLORS.UNKNOWN
const DRY_COMPOUNDS = ['SOFT', 'MEDIUM', 'HARD'] as const
const DARK_LABEL_COMPOUNDS = ['MEDIUM', 'HARD']

const degColor = (v: number | null | undefined) =>
  v == null ? 'var(--muted)' : v < 0.05 ? 'var(--sector-green)' : v > 0.15 ? 'var(--accent)' : 'var(--amber)'

const median = (xs: number[]): number | null => {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/* ---------------------------------------------------------------- primitives */

const primaryBtn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 8, padding: '9px 20px',
  background: 'var(--accent)', border: '1px solid var(--accent)', color: '#fff',
  borderRadius: 2, cursor: 'pointer',
  fontFamily: 'var(--font-display)', fontSize: 12, fontWeight: 700,
  letterSpacing: '0.09em', textTransform: 'uppercase',
}
const ghostBtn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 7, padding: '7px 14px',
  background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--foreground)',
  borderRadius: 2, cursor: 'pointer',
  fontFamily: 'var(--font-display)', fontSize: 11, fontWeight: 600,
  letterSpacing: '0.09em', textTransform: 'uppercase',
}
const inputStyle: React.CSSProperties = {
  background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--foreground)',
  padding: '8px 11px', borderRadius: 2, width: '100%', fontSize: 13,
  fontFamily: 'var(--font-mono)',
}
const labelStyle: React.CSSProperties = {
  fontFamily: 'var(--font-display)', fontSize: 10, color: 'var(--muted)', marginBottom: 7,
  textTransform: 'uppercase', letterSpacing: '0.14em', fontWeight: 600,
}
const noteStyle: React.CSSProperties = {
  fontSize: 11, color: 'var(--muted)', lineHeight: 1.55,
}

function ChartFrame({ height, children }: { height: number; children: React.ReactElement }) {
  return (
    <div style={{ width: '100%', height, color: 'var(--muted)' }}>
      <ResponsiveContainer>{children}</ResponsiveContainer>
    </div>
  )
}

function KpiTile({ label, value, sub, accent, delay = 0 }: {
  label: string; value: string; sub?: string; accent?: string; delay?: number
}) {
  return (
    <motion.div
      className="glass-card"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay }}
      style={{ padding: '13px 15px' }}
    >
      <div style={{ fontFamily: 'var(--font-display)', fontSize: 9, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--muted)' }}>{label}</div>
      <div className="stat-num" style={{ fontSize: 22, marginTop: 5, color: accent || 'var(--foreground)', lineHeight: 1.05 }}>{value}</div>
      {sub && <div className="font-num" style={{ fontSize: 10.5, color: 'var(--muted)', marginTop: 4 }}>{sub}</div>}
    </motion.div>
  )
}

function KpiRow({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 14 }}>
      {children}
    </div>
  )
}

function Rail({ title, icon, accent, children }: {
  title: string; icon?: React.ReactNode; accent?: string; children: React.ReactNode
}) {
  return (
    <div className="glass-card" style={{ padding: 16 }}>
      <h2 className="section-title" style={{ marginBottom: 12, ...(accent ? { ['--bar' as string]: accent } : {}) }}>
        {icon && <span style={{ display: 'inline-flex', color: accent || 'var(--accent)' }}>{icon}</span>}
        {title}
      </h2>
      {children}
    </div>
  )
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="glass-card" style={{ padding: '20px 22px', borderLeft: '2px solid var(--accent)', display: 'flex', gap: 14, alignItems: 'flex-start' }}>
      <TriangleAlert size={16} style={{ color: 'var(--accent)', flexShrink: 0, marginTop: 1 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="font-display" style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em' }}>Data unavailable</div>
        <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 6, lineHeight: 1.5 }}>{message}</div>
        <button onClick={onRetry} style={{ ...ghostBtn, marginTop: 13 }}>
          <RefreshCw size={12} /> Retry
        </button>
      </div>
    </div>
  )
}

function EmptyState({ icon, title, body, action }: {
  icon: React.ReactNode; title: string; body: string; action?: React.ReactNode
}) {
  return (
    <div className="glass-card" style={{ padding: '46px 26px', textAlign: 'center' }}>
      <div style={{ color: 'var(--muted)', display: 'flex', justifyContent: 'center', marginBottom: 14 }}>{icon}</div>
      <div className="font-display" style={{ fontSize: 14, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em' }}>{title}</div>
      <div style={{ fontSize: 12.5, color: 'var(--muted)', margin: '9px auto 0', maxWidth: 430, lineHeight: 1.6 }}>{body}</div>
      {action && <div style={{ marginTop: 18 }}>{action}</div>}
    </div>
  )
}

/** Skeleton shaped like the chart + rail layout that's coming. */
function AnalysisSkeleton({ height = 380 }: { height?: number }) {
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 14 }}>
        {[0, 1, 2, 3, 4].map(i => (
          <div key={i} className="glass-card" style={{ padding: '13px 15px' }}>
            <div className="shimmer" style={{ height: 8, width: '60%', borderRadius: 2 }} />
            <div className="shimmer" style={{ height: 18, width: '80%', borderRadius: 2, marginTop: 9 }} />
          </div>
        ))}
      </div>
      <div className="live-grid" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2.4fr) minmax(280px, 1fr)', gap: 14, alignItems: 'start' }}>
        <div className="glass-card" style={{ padding: 18 }}>
          <div className="shimmer" style={{ height: 10, width: 210, borderRadius: 2, marginBottom: 16 }} />
          <div className="shimmer" style={{ height, borderRadius: 2 }} />
        </div>
        <div style={{ display: 'grid', gap: 14 }}>
          <div className="glass-card" style={{ padding: 16 }}>
            <div className="shimmer" style={{ height: 10, width: 140, borderRadius: 2, marginBottom: 14 }} />
            <div className="shimmer" style={{ height: 96, borderRadius: 2 }} />
          </div>
          <div className="glass-card" style={{ padding: 16 }}>
            <div className="shimmer" style={{ height: 10, width: 110, borderRadius: 2, marginBottom: 14 }} />
            <div className="shimmer" style={{ height: 150, borderRadius: 2 }} />
          </div>
        </div>
      </div>
      <div style={{ ...noteStyle, marginTop: 12 }}>
        First load can take a minute — fastf1 is warming up the session cache.
      </div>
    </div>
  )
}

function TableToggle({ open, onToggle, label, children }: {
  open: boolean; onToggle: () => void; label: string; children: React.ReactNode
}) {
  return (
    <div className="glass-card" style={{ padding: '0 16px' }}>
      <button
        onClick={onToggle}
        style={{
          display: 'flex', alignItems: 'center', gap: 8, background: 'none', border: 'none',
          color: open ? 'var(--foreground)' : 'var(--muted)', cursor: 'pointer',
          fontFamily: 'var(--font-display)', fontSize: 11, fontWeight: 600,
          letterSpacing: '0.12em', textTransform: 'uppercase', padding: '13px 0',
        }}
      >
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        {open ? `Hide ${label}` : `Show ${label}`}
      </button>
      {open && <div style={{ overflowX: 'auto', paddingBottom: 14 }}>{children}</div>}
    </div>
  )
}

/* ============================================================================
   Analytics hub — the strategy/simulation half of /analysis.
   Extracted from the old standalone /analytics route when the two hubs were
   merged. The parent (`app/analysis/page.tsx`) owns the page shell, the tab
   strip and the round picker, and drives this component through props; the
   internals below are unchanged from the original page.
   ========================================================================== */

export default function AnalyticsHub({ tab, round }: { tab: AnalyticsTab; round: number }) {
  // Follows the season picker, like the page that hosts it. The parent remounts
  // this whole subtree when the season changes, so the on-demand pace and
  // degradation loads start clean rather than showing last season's numbers.
  const [year] = useSeason()
  const roundInitRef = useRef(false)

  // Pace ranking — key is only armed once "Load Pace Rankings" is clicked, and
  // captures the round at that moment so picking a different round afterwards
  // doesn't silently refetch until the button is pressed again.
  const [paceRound, setPaceRound] = useState<number | null>(null)
  const { data: paceData, error: paceApiError, isLoading: paceIsLoading, mutate: reloadPace } =
    useApiList<PaceData>(paceRound != null ? `/api/analytics/pace/${year}/${paceRound}/Race` : null)
  const [paceTableOpen, setPaceTableOpen] = useState(false)

  // Degradation — same on-demand pattern as pace ranking.
  const [degRound, setDegRound] = useState<number | null>(null)
  const { data: degData, error: degApiError, isLoading: degIsLoading, mutate: reloadDeg } =
    useApiList<DegradationData>(degRound != null ? `/api/analytics/degradation/${year}/${degRound}/Race` : null)
  const [degTableOpen, setDegTableOpen] = useState(false)

  // Strategy sim 2.0
  const [stratDriver, setStratDriver] = useState('')
  const [pitLap, setPitLap] = useState(20)
  const [totalLaps, setTotalLaps] = useState(57)
  const [compoundIn, setCompoundIn] = useState('MEDIUM')
  const [compoundOut, setCompoundOut] = useState('HARD')
  const [scLaps, setScLaps] = useState<number[]>([])
  const [rainOn, setRainOn] = useState(false)
  const [rainFrom, setRainFrom] = useState(30)
  const [stratResult, setStratResult] = useState<StrategyResult | null>(null)
  const [stratLoading, setStratLoading] = useState(false)

  // Championship sim — drivers list rides on the shared standings request
  // instead of hitting /api/standings/drivers separately. champDrivers stays
  // local editable state (it gains a `finish_pos` field as the user plays
  // with hypothetical results) seeded once standings data first arrives.
  const { data: standingsData } = useStandings(year)
  const [champDrivers, setChampDrivers] = useState<ChampSimDriver[]>([])
  const [champResult, setChampResult] = useState<ChampSimDriver[] | null>(null)
  const POINTS_SYS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1]

  // Seed the championship-sim driver list once, the first time standings data
  // lands. Defaulting the round to the latest completed one moved up to the
  // parent shell when /analytics was folded into /analysis.
  useEffect(() => {
    if (roundInitRef.current || !standingsData) return
    roundInitRef.current = true
    setChampDrivers(standingsData.drivers.slice(0, 10).map(s => ({ driver: s.abbreviation, current_points: s.points, position: s.position })))
  }, [standingsData])

  const paceLoading = paceIsLoading && paceData.length === 0
  const paceError = paceApiError
    ? paceApiError.message
    : (paceRound != null && !paceLoading && paceData.length === 0
      ? `No lap data for round ${paceRound} — the race may not have run yet.`
      : '')
  const loadPace = () => {
    setPaceRound(round)
    reloadPace()
  }

  const degLoading = degIsLoading && degData.length === 0
  const degError = degApiError
    ? degApiError.message
    : (degRound != null && !degLoading && degData.length === 0
      ? `No stint data for round ${degRound} — the race may not have run yet.`
      : '')
  const loadDeg = () => {
    setDegRound(round)
    reloadDeg()
  }

  const runStrategySim = async () => {
    if (!stratDriver) return
    setStratLoading(true)
    const body: Record<string, unknown> = {
      year, round_num: round, pit_lap: pitLap, compound_in: compoundIn,
      compound_out: compoundOut, driver: stratDriver, total_laps: totalLaps,
    }
    if (scLaps.length) body.sc_laps = scLaps.join(',')
    if (rainOn) body.rain_from = rainFrom
    const result = await fetch(`${BACKEND_URL}/api/analytics/strategy-sim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then(r => r.ok ? r.json() : null).catch(() => null)
    setStratResult(result)
    setStratLoading(false)
  }

  const runChampSim = () => {
    const projected = champDrivers.map(d => {
      const pos = d.finish_pos
      const gained = pos !== undefined ? (POINTS_SYS[pos - 1] || 0) : 0
      return { ...d, projected: d.current_points + gained }
    }).sort((a, b) => b.projected - a.projected).map((d, i) => ({ ...d, position: i + 1 }))
    setChampResult(projected as any)
  }

  const toggleScLap = (lap: number) => {
    setScLaps(prev => {
      if (prev.includes(lap)) return prev.filter(l => l !== lap)
      if (prev.length >= 2) return [prev[1], lap] // keep max 2 (1-2 SC laps)
      return [...prev, lap].sort((a, b) => a - b)
    })
  }

  /* ---------------- derived (display only) ---------------- */

  const paceOf = (p: PaceData) => p.fuel_corrected_pace ?? p.fuel_corrected_avg_s ?? null
  const paceRows = [...paceData]
    .filter(p => paceOf(p) != null)
    .sort((a, b) => (paceOf(a) ?? 999) - (paceOf(b) ?? 999))
  const paceBase = paceRows.length ? Math.min(...paceRows.map(r => paceOf(r) ?? 999)) : null
  const paceChart = paceRows.map(r => ({
    driver: r.driver,
    team: r.team,
    gap: +(((paceOf(r) ?? 0) - (paceBase ?? 0))).toFixed(3),
    pace: paceOf(r) ?? 0,
  }))
  const fastest = paceRows[0]
  const slowest = paceRows.length > 1 ? paceRows[paceRows.length - 1] : null
  const spreadIdx = Math.min(9, paceChart.length - 1)
  const withStd = paceData.filter(p => p.std_dev != null)
  const steadiest = withStd.length
    ? withStd.reduce((a, b) => ((a.std_dev ?? 99) <= (b.std_dev ?? 99) ? a : b))
    : null

  const degCompounds = Array.from(new Set(degData.map(d => d.compound)))
  const degRated = degData.filter(d => d.deg_rate != null)
  const gentlest = degRated.length
    ? degRated.reduce((a, b) => ((a.deg_rate ?? 99) <= (b.deg_rate ?? 99) ? a : b))
    : null
  const harshest = degRated.length
    ? degRated.reduce((a, b) => ((a.deg_rate ?? -99) >= (b.deg_rate ?? -99) ? a : b))
    : null
  const longestStint = degData.length
    ? degData.reduce((a, b) => (a.stint_laps >= b.stint_laps ? a : b))
    : null
  const compoundSummary = degCompounds.map(c => {
    const rows = degData.filter(d => d.compound === c)
    const rates = rows.map(r => r.deg_rate).filter((r): r is number => r != null)
    return {
      compound: c,
      stints: rows.length,
      medianDeg: median(rates),
      medianLaps: median(rows.map(r => r.stint_laps)),
      bestPace: rows.length ? Math.min(...rows.map(r => r.avg_pace)) : null,
    }
  }).sort((a, b) => (a.medianDeg ?? Infinity) - (b.medianDeg ?? Infinity))

  const positionsSet = champDrivers.filter(d => d.finish_pos !== undefined).length
  const pointsOnOffer = champDrivers.reduce(
    (s, d) => s + (d.finish_pos !== undefined ? (POINTS_SYS[d.finish_pos - 1] || 0) : 0), 0)

  return (
    <>
      {/* ============================ PACE RANKING ============================ */}
      {tab === 'Pace Ranking' && (
        <motion.div key="pace" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
            <button onClick={loadPace} disabled={paceLoading} style={{ ...primaryBtn, opacity: paceLoading ? 0.55 : 1 }}>
              <Activity size={13} />{paceLoading ? 'Computing…' : 'Load Pace Rankings'}
            </button>
            {paceRows.length > 0 && (
              <span className="font-num" style={{ fontSize: 11, color: 'var(--muted)' }}>
                {paceRows.length} cars ranked · round {round}
              </span>
            )}
          </div>

          {paceLoading && <AnalysisSkeleton height={Math.max(320, 20 * 26)} />}

          {!paceLoading && paceData.length === 0 && (
            paceError ? (
              <ErrorState message={paceError} onRetry={loadPace} />
            ) : (
              <EmptyState
                icon={<ChartColumnBig size={30} />}
                title="No pace data loaded"
                body="Fuel-corrected pace is computed lap by lap from the race session. Hit the button to pull it from FastF1 — the first load for a round can take a minute while the cache warms."
                action={<button onClick={loadPace} style={primaryBtn}><Activity size={13} />Load Pace Rankings</button>}
              />
            )
          )}

          {!paceLoading && paceChart.length > 0 && (
            <>
              <KpiRow>
                <KpiTile
                  label="Fastest car" value={fastest ? fastest.driver : '—'}
                  sub={paceBase != null ? formatLapTime(paceBase) : undefined}
                  accent={fastest ? teamColor(fastest.team) : undefined}
                  delay={0}
                />
                <KpiTile
                  label="Biggest gap"
                  value={slowest ? `+${((paceOf(slowest) ?? 0) - (paceBase ?? 0)).toFixed(3)}s` : '—'}
                  sub={slowest ? `${slowest.driver} to ${fastest?.driver ?? '—'}` : undefined}
                  accent="var(--accent)"
                  delay={0.04}
                />
                <KpiTile
                  label="Field spread"
                  value={spreadIdx > 0 ? `+${paceChart[spreadIdx].gap.toFixed(3)}s` : '—'}
                  sub={spreadIdx > 0 ? `P1 → P${spreadIdx + 1}` : undefined}
                  accent="var(--amber)"
                  delay={0.08}
                />
                <KpiTile
                  label="Most consistent" value={steadiest ? steadiest.driver : '—'}
                  sub={steadiest?.std_dev != null ? `±${steadiest.std_dev.toFixed(3)}s` : undefined}
                  accent="var(--sector-green)"
                  delay={0.12}
                />
                <KpiTile label="Cars ranked" value={String(paceChart.length)} sub="fuel corrected" delay={0.16} />
              </KpiRow>

              <div className="live-grid" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2.4fr) minmax(280px, 1fr)', gap: 14, alignItems: 'start', marginBottom: 14 }}>
                {/* Chart */}
                <div className="featured-card" style={{ padding: 18 }}>
                  <h2 className="section-title" style={{ marginBottom: 16 }}>
                    <span style={{ display: 'inline-flex', color: 'var(--accent)' }}><ChartColumnBig size={13} /></span>
                    Fuel-corrected pace — gap to fastest
                  </h2>
                  <ChartFrame height={Math.max(340, paceChart.length * 30)}>
                    <BarChart layout="vertical" data={paceChart} margin={{ top: 4, right: 30, bottom: 6, left: 6 }}>
                      <CartesianGrid stroke={GRID_STROKE} strokeOpacity={0.18} horizontal={false} />
                      <XAxis
                        type="number" tick={AXIS_TICK} axisLine={AXIS_LINE} tickLine={false}
                        tickFormatter={(v: number) => `+${v.toFixed(2)}s`}
                      />
                      <YAxis
                        type="category" dataKey="driver" tick={AXIS_TICK} axisLine={AXIS_LINE} tickLine={false} width={46}
                      />
                      <Tooltip
                        cursor={{ fill: 'rgba(255,255,255,0.03)' }}
                        contentStyle={tooltipStyle} itemStyle={tooltipItem} labelStyle={tooltipLabel}
                        formatter={(v) => [`+${Number(v).toFixed(3)}s`, 'Gap']}
                      />
                      <Bar dataKey="gap" isAnimationActive>
                        {paceChart.map((d, i) => <Cell key={i} fill={teamColor(d.team)} />)}
                      </Bar>
                    </BarChart>
                  </ChartFrame>
                  <div style={{ ...noteStyle, marginTop: 10, borderTop: '1px solid var(--hairline)', paddingTop: 10 }}>
                    Bars show the gap to the fastest fuel-corrected car. 0.000s is the benchmark.
                  </div>
                </div>

                {/* Rail */}
                <div style={{ display: 'grid', gap: 14 }}>
                  <Rail title="How this is calculated" icon={<Fuel size={13} />} accent="var(--amber)">
                    <div style={{ ...noteStyle, display: 'grid', gap: 9 }}>
                      <p style={{ margin: 0 }}>
                        A car carrying 100kg of fuel is slower than the same car on fumes. Every lap is
                        adjusted by roughly <span className="font-num" style={{ color: 'var(--foreground)' }}>0.045s</span> per
                        lap of fuel still on board.
                      </p>
                      <p style={{ margin: 0 }}>
                        The corrected average is what the car would have done at a constant fuel load, so a
                        long first stint no longer flatters or punishes a driver.
                      </p>
                      <p style={{ margin: 0, color: 'var(--foreground)' }}>
                        What is left is car + driver pace, not fuel strategy.
                      </p>
                    </div>
                    <div style={{ display: 'grid', gap: 6, marginTop: 13, paddingTop: 12, borderTop: '1px solid var(--hairline)' }}>
                      {[
                        ['Source', 'FastF1 race laps'],
                        ['Session', `${year} · Round ${round} · Race`],
                        ['Benchmark', paceBase != null ? formatLapTime(paceBase) : '—'],
                      ].map(([k, v]) => (
                        <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 11 }}>
                          <span style={{ color: 'var(--muted)' }}>{k}</span>
                          <span className="font-num" style={{ color: 'var(--foreground)' }}>{v}</span>
                        </div>
                      ))}
                    </div>
                  </Rail>

                  <Rail title="Gap ladder" icon={<ListOrdered size={13} />}>
                    <div style={{ display: 'grid', gap: 2 }}>
                      {paceChart.slice(0, 10).map((d, i) => (
                        <div key={d.driver} style={{
                          display: 'grid', gridTemplateColumns: '24px 4px 1fr auto', alignItems: 'center', gap: 9,
                          padding: '6px 0', borderBottom: i === 9 ? 'none' : '1px solid var(--hairline)',
                        }}>
                          <span className="font-num" style={{ fontSize: 11, color: i === 0 ? 'var(--amber)' : 'var(--muted)', fontWeight: 700 }}>P{i + 1}</span>
                          <span style={{ width: 4, height: 15, background: teamColor(d.team) }} />
                          <span className="font-display" style={{ fontSize: 12.5, fontWeight: 700 }}>{d.driver}</span>
                          <span className="font-num" style={{ fontSize: 11.5, color: i === 0 ? 'var(--sector-green)' : 'var(--muted)' }}>
                            {i === 0 ? 'BENCHMARK' : `+${d.gap.toFixed(3)}`}
                          </span>
                        </div>
                      ))}
                    </div>
                  </Rail>
                </div>
              </div>
            </>
          )}

          {paceData.length > 0 && !paceLoading && (
            <TableToggle open={paceTableOpen} onToggle={() => setPaceTableOpen(o => !o)} label="data table">
              <table className="f1-table">
                <thead><tr><th>POS</th><th>DRIVER</th><th>TEAM</th><th>FUEL-CORRECTED PACE</th><th>GAP</th><th>AVG LAP</th><th>STD DEV</th></tr></thead>
                <tbody>
                  {paceData.map((row, i) => {
                    const v = paceOf(row)
                    return (
                      <tr key={row.driver}>
                        <td className="font-num" style={{ fontWeight: 600, color: 'var(--muted)' }}>{i + 1}</td>
                        <td>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ width: 3, height: 14, background: teamColor(row.team) }} />
                            <span className="font-display" style={{ fontWeight: 700 }}>{row.driver}</span>
                          </span>
                        </td>
                        <td style={{ color: 'var(--muted)', fontSize: 12 }}>{row.team}</td>
                        <td className="font-num" style={{ color: 'var(--sector-green)', fontWeight: 600 }}>
                          {v != null ? formatLapTime(v) : '—'}
                        </td>
                        <td className="font-num" style={{ color: 'var(--muted)' }}>
                          {v != null && paceBase != null ? (v - paceBase === 0 ? '—' : `+${(v - paceBase).toFixed(3)}s`) : '—'}
                        </td>
                        <td className="font-num" style={{ color: 'var(--muted)' }}>
                          {row.avg_lap ? formatLapTime(row.avg_lap) : '—'}
                        </td>
                        <td className="font-num" style={{ color: 'var(--muted)', opacity: 0.7 }}>
                          {row.std_dev ? `±${row.std_dev.toFixed(3)}s` : '—'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </TableToggle>
          )}
        </motion.div>
      )}

      {/* ========================== TYRE DEGRADATION ========================== */}
      {tab === 'Tyre Degradation' && (
        <motion.div key="deg" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
            <button onClick={loadDeg} disabled={degLoading} style={{ ...primaryBtn, opacity: degLoading ? 0.55 : 1 }}>
              <CircleDot size={13} />{degLoading ? 'Computing…' : 'Load Degradation Data'}
            </button>
            {degData.length > 0 && (
              <span className="font-num" style={{ fontSize: 11, color: 'var(--muted)' }}>
                {degData.length} stints · {degCompounds.length} compounds · round {round}
              </span>
            )}
          </div>

          {degLoading && <AnalysisSkeleton height={400} />}

          {!degLoading && degData.length === 0 && (
            degError ? (
              <ErrorState message={degError} onRetry={loadDeg} />
            ) : (
              <EmptyState
                icon={<CircleDot size={30} />}
                title="No stint data loaded"
                body="Degradation is fitted per stint from the race laps — one regression per driver, per compound. The first load for a round can take a minute while fastf1 warms up."
                action={<button onClick={loadDeg} style={primaryBtn}><CircleDot size={13} />Load Degradation Data</button>}
              />
            )
          )}

          {!degLoading && degData.length > 0 && (
            <>
              <KpiRow>
                <KpiTile label="Stints analysed" value={String(degData.length)} sub={`${degCompounds.length} compounds`} delay={0} />
                <KpiTile label="Drivers" value={String(new Set(degData.map(d => d.driver)).size)} sub="with fitted stints" delay={0.04} />
                <KpiTile
                  label="Gentlest stint" value={gentlest ? gentlest.driver : '—'}
                  sub={gentlest?.deg_rate != null ? `+${gentlest.deg_rate.toFixed(3)}s/lap · ${gentlest.compound}` : undefined}
                  accent="var(--sector-green)" delay={0.08}
                />
                <KpiTile
                  label="Harshest stint" value={harshest ? harshest.driver : '—'}
                  sub={harshest?.deg_rate != null ? `+${harshest.deg_rate.toFixed(3)}s/lap · ${harshest.compound}` : undefined}
                  accent="var(--accent)" delay={0.12}
                />
                <KpiTile
                  label="Longest stint" value={longestStint ? `${longestStint.stint_laps}L` : '—'}
                  sub={longestStint ? `${longestStint.driver} · ${longestStint.compound}` : undefined}
                  accent="var(--amber)" delay={0.16}
                />
              </KpiRow>

              <div className="live-grid" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2.4fr) minmax(280px, 1fr)', gap: 14, alignItems: 'start', marginBottom: 14 }}>
                <div className="featured-card" style={{ padding: 18 }}>
                  <h2 className="section-title" style={{ marginBottom: 16 }}>
                    <span style={{ display: 'inline-flex', color: 'var(--accent)' }}><Gauge size={13} /></span>
                    Stint pace vs tyre life — by compound
                  </h2>
                  <ChartFrame height={400}>
                    <ScatterChart margin={{ top: 8, right: 22, bottom: 22, left: 6 }}>
                      <CartesianGrid stroke={GRID_STROKE} strokeOpacity={0.18} />
                      <XAxis
                        type="number" dataKey="stint_laps" name="Stint laps"
                        tick={AXIS_TICK} axisLine={AXIS_LINE} tickLine={false}
                        label={{ value: 'STINT LENGTH (LAPS)', position: 'insideBottom', offset: -10, ...AXIS_LABEL }}
                      />
                      <YAxis
                        type="number" dataKey="avg_pace" name="Avg pace"
                        tick={AXIS_TICK} axisLine={AXIS_LINE} tickLine={false}
                        domain={['dataMin - 0.5', 'dataMax + 0.5']} tickFormatter={(v: number) => v.toFixed(1)} width={54}
                      />
                      <ZAxis type="number" dataKey="deg_rate" range={[40, 260]} name="Deg rate" />
                      <Tooltip
                        cursor={{ stroke: 'currentColor', strokeOpacity: 0.35 }}
                        contentStyle={tooltipStyle} itemStyle={tooltipItem} labelStyle={tooltipLabel}
                        formatter={(v, n) => {
                          if (n === 'Avg pace') return [formatLapTime(Number(v)), 'Avg pace']
                          if (n === 'Deg rate') return [`+${Number(v).toFixed(3)}s/lap`, 'Deg rate']
                          return [String(v), String(n)]
                        }}
                      />
                      {degCompounds.map(c => (
                        <Scatter
                          key={c} name={c} fill={compoundColor(c)} fillOpacity={0.78}
                          data={degData.filter(d => d.compound === c)}
                        />
                      ))}
                    </ScatterChart>
                  </ChartFrame>
                  <div style={{ ...noteStyle, marginTop: 10, borderTop: '1px solid var(--hairline)', paddingTop: 10 }}>
                    Each dot is one stint. Bubble size scales with degradation rate — bigger means the tyre
                    fell away faster. Lower on the chart is quicker.
                  </div>
                </div>

                <div style={{ display: 'grid', gap: 14 }}>
                  <Rail title="Compounds" icon={<CircleDot size={13} />} accent="var(--amber)">
                    <div style={{ display: 'grid', gap: 10 }}>
                      {compoundSummary.map(c => (
                        <div key={c.compound} style={{ borderLeft: `2px solid ${compoundColor(c.compound)}`, paddingLeft: 11 }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                            <span className="font-display" style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.08em' }}>{c.compound}</span>
                            <span className="font-num" style={{ fontSize: 12, fontWeight: 700, color: degColor(c.medianDeg) }}>
                              {c.medianDeg != null ? `+${c.medianDeg.toFixed(3)}s/L` : '—'}
                            </span>
                          </div>
                          <div className="font-num" style={{ fontSize: 10.5, color: 'var(--muted)', marginTop: 3 }}>
                            {c.stints} stint{c.stints === 1 ? '' : 's'}
                            {c.medianLaps != null ? ` · median ${c.medianLaps.toFixed(0)} laps` : ''}
                            {c.bestPace != null ? ` · best ${formatLapTime(c.bestPace)}` : ''}
                          </div>
                        </div>
                      ))}
                    </div>
                    <div style={{ ...noteStyle, marginTop: 13, paddingTop: 12, borderTop: '1px solid var(--hairline)' }}>
                      Median degradation across every fitted stint on that compound — the honest middle,
                      not dragged around by one ruined set.
                    </div>
                  </Rail>

                  <Rail title="Reading the scale" icon={<Info size={13} />}>
                    <div style={{ display: 'grid', gap: 8 }}>
                      {[
                        { c: 'var(--sector-green)', l: 'Under +0.050s/lap', d: 'Tyre holding on — stint can be stretched.' },
                        { c: 'var(--amber)', l: '+0.050 to +0.150s/lap', d: 'Normal wear for a race stint.' },
                        { c: 'var(--accent)', l: 'Over +0.150s/lap', d: 'Falling off a cliff — pit window opens early.' },
                      ].map(r => (
                        <div key={r.l} style={{ display: 'flex', gap: 9, alignItems: 'flex-start' }}>
                          <span style={{ width: 8, height: 8, background: r.c, marginTop: 4, flexShrink: 0 }} />
                          <div>
                            <div className="font-num" style={{ fontSize: 11.5, color: 'var(--foreground)' }}>{r.l}</div>
                            <div style={{ fontSize: 10.5, color: 'var(--muted)', marginTop: 2, lineHeight: 1.45 }}>{r.d}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </Rail>
                </div>
              </div>
            </>
          )}

          {degData.length > 0 && !degLoading && (
            <TableToggle open={degTableOpen} onToggle={() => setDegTableOpen(o => !o)} label="data table">
              <table className="f1-table">
                <thead><tr><th>DRIVER</th><th>TEAM</th><th>COMPOUND</th><th>DEG RATE</th><th>AVG PACE</th><th>STINT LAPS</th></tr></thead>
                <tbody>
                  {[...degData].sort((a, b) => (a.deg_rate ?? Infinity) - (b.deg_rate ?? Infinity)).map((row, i) => {
                    const cmpColor = compoundColor(row.compound)
                    return (
                      <tr key={`${row.driver}-${i}`}>
                        <td>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ width: 3, height: 14, background: teamColor(row.team) }} />
                            <span className="font-display" style={{ fontWeight: 700 }}>{row.driver}</span>
                          </span>
                        </td>
                        <td style={{ color: 'var(--muted)', fontSize: 12 }}>{row.team}</td>
                        <td>
                          <span className="font-num" style={{
                            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                            width: 18, height: 18, borderRadius: 2, background: cmpColor,
                            fontSize: 10, fontWeight: 700,
                            color: DARK_LABEL_COMPOUNDS.includes(row.compound) ? '#000' : '#fff',
                          }}>
                            {row.compound[0]}
                          </span>
                        </td>
                        <td className="font-num" style={{ color: degColor(row.deg_rate), fontWeight: 600 }}>
                          {row.deg_rate != null ? `+${row.deg_rate.toFixed(3)}s/lap` : '—'}
                        </td>
                        <td className="font-num" style={{ color: 'var(--muted)' }}>{row.avg_pace ? formatLapTime(row.avg_pace) : '—'}</td>
                        <td className="font-num" style={{ color: 'var(--muted)' }}>{row.stint_laps}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </TableToggle>
          )}
        </motion.div>
      )}

      {/* ============================ STRATEGY SIM 2.0 ============================ */}
      {tab === 'Strategy Sim' && (
        <StrategySim
          round={round}
          stratDriver={stratDriver} setStratDriver={setStratDriver}
          pitLap={pitLap} setPitLap={setPitLap}
          totalLaps={totalLaps} setTotalLaps={setTotalLaps}
          compoundIn={compoundIn} setCompoundIn={setCompoundIn}
          compoundOut={compoundOut} setCompoundOut={setCompoundOut}
          scLaps={scLaps} toggleScLap={toggleScLap}
          rainOn={rainOn} setRainOn={setRainOn} rainFrom={rainFrom} setRainFrom={setRainFrom}
          stratResult={stratResult} stratLoading={stratLoading} runStrategySim={runStrategySim}
        />
      )}

      {/* ========================== CHAMPIONSHIP SIM ========================== */}
      {tab === 'Championship Sim' && (
        <motion.div key="champ" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}>
          <KpiRow>
            <KpiTile label="Drivers loaded" value={champDrivers.length ? String(champDrivers.length) : '—'} sub="top of the table" delay={0} />
            <KpiTile
              label="Current leader" value={champDrivers[0]?.driver ?? '—'}
              sub={champDrivers[0] ? `${champDrivers[0].current_points} pts` : undefined}
              accent="var(--amber)" delay={0.04}
            />
            <KpiTile label="Positions set" value={`${positionsSet}/${champDrivers.length || 0}`} sub="hypothetical finishes" delay={0.08} />
            <KpiTile label="Points on offer" value={String(pointsOnOffer)} sub="from the set positions" accent="var(--accent)" delay={0.12} />
            <KpiTile
              label="Projected leader" value={champResult?.[0]?.driver ?? '—'}
              sub={champResult ? `${(champResult[0] as any)?.projected ?? '—'} pts` : 'run a projection'}
              accent={champResult ? 'var(--sector-green)' : undefined} delay={0.16}
            />
          </KpiRow>

          <div className="live-grid" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 14, alignItems: 'start' }}>
            {/* ---- Inputs ---- */}
            <div className="glass-card" style={{ padding: 18 }}>
              <h2 className="section-title" style={{ marginBottom: 6 }}>
                <span style={{ display: 'inline-flex', color: 'var(--accent)' }}><Flag size={13} /></span>
                Hypothetical finish positions
              </h2>
              <div style={{ ...noteStyle, marginBottom: 14 }}>
                Set where each driver finishes the next race. Everything left blank scores nothing.
              </div>

              {champDrivers.length === 0 ? (
                <div className="shimmer" style={{ height: 280, borderRadius: 2 }} />
              ) : (
                <>
                  <div style={{ overflowX: 'auto' }}>
                    <table className="f1-table">
                      <thead><tr><th>DRIVER</th><th>CURRENT PTS</th><th>HYPOTHETICAL FINISH</th></tr></thead>
                      <tbody>
                        {champDrivers.map((d, i) => (
                          <tr key={d.driver}>
                            <td>
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 9 }}>
                                <span className="font-num" style={{ fontSize: 11, color: 'var(--muted)' }}>P{d.position}</span>
                                <span className="font-display" style={{ fontWeight: 700 }}>{d.driver}</span>
                              </span>
                            </td>
                            <td className="font-num" style={{ color: 'var(--muted)' }}>{d.current_points}</td>
                            <td>
                              <select
                                aria-label={`Hypothetical finish for ${d.driver}`}
                                value={d.finish_pos ?? ''}
                                onChange={e => setChampDrivers(prev => prev.map((p, pi) => pi === i ? { ...p, finish_pos: parseInt(e.target.value) || undefined } : p))}
                                style={{ ...inputStyle, width: 'auto', minWidth: 74, padding: '5px 8px', fontSize: 12 }}
                              >
                                <option value="">—</option>
                                {Array.from({ length: 20 }, (_, j) => j + 1).map(p => <option key={p} value={p}>P{p}</option>)}
                              </select>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--hairline)' }}>
                    <div style={labelStyle}>Points system</div>
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 16 }}>
                      {POINTS_SYS.map((p, i) => (
                        <span key={i} className="font-num" style={{
                          display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 1,
                          padding: '4px 8px', borderRadius: 2, minWidth: 34,
                          background: 'var(--surface)', border: '1px solid var(--border)',
                        }}>
                          <span style={{ fontSize: 9, color: 'var(--muted)' }}>P{i + 1}</span>
                          <span style={{ fontSize: 12, fontWeight: 700, color: i === 0 ? 'var(--amber)' : 'var(--foreground)' }}>{p}</span>
                        </span>
                      ))}
                    </div>
                    <button onClick={runChampSim} style={primaryBtn}>
                      <Trophy size={13} />Project Standings
                    </button>
                  </div>
                </>
              )}
            </div>

            {/* ---- Projection ---- */}
            <div className="featured-card" style={{ padding: 18 }}>
              <h2 className="section-title" style={{ marginBottom: 14 }}>
                <span style={{ display: 'inline-flex', color: 'var(--accent)' }}><Trophy size={13} /></span>
                Projected standings
              </h2>
              {champResult ? (
                <div style={{ overflowX: 'auto' }}>
                  <table className="f1-table">
                    <thead><tr><th>PROJ POS</th><th>DRIVER</th><th>MOVE</th><th>CURRENT</th><th>GAINED</th><th>PROJECTED</th></tr></thead>
                    <tbody>
                      {champResult.map((d: any, i) => {
                        const startPos = champDrivers.find(x => x.driver === d.driver)?.position
                        const move = startPos != null ? startPos - (i + 1) : 0
                        const gained = d.projected - d.current_points
                        return (
                          <tr key={d.driver}>
                            <td className="font-num" style={{ fontWeight: 700, color: i === 0 ? 'var(--amber)' : 'var(--foreground)' }}>P{i + 1}</td>
                            <td className="font-display" style={{ fontWeight: 700 }}>{d.driver}</td>
                            <td className="font-num" style={{ color: move > 0 ? 'var(--sector-green)' : move < 0 ? 'var(--accent)' : 'var(--muted)' }}>
                              {move > 0 ? `▲${move}` : move < 0 ? `▼${Math.abs(move)}` : '–'}
                            </td>
                            <td className="font-num" style={{ color: 'var(--muted)' }}>{d.current_points}</td>
                            <td className="font-num" style={{ color: gained > 0 ? 'var(--sector-green)' : 'var(--muted)' }}>
                              {gained > 0 ? `+${gained}` : '—'}
                            </td>
                            <td className="font-num" style={{ fontWeight: 700 }}>{d.projected}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                  <div style={{ ...noteStyle, marginTop: 12, borderTop: '1px solid var(--hairline)', paddingTop: 10 }}>
                    MOVE compares the projected order with the current championship position.
                  </div>
                </div>
              ) : (
                <EmptyState
                  icon={<Trophy size={28} />}
                  title="No projection yet"
                  body="Set one or more hypothetical finishing positions on the left, then hit Project Standings. The table updates side by side so you can see the swing as you change positions."
                />
              )}
            </div>
          </div>
        </motion.div>
      )}
    </>
  )
}

/* ============================================================================
   Strategy Sim 2.0 — controls on the left, live timeline + results on the right
   ========================================================================== */
function StrategySim(props: {
  round: number
  stratDriver: string; setStratDriver: (v: string) => void
  pitLap: number; setPitLap: (v: number) => void
  totalLaps: number; setTotalLaps: (v: number) => void
  compoundIn: string; setCompoundIn: (v: string) => void
  compoundOut: string; setCompoundOut: (v: string) => void
  scLaps: number[]; toggleScLap: (l: number) => void
  rainOn: boolean; setRainOn: (v: boolean) => void; rainFrom: number; setRainFrom: (v: number) => void
  stratResult: StrategyResult | null; stratLoading: boolean; runStrategySim: () => void
}) {
  const {
    stratDriver, setStratDriver, pitLap, setPitLap, totalLaps, setTotalLaps,
    compoundIn, setCompoundIn, compoundOut, setCompoundOut, scLaps, toggleScLap,
    rainOn, setRainOn, rainFrom, setRainFrom, stratResult, stratLoading, runStrategySim,
  } = props

  const clampPit = (v: number) => Math.max(1, Math.min(totalLaps - 1, v))
  const stint1 = clampPit(pitLap)
  const stint2 = totalLaps - stint1
  const pct1 = (stint1 / totalLaps) * 100

  // SC lap candidate chips — sprinkle a few plausible options across the race
  const scCandidates = Array.from(new Set([
    Math.round(totalLaps * 0.15), Math.round(totalLaps * 0.3),
    Math.round(totalLaps * 0.5), Math.round(totalLaps * 0.7), Math.round(totalLaps * 0.85),
  ])).filter(l => l > 0 && l < totalLaps)

  return (
    <motion.div
      key="strat" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}
      className="live-grid"
      style={{ display: 'grid', gridTemplateColumns: 'minmax(min(300px, 100%), 1fr) minmax(0, 1.65fr)', gap: 14, alignItems: 'start' }}
    >
      {/* ------------------------------ CONTROLS ------------------------------ */}
      <div className="glass-card" style={{ padding: 18 }}>
        <h2 className="section-title" style={{ marginBottom: 6 }}>
          <span style={{ display: 'inline-flex', color: 'var(--accent)' }}><Route size={13} /></span>
          Simulator inputs
        </h2>
        <div style={{ ...noteStyle, marginBottom: 16 }}>
          One pit stop, two stints. Change the window and see what it costs.
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(128px, 1fr))', gap: 11, marginBottom: 18 }}>
          <Field label="Driver">
            <input value={stratDriver} onChange={e => setStratDriver(e.target.value.toUpperCase())} placeholder="e.g. HAM"
              style={inputStyle} />
          </Field>
          <Field label="Total laps">
            <input type="number" value={totalLaps} min={5} max={80} onChange={e => setTotalLaps(parseInt(e.target.value) || 57)} style={inputStyle} />
          </Field>
          <Field label="Compound in">
            <select aria-label="Compound in" value={compoundIn} onChange={e => setCompoundIn(e.target.value)} style={inputStyle}>
              {DRY_COMPOUNDS.map(c => <option key={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="Compound out">
            <select aria-label="Compound out" value={compoundOut} onChange={e => setCompoundOut(e.target.value)} style={inputStyle}>
              {[...DRY_COMPOUNDS, 'INTERMEDIATE', 'WET'].map(c => <option key={c}>{c}</option>)}
            </select>
          </Field>
        </div>

        {/* Pit-stop stepper */}
        <div style={{ marginBottom: 18 }}>
          <div style={labelStyle}>Pit stop</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <StepBtn onClick={() => setPitLap(clampPit(stint1 - 1))}>−</StepBtn>
            <span className="stat-num" style={{ fontSize: 22, minWidth: 52, textAlign: 'center' }}>L{stint1}</span>
            <StepBtn onClick={() => setPitLap(clampPit(stint1 + 1))}>+</StepBtn>
            <span className="font-num" style={{ fontSize: 11, color: 'var(--muted)', marginLeft: 4 }}>
              {stint1} + {stint2} laps
            </span>
          </div>
        </div>

        {/* SC toggle chips */}
        <div style={{ marginBottom: 18 }}>
          <div style={labelStyle}>Safety car — pick 1-2 laps</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {scCandidates.map(l => {
              const on = scLaps.includes(l)
              return (
                <button key={l} onClick={() => toggleScLap(l)} style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  padding: '5px 11px', borderRadius: 2, cursor: 'pointer',
                  fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700,
                  border: `1px solid ${on ? 'var(--amber)' : 'var(--border)'}`,
                  background: on ? 'rgba(255,200,0,0.12)' : 'var(--surface)',
                  color: on ? 'var(--amber)' : 'var(--muted)',
                }}>
                  {on && <Flag size={10} />}L{l}
                </button>
              )
            })}
          </div>
          {scLaps.length > 0 && (
            <div className="font-num" style={{ fontSize: 10.5, color: 'var(--amber)', marginTop: 8 }}>
              SC pace ×1.4 · pit loss halved
            </div>
          )}
        </div>

        {/* Rain toggle + lap input */}
        <div style={{ marginBottom: 20 }}>
          <div style={labelStyle}>Weather</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <button onClick={() => setRainOn(!rainOn)} style={{
              display: 'inline-flex', alignItems: 'center', gap: 7,
              padding: '6px 13px', borderRadius: 2, cursor: 'pointer',
              fontFamily: 'var(--font-display)', fontSize: 11, fontWeight: 700,
              letterSpacing: '0.08em', textTransform: 'uppercase',
              border: `1px solid ${rainOn ? 'var(--compound-wet)' : 'var(--border)'}`,
              background: rainOn ? 'rgba(0,103,255,0.14)' : 'var(--surface)',
              color: rainOn ? 'var(--compound-wet)' : 'var(--muted)',
            }}>
              <CloudRain size={12} />{rainOn ? 'Rain on' : 'Rain off'}
            </button>
            {rainOn && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 11, color: 'var(--muted)' }}>from lap</span>
                <input type="number" value={rainFrom} min={1} max={totalLaps} onChange={e => setRainFrom(Math.max(1, Math.min(totalLaps, parseInt(e.target.value) || 1)))}
                  style={{ ...inputStyle, width: 74, padding: '6px 8px', textAlign: 'center' }} />
              </div>
            )}
          </div>
          {rainOn && (
            <div className="font-num" style={{ fontSize: 10.5, color: 'var(--compound-wet)', marginTop: 8 }}>
              Dry tyres +8s &amp; deg ×3
            </div>
          )}
        </div>

        <button onClick={runStrategySim} disabled={stratLoading || !stratDriver} style={{
          ...primaryBtn, width: '100%', justifyContent: 'center',
          opacity: stratLoading || !stratDriver ? 0.55 : 1,
          cursor: stratLoading || !stratDriver ? 'default' : 'pointer',
        }}>
          <Play size={13} />{stratLoading ? 'Simulating…' : 'Run Simulation'}
        </button>
        {!stratDriver && (
          <div style={{ ...noteStyle, marginTop: 10 }}>Enter a driver code to enable the simulation.</div>
        )}
        {stratLoading && (
          <div style={{ ...noteStyle, marginTop: 10 }}>
            First run for a round can take a minute — fastf1 is loading the race.
          </div>
        )}
      </div>

      {/* ------------------------------ RESULTS ------------------------------ */}
      <div style={{ display: 'grid', gap: 14 }}>
        {/* Live stint timeline — always visible, follows the controls */}
        <div className="featured-card" style={{ padding: 18 }}>
          <h2 className="section-title" style={{ marginBottom: 14 }}>
            <span style={{ display: 'inline-flex', color: 'var(--accent)' }}><Timer size={13} /></span>
            Stint timeline
          </h2>
          <div style={{ position: 'relative', display: 'flex', height: 38, border: '1px solid var(--border)', borderRadius: 2, overflow: 'hidden' }}>
            <motion.div
              initial={false} animate={{ width: `${pct1}%` }} transition={{ type: 'spring', stiffness: 200, damping: 26 }}
              style={{ background: compoundColor(compoundIn), display: 'flex', alignItems: 'center', justifyContent: 'center', minWidth: 0 }}
            >
              <span className="font-display" style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.1em', color: DARK_LABEL_COMPOUNDS.includes(compoundIn) ? '#000' : '#fff' }}>
                {compoundIn}
              </span>
            </motion.div>
            <div style={{ flex: 1, background: compoundColor(compoundOut), display: 'flex', alignItems: 'center', justifyContent: 'center', minWidth: 0 }}>
              <span className="font-display" style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.1em', color: DARK_LABEL_COMPOUNDS.includes(compoundOut) ? '#000' : '#fff' }}>
                {compoundOut}
              </span>
            </div>
            {/* SC lap markers */}
            {scLaps.map(l => (
              <div key={l} style={{ position: 'absolute', top: 0, bottom: 0, left: `${(l / totalLaps) * 100}%`, width: 2, background: 'var(--amber)' }} title={`SC lap ${l}`} />
            ))}
            {rainOn && (
              <div style={{ position: 'absolute', top: 0, bottom: 0, left: `${(rainFrom / totalLaps) * 100}%`, right: 0, background: 'rgba(0,103,255,0.22)', borderLeft: '2px dashed var(--compound-wet)' }} title={`Rain from lap ${rainFrom}`} />
            )}
          </div>
          <div className="font-num" style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--muted)', marginTop: 6 }}>
            <span>LAP 1</span>
            <span style={{ color: 'var(--foreground)' }}>PIT L{stint1}</span>
            <span>LAP {totalLaps}</span>
          </div>

          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--hairline)' }}>
            {[
              { c: compoundColor(compoundIn), l: `Stint 1 · ${stint1} laps` },
              { c: compoundColor(compoundOut), l: `Stint 2 · ${stint2} laps` },
              ...(scLaps.length ? [{ c: 'var(--amber)', l: `Safety car · ${scLaps.map(l => `L${l}`).join(', ')}` }] : []),
              ...(rainOn ? [{ c: 'var(--compound-wet)', l: `Rain from L${rainFrom}` }] : []),
            ].map(x => (
              <span key={x.l} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 11, color: 'var(--muted)' }}>
                <span style={{ width: 9, height: 9, background: x.c, flexShrink: 0 }} />{x.l}
              </span>
            ))}
          </div>
        </div>

        {stratLoading && (
          <div className="glass-card" style={{ padding: 18 }}>
            <div className="shimmer" style={{ height: 10, width: 190, borderRadius: 2, marginBottom: 16 }} />
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 16 }}>
              {[0, 1, 2].map(i => <div key={i} className="shimmer" style={{ height: 62, borderRadius: 2 }} />)}
            </div>
            <div className="shimmer" style={{ height: 200, borderRadius: 2 }} />
          </div>
        )}

        {!stratLoading && stratResult && (
          <StrategyResultCard result={stratResult} driver={stratDriver} totalLaps={totalLaps} scLaps={scLaps} rainOn={rainOn} rainFrom={rainFrom} />
        )}

        {!stratLoading && !stratResult && (
          <EmptyState
            icon={<Route size={30} />}
            title="No simulation run yet"
            body="Set the driver, pit lap and compounds on the left, then run the simulation. The projected finish, cumulative race time and finishing order land here without hiding the controls."
          />
        )}
      </div>
    </motion.div>
  )
}

function StrategyResultCard({ result, driver, totalLaps, scLaps, rainOn, rainFrom }: {
  result: StrategyResult; driver: string; totalLaps: number; scLaps: number[]; rainOn: boolean; rainFrom: number
}) {
  // Build an animated finishing order: our driver at predicted_finish, filler slots around it.
  const finish = result.predicted_finish
  const order = Array.from({ length: Math.min(totalLaps > 0 ? 20 : 10, 20) }, (_, i) => i + 1).slice(0, Math.max(finish + 2, 6))
  const timeline = result.timeline || []
  const better = result.time_delta < 0

  return (
    <div className="glass-card" style={{ padding: 18 }}>
      <h2 className="section-title" style={{ marginBottom: 14 }}>
        <span style={{ display: 'inline-flex', color: 'var(--accent)' }}><Gauge size={13} /></span>
        Simulation result — {driver}
      </h2>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 16 }}>
        <KpiTile label="Predicted finish" value={`P${result.predicted_finish}`} sub="on this strategy" />
        <KpiTile
          label="vs flat baseline"
          value={`${result.time_delta > 0 ? '+' : ''}${result.time_delta?.toFixed(1)}s`}
          sub={better ? 'strategy gains time' : 'strategy costs time'}
          accent={better ? 'var(--sector-green)' : 'var(--accent)'}
          delay={0.04}
        />
        {result.estimated_total_s != null && (
          <KpiTile label="Est. total" value={`${(result.estimated_total_s / 60).toFixed(1)}m`} sub={`${totalLaps} laps`} delay={0.08} />
        )}
      </div>

      {/* Cumulative time timeline */}
      {timeline.length > 0 && (
        <div style={{ marginBottom: 18 }}>
          <div style={labelStyle}>Cumulative race time</div>
          <ChartFrame height={220}>
            <BarChart data={timeline} margin={{ top: 4, right: 8, bottom: 4, left: -4 }}>
              <CartesianGrid stroke={GRID_STROKE} strokeOpacity={0.18} vertical={false} />
              <XAxis dataKey="lap" tick={AXIS_TICK} axisLine={AXIS_LINE} tickLine={false} interval={Math.ceil(timeline.length / 10)} />
              <YAxis tick={AXIS_TICK} axisLine={AXIS_LINE} tickLine={false} tickFormatter={(v: number) => `${Math.round(v / 60)}m`} width={42} />
              <Tooltip
                cursor={{ fill: 'rgba(255,255,255,0.03)' }}
                contentStyle={tooltipStyle} itemStyle={tooltipItem} labelStyle={tooltipLabel}
                formatter={(v) => [`${(Number(v) / 60).toFixed(2)} min`, 'Elapsed']}
                labelFormatter={(l) => `Lap ${l}`}
              />
              <Bar dataKey="cumulative_s" isAnimationActive>
                {timeline.map((t, i) => {
                  const isSc = scLaps.includes(t.lap)
                  const isRain = rainOn && t.lap >= rainFrom
                  return <Cell key={i} fill={isSc ? 'var(--amber)' : isRain ? 'var(--compound-wet)' : 'var(--muted)'} />
                })}
              </Bar>
            </BarChart>
          </ChartFrame>
          <div style={{ ...noteStyle, marginTop: 6 }}>
            Yellow bars are safety-car laps, blue bars are run in the wet.
          </div>
        </div>
      )}

      {/* Animated finishing order — reorders when params change */}
      <div>
        <div style={labelStyle}>Projected finishing order</div>
        <div style={{ display: 'grid', gap: 4 }}>
          <AnimatePresence>
            {order.map(pos => {
              const isMe = pos === result.predicted_finish
              return (
                <motion.div
                  key={pos}
                  layout
                  initial={{ opacity: 0, x: -12 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12, padding: '8px 12px', borderRadius: 2,
                    background: isMe ? 'rgba(225,6,0,0.10)' : 'var(--surface)',
                    border: '1px solid var(--hairline)',
                    borderLeft: `2px solid ${isMe ? 'var(--accent)' : 'var(--border)'}`,
                  }}
                >
                  <span className="font-num" style={{ width: 32, fontSize: 13, fontWeight: 800, color: isMe ? 'var(--accent)' : 'var(--muted)' }}>P{pos}</span>
                  <span className="font-display" style={{ flex: 1, fontSize: 12.5, fontWeight: isMe ? 800 : 500, letterSpacing: '0.04em', color: isMe ? 'var(--foreground)' : 'var(--muted)' }}>
                    {isMe ? driver : '— rival pace —'}
                  </span>
                  {isMe && (
                    <span className="font-num" style={{ fontSize: 12, fontWeight: 700, color: better ? 'var(--sector-green)' : 'var(--accent)' }}>
                      {result.time_delta > 0 ? '+' : ''}{result.time_delta?.toFixed(1)}s
                    </span>
                  )}
                </motion.div>
              )
            })}
          </AnimatePresence>
        </div>
        {result.notes && (
          <div style={{ ...noteStyle, marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--hairline)' }}>{result.notes}</div>
        )}
      </div>
    </div>
  )
}

/* ---- small shared UI ---- */

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label>
      <div style={labelStyle}>{label}</div>
      {children}
    </label>
  )
}

function StepBtn({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} style={{
      width: 40, height: 40, borderRadius: 2, cursor: 'pointer',
      background: 'var(--surface)', border: '1px solid var(--border)',
      color: 'var(--foreground)', fontSize: 16, fontWeight: 700, lineHeight: 1,
    }}>{children}</button>
  )
}
