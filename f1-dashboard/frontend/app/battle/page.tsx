'use client'

import { useState, useMemo } from 'react'
import { motion } from 'framer-motion'
import { Swords, Flag, Timer, Zap, Trophy, Gauge } from 'lucide-react'
import {
  ResponsiveContainer, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar,
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  BarChart, Bar, Cell, ReferenceLine,
} from 'recharts'
import { TEAM_COLORS } from '@/lib/constants'
import { hexColor } from '@/lib/utils'
import { formatLapTime } from '@/lib/ist'
import { ApiError, useApiList } from '@/lib/api/client'
import { useCalendar, useStandings } from '@/lib/api/hooks'
import type { DriverStanding, LapData, SectorBest, SessionResult } from '@/lib/types'
import { CHART_GRID as GRID } from '@/lib/chartTheme'
import { roundOptionLabel } from '@/lib/weekend'

const YEAR = 2026

/* ---- shared dark chart theme ---- */
const AXIS = { fill: '#9CA3AF', fontSize: 11 }
const tooltipStyle = { background: '#161616', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8, fontSize: 12 }
const tooltipItem = { color: '#E5E7EB' }
const tooltipLabel = { color: '#9CA3AF', fontSize: 11 }

function driverColor(d: DriverStanding | undefined): string {
  if (!d) return '#888'
  return hexColor(d.team_color) || TEAM_COLORS[d.team] || '#888'
}

/* Skeleton shown while a section loads */
function SectionSkeleton({ note }: { note?: boolean }) {
  return (
    <div>
      <div className="shimmer" style={{ height: 120, borderRadius: 12 }} />
      {note && (
        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 10 }}>
          First load can take a minute — fastf1 is warming up the session cache.
        </div>
      )}
    </div>
  )
}

function Unavailable({ label }: { label: string }) {
  return (
    <div style={{ fontSize: 12, color: 'var(--muted)', padding: '18px 6px', textAlign: 'center' }}>
      {label} — data unavailable for this round.
    </div>
  )
}

/* Card wrapper with staggered whileInView entrance */
function BattleCard({ icon, title, accent, children, delay = 0 }: {
  icon: React.ReactNode; title: string; accent?: string; children: React.ReactNode; delay?: number
}) {
  return (
    <motion.section
      className="glass-card"
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.15 }}
      transition={{ duration: 0.5, delay }}
      style={{ padding: 20 }}
    >
      <h2 className="section-title" style={{ marginBottom: 16, ...(accent ? { ['--bar' as string]: accent } : {}) }}>
        <span style={{ display: 'inline-flex', color: accent || 'var(--accent)' }}>{icon}</span>
        {title}
      </h2>
      {children}
    </motion.section>
  )
}

/* ---------- Driver picker (chips grid, predictor DriverGrid pattern) ---------- */
function DriverPicker({ drivers, selected, onPick, taken }: {
  drivers: DriverStanding[]; selected: string; onPick: (a: string) => void; taken?: string
}) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
      {drivers.map(d => {
        const color = driverColor(d)
        const isSel = selected === d.abbreviation
        const isTaken = !isSel && taken === d.abbreviation
        return (
          <button
            key={d.abbreviation}
            onClick={() => onPick(d.abbreviation)}
            disabled={isTaken}
            title={d.team}
            style={{
              padding: '5px 10px', borderRadius: 7, fontSize: 11, fontWeight: 700,
              cursor: isTaken ? 'default' : 'pointer',
              background: isSel ? `${color}2b` : 'rgba(255,255,255,0.04)',
              border: `1px solid ${isSel ? color : 'rgba(255,255,255,0.1)'}`,
              color: isSel ? '#fff' : '#9CA3AF',
              opacity: isTaken ? 0.3 : 1,
            }}
          >
            {d.abbreviation}
          </button>
        )
      })}
    </div>
  )
}

/* =================================================================== */

interface RoundOpt { round: number; name: string }

type LoadState<T> = { status: 'idle' | 'loading' | 'ready' | 'error'; data: T | null }
const idle = <T,>(): LoadState<T> => ({ status: 'idle', data: null })

/** Adapts a useApiList result into the LoadState shape the section cards expect. */
function toLoadState<T>(guard: boolean, isLoading: boolean, error: unknown, data: T): LoadState<T> {
  if (!guard) return idle()
  // A backend that is still waking is not a failed request: the client is
  // retrying and the card is about to fill in. Rendering an error there tells
  // the visitor something is broken during a routine cold start.
  const waking = error instanceof ApiError && error.unreachable
  if (isLoading || waking) return { status: 'loading', data: null }
  if (error) return { status: 'error', data: null }
  return { status: 'ready', data }
}

export default function BattlePage() {
  const { data: standingsData } = useStandings(YEAR)
  const { data: calendarData } = useCalendar(YEAR)
  const standings = standingsData ?? null
  // Completed rounds come from standings.rounds (status === 'complete'); calendar
  // gives nicer names, preferred when available.
  const rounds: RoundOpt[] = useMemo(() => {
    const done = (standingsData?.rounds || []).filter(r => r.status === 'complete')
    return done.map(r => ({ round: r.round, name: calendarData.find(c => c.round === r.round)?.name || r.name }))
  }, [standingsData, calendarData])

  const [roundOverride, setRoundOverride] = useState<number | null>(null)
  // Default to the latest finished round until the user picks one explicitly.
  const round = roundOverride ?? (rounds.length ? rounds[rounds.length - 1].round : null)
  const setRound = (r: number | null) => setRoundOverride(r)

  const [d1, setD1] = useState('')
  const [d2, setD2] = useState('')

  const drivers = standings?.drivers || []
  const dA = drivers.find(d => d.abbreviation === d1)
  const dB = drivers.find(d => d.abbreviation === d2)
  const colorA = driverColor(dA)
  const colorB = driverColor(dB)
  const bothPicked = !!(d1 && d2 && d1 !== d2)

  /* ---- per-section requests, each independent ----
   * A cold fastf1 round takes up to a minute; SWR keys them by round + driver
   * so switching selection never lets a stale response paint over the new one. */
  const guard = bothPicked && round != null

  const lapsA = useApiList<LapData>(guard ? `/api/sessions/${YEAR}/${round}/Race/laps?driver=${d1}` : null)
  const lapsB = useApiList<LapData>(guard ? `/api/sessions/${YEAR}/${round}/Race/laps?driver=${d2}` : null)
  const sectorsReq = useApiList<SectorBest>(guard ? `/api/sessions/${YEAR}/${round}/Race/best-sectors` : null)
  const resultsReq = useApiList<SessionResult>(guard ? `/api/sessions/${YEAR}/${round}/Race/results` : null)
  const qualiReq = useApiList<SessionResult>(guard ? `/api/sessions/${YEAR}/${round}/Qualifying/results` : null)

  const lapsState: LoadState<{ a: LapData[]; b: LapData[] }> = !guard
    ? idle()
    : lapsA.isLoading || lapsB.isLoading
      ? { status: 'loading', data: null }
      : lapsA.error || lapsB.error
        ? { status: 'error', data: null }
        : { status: 'ready', data: { a: lapsA.data, b: lapsB.data } }

  const sectorsState = toLoadState(guard, sectorsReq.isLoading, sectorsReq.error, sectorsReq.data)
  const resultsState = toLoadState(guard, resultsReq.isLoading, resultsReq.error, resultsReq.data)
  const qualiState = toLoadState(guard, qualiReq.isLoading, qualiReq.error, qualiReq.data)

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: '24px 16px', position: 'relative', zIndex: 1 }}>
      <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} style={{ marginBottom: 18 }}>
        <div className="kicker" style={{ marginBottom: 8 }}>Head to Head</div>
        <h1 className="display-title" style={{ fontSize: 'clamp(28px, 5vw, 44px)', margin: 0 }}>Battle Hub</h1>
        <div style={{ color: '#9CA3AF', fontSize: 13, marginTop: 6 }}>
          Pick two drivers and a completed round to break the fight down section by section.
        </div>
      </motion.div>

      {/* ---- Picker bar ---- */}
      <div className="glass-card" style={{ padding: 18, marginBottom: 20 }}>
        {!standings ? (
          <div className="shimmer" style={{ height: 90, borderRadius: 10 }} />
        ) : (
          <div style={{ display: 'grid', gap: 16 }}>
            <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 260 }}>
                <div style={{ fontSize: 10, color: colorA, fontWeight: 700, letterSpacing: '0.06em', marginBottom: 7, textTransform: 'uppercase' }}>
                  Driver A {d1 && `· ${d1}`}
                </div>
                <DriverPicker drivers={drivers} selected={d1} onPick={setD1} taken={d2} />
              </div>
              <div style={{ flex: 1, minWidth: 260 }}>
                <div style={{ fontSize: 10, color: colorB, fontWeight: 700, letterSpacing: '0.06em', marginBottom: 7, textTransform: 'uppercase' }}>
                  Driver B {d2 && `· ${d2}`}
                </div>
                <DriverPicker drivers={drivers} selected={d2} onPick={setD2} taken={d1} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <div style={{ fontSize: 11, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Round</div>
              {rounds.length ? (
                <select
                  aria-label="Round"
                  value={round ?? ''}
                  onChange={e => setRound(parseInt(e.target.value) || null)}
                  style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.12)', color: '#fff', padding: '7px 12px', borderRadius: 8, fontSize: 13, minWidth: 220 }}
                >
                  {rounds.map(r => (
                    <option key={r.round} value={r.round}>{roundOptionLabel(r)}</option>
                  ))}
                </select>
              ) : (
                <span style={{ fontSize: 12, color: 'var(--muted)' }}>No completed rounds yet this season.</span>
              )}
            </div>
          </div>
        )}
      </div>

      {!bothPicked ? (
        <div className="glass-card" style={{ padding: 48, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
          Select two different drivers above to open the battle.
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 16 }}>
          <HeadToHead dA={dA} dB={dB} colorA={colorA} colorB={colorB} />
          <RadarOverview dA={dA} dB={dB} colorA={colorA} colorB={colorB} laps={lapsState} />
          <QualiTally d1={d1} d2={d2} colorA={colorA} colorB={colorB} state={qualiState} />
          <RacePace d1={d1} d2={d2} colorA={colorA} colorB={colorB} state={lapsState} />
          <SectorDeltas d1={d1} d2={d2} colorA={colorA} colorB={colorB} state={sectorsState} />
          <StartPerformance d1={d1} d2={d2} colorA={colorA} colorB={colorB} state={resultsState} />
        </div>
      )}
    </div>
  )
}

/* ================== 1. Season head-to-head strip ================== */
function HeadToHead({ dA, dB, colorA, colorB }: {
  dA?: DriverStanding; dB?: DriverStanding; colorA: string; colorB: string
}) {
  if (!dA || !dB) return null
  const ptsA = dA.points || 0
  const ptsB = dB.points || 0
  const total = ptsA + ptsB || 1
  const shareA = (ptsA / total) * 100

  const Stat = ({ label, a, b }: { label: string; a: React.ReactNode; b: React.ReactNode }) => (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 0' }}>
      <span className="font-num" style={{ fontSize: 20, fontWeight: 800, color: colorA, minWidth: 70, textAlign: 'left' }}>{a}</span>
      <span style={{ fontSize: 10, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</span>
      <span className="font-num" style={{ fontSize: 20, fontWeight: 800, color: colorB, minWidth: 70, textAlign: 'right' }}>{b}</span>
    </div>
  )

  return (
    <BattleCard icon={<Swords size={14} />} title="Season Head-to-Head" delay={0}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
        <span style={{ fontWeight: 800, fontSize: 15, color: colorA }}>{dA.abbreviation}</span>
        <span style={{ fontWeight: 800, fontSize: 15, color: colorB }}>{dB.abbreviation}</span>
      </div>
      <Stat label="Points" a={ptsA} b={ptsB} />
      <Stat label="Wins" a={dA.wins || 0} b={dB.wins || 0} />
      <Stat label="Championship Pos" a={`P${dA.position}`} b={`P${dB.position}`} />
      <Stat label="Podiums" a={dA.podiums || 0} b={dB.podiums || 0} />

      {/* Tug-of-war points share bar */}
      <div style={{ marginTop: 14 }}>
        <div style={{ fontSize: 10, color: '#9CA3AF', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Points share</div>
        <div style={{ display: 'flex', height: 22, borderRadius: 11, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.08)' }}>
          <motion.div
            initial={{ width: '50%' }} animate={{ width: `${shareA}%` }} transition={{ duration: 0.7, ease: 'easeOut' }}
            style={{ background: colorA, display: 'flex', alignItems: 'center', paddingLeft: 8 }}
          >
            <span className="font-num" style={{ fontSize: 11, fontWeight: 800, color: '#000', mixBlendMode: 'difference' }}>{Math.round(shareA)}%</span>
          </motion.div>
          <div style={{ flex: 1, background: colorB, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', paddingRight: 8 }}>
            <span className="font-num" style={{ fontSize: 11, fontWeight: 800, color: '#000', mixBlendMode: 'difference' }}>{Math.round(100 - shareA)}%</span>
          </div>
        </div>
      </div>
    </BattleCard>
  )
}

/* ================== 2. Radar overview ================== */
function lapStats(laps: LapData[] | undefined) {
  if (!laps || !laps.length) return null
  const times = laps.map(l => l.lap_time_s ?? l.lap_time_seconds).filter((t): t is number => typeof t === 'number' && t > 0)
  if (times.length < 3) return null
  const sorted = [...times].sort((a, b) => a - b)
  const median = sorted[Math.floor(sorted.length / 2)]
  // clean laps within 107% of median
  const clean = times.filter(t => t <= median * 1.07)
  const base = clean.length ? clean : times
  const avg = base.reduce((s, t) => s + t, 0) / base.length
  const mean = avg
  const variance = base.reduce((s, t) => s + (t - mean) ** 2, 0) / base.length
  const std = Math.sqrt(variance)
  return { avg, std, best: sorted[0], median }
}

function RadarOverview({ dA, dB, colorA, colorB, laps }: {
  dA?: DriverStanding; dB?: DriverStanding; colorA: string; colorB: string; laps: LoadState<{ a: LapData[]; b: LapData[] }>
}) {
  const chart = useMemo(() => {
    if (!dA || !dB) return null
    const maxPts = Math.max(dA.points || 0, dB.points || 0, 1)
    const maxWins = Math.max(dA.wins || 0, dB.wins || 0, 1)
    const norm = (v: number, mx: number) => Math.round((v / mx) * 100)

    const sA = laps.status === 'ready' ? lapStats(laps.data?.a) : null
    const sB = laps.status === 'ready' ? lapStats(laps.data?.b) : null
    const paceReady = !!(sA && sB)

    // Best-grid-avg proxy: use championship position inverse (fewer = better) on 0-100
    const gridAxis = (d: DriverStanding) => {
      const totalDrivers = 20
      return Math.round(((totalDrivers - Math.min(d.position, totalDrivers) + 1) / totalDrivers) * 100)
    }

    // Race pace: lower avg = higher score. Consistency: lower std = higher score.
    let paceA = 50, paceB = 50, consA = 50, consB = 50
    if (paceReady && sA && sB) {
      const worst = Math.max(sA.avg, sB.avg)
      const best = Math.min(sA.avg, sB.avg)
      const span = worst - best || 1
      paceA = Math.round(((worst - sA.avg) / span) * 100)
      paceB = Math.round(((worst - sB.avg) / span) * 100)
      const wStd = Math.max(sA.std, sB.std)
      const bStd = Math.min(sA.std, sB.std)
      const sSpan = wStd - bStd || 1
      consA = Math.round(((wStd - sA.std) / sSpan) * 100)
      consB = Math.round(((wStd - sB.std) / sSpan) * 100)
    }

    const axes = [
      { axis: 'Points', A: norm(dA.points || 0, maxPts), B: norm(dB.points || 0, maxPts) },
      { axis: 'Wins', A: norm(dA.wins || 0, maxWins), B: norm(dB.wins || 0, maxWins) },
      { axis: 'Grid avg', A: gridAxis(dA), B: gridAxis(dB) },
      { axis: 'Race pace', A: paceA, B: paceB },
      { axis: 'Consistency', A: consA, B: consB },
    ]
    return { axes, paceReady }
  }, [dA, dB, laps])

  if (!dA || !dB) return null

  return (
    <BattleCard icon={<Gauge size={14} />} title="Radar Overview" delay={0.05}>
      {laps.status === 'loading' ? (
        <SectionSkeleton note />
      ) : chart ? (
        <>
          <div style={{ width: '100%', height: 320 }}>
            <ResponsiveContainer>
              <RadarChart data={chart.axes} outerRadius="72%">
                <PolarGrid stroke={GRID} />
                <PolarAngleAxis dataKey="axis" tick={{ fill: '#9CA3AF', fontSize: 11 }} />
                <PolarRadiusAxis domain={[0, 100]} tick={{ fill: 'var(--muted)', fontSize: 9 }} axisLine={false} />
                <Radar name={dA.abbreviation} dataKey="A" stroke={colorA} fill={colorA} fillOpacity={0.28} />
                <Radar name={dB.abbreviation} dataKey="B" stroke={colorB} fill={colorB} fillOpacity={0.28} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Tooltip contentStyle={tooltipStyle} itemStyle={tooltipItem} labelStyle={tooltipLabel} />
              </RadarChart>
            </ResponsiveContainer>
          </div>
          {!chart.paceReady && (
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8 }}>
              Race pace &amp; consistency use standings-only estimates — lap data was unavailable for this round.
            </div>
          )}
        </>
      ) : (
        <Unavailable label="Radar" />
      )}
    </BattleCard>
  )
}

/* ================== 3. Quali H2H tally ================== */
function QualiTally({ d1, d2, colorA, colorB, state }: {
  d1: string; d2: string; colorA: string; colorB: string; state: LoadState<SessionResult[]>
}) {
  const rowFor = (abbr: string) => state.data?.find(r => (r.abbreviation || r.driver) === abbr)
  const gridPos = (r?: SessionResult) => r?.grid_position ?? r?.grid ?? r?.position ?? null

  return (
    <BattleCard icon={<Flag size={14} />} title="Qualifying Head-to-Head" delay={0.1}>
      {state.status === 'loading' ? (
        <SectionSkeleton note />
      ) : state.status === 'ready' && state.data ? (
        (() => {
          const rA = rowFor(d1)
          const rB = rowFor(d2)
          const gA = gridPos(rA)
          const gB = gridPos(rB)
          if (gA == null && gB == null) return <Unavailable label="Qualifying" />
          const aWon = gA != null && gB != null && gA < gB
          return (
            <div style={{ display: 'flex', alignItems: 'stretch', gap: 12 }}>
              {[{ abbr: d1, g: gA, c: colorA, win: aWon }, { abbr: d2, g: gB, c: colorB, win: gA != null && gB != null && gB < gA }].map(x => (
                <div key={x.abbr} style={{
                  flex: 1, padding: '18px 12px', borderRadius: 12, textAlign: 'center',
                  background: x.win ? `${x.c}1f` : 'rgba(255,255,255,0.03)',
                  border: `1px solid ${x.win ? x.c : 'rgba(255,255,255,0.08)'}`,
                }}>
                  <div style={{ fontSize: 13, fontWeight: 800, color: x.c }}>{x.abbr}</div>
                  <div className="font-num" style={{ fontSize: 34, fontWeight: 800, marginTop: 4 }}>{x.g != null ? `P${x.g}` : '—'}</div>
                  <div style={{ fontSize: 10, color: '#9CA3AF', marginTop: 2 }}>{x.win ? 'AHEAD ON THE GRID' : 'grid'}</div>
                </div>
              ))}
            </div>
          )
        })()
      ) : (
        <Unavailable label="Qualifying" />
      )}
    </BattleCard>
  )
}

/* ================== 4. Race pace line chart ================== */
function RacePace({ d1, d2, colorA, colorB, state }: {
  d1: string; d2: string; colorA: string; colorB: string; state: LoadState<{ a: LapData[]; b: LapData[] }>
}) {
  const built = useMemo(() => {
    if (state.status !== 'ready' || !state.data) return null
    const prep = (laps: LapData[]) => {
      const rows = laps
        .map(l => ({ lap: l.lap_number ?? 0, t: l.lap_time_s ?? l.lap_time_seconds ?? null }))
        .filter(r => typeof r.t === 'number' && r.t! > 0 && r.lap > 0) as { lap: number; t: number }[]
      if (rows.length < 3) return { rows: [] as { lap: number; t: number }[], median: 0, best: 0 }
      const sorted = [...rows.map(r => r.t)].sort((a, b) => a - b)
      const median = sorted[Math.floor(sorted.length / 2)]
      const clean = rows.filter(r => r.t <= median * 1.07) // drop in/out laps
      return { rows: clean, median, best: sorted[0] }
    }
    const A = prep(state.data.a)
    const B = prep(state.data.b)
    if (!A.rows.length && !B.rows.length) return null
    // merge by lap number
    const byLap: Record<number, { lap: number; a?: number; b?: number }> = {}
    A.rows.forEach(r => { byLap[r.lap] = { ...(byLap[r.lap] || { lap: r.lap }), lap: r.lap, a: r.t } })
    B.rows.forEach(r => { byLap[r.lap] = { ...(byLap[r.lap] || { lap: r.lap }), lap: r.lap, b: r.t } })
    const merged = Object.values(byLap).sort((x, y) => x.lap - y.lap)
    return { merged, A, B }
  }, [state])

  const chip = (label: string, val: number, color: string) => (
    <span className="font-num" style={{ fontSize: 12, padding: '4px 9px', borderRadius: 7, background: `${color}1c`, border: `1px solid ${color}55`, color }}>
      {label} {formatLapTime(val)}
    </span>
  )

  return (
    <BattleCard icon={<Timer size={14} />} title="Race Pace" delay={0.15}>
      {state.status === 'loading' ? (
        <SectionSkeleton note />
      ) : built ? (
        <>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
            {built.A.rows.length > 0 && <>{chip(`${d1} median`, built.A.median, colorA)}{chip(`${d1} best`, built.A.best, colorA)}</>}
            {built.B.rows.length > 0 && <>{chip(`${d2} median`, built.B.median, colorB)}{chip(`${d2} best`, built.B.best, colorB)}</>}
          </div>
          <div style={{ width: '100%', height: 300 }}>
            <ResponsiveContainer>
              <LineChart data={built.merged} margin={{ top: 6, right: 12, bottom: 4, left: -8 }}>
                <CartesianGrid stroke={GRID} />
                <XAxis dataKey="lap" tick={AXIS} stroke={GRID} label={{ value: 'Lap', position: 'insideBottom', offset: -2, fill: 'var(--muted)', fontSize: 10 }} />
                <YAxis tick={AXIS} stroke={GRID} domain={['dataMin - 0.5', 'dataMax + 0.5']} tickFormatter={(v: number) => v.toFixed(1)} width={52} />
                <Tooltip
                  contentStyle={tooltipStyle} itemStyle={tooltipItem} labelStyle={tooltipLabel}
                  formatter={(v, n) => [formatLapTime(Number(v)), String(n)]}
                  labelFormatter={(l) => `Lap ${l}`}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line type="monotone" dataKey="a" name={d1} stroke={colorA} dot={false} strokeWidth={2} connectNulls isAnimationActive />
                <Line type="monotone" dataKey="b" name={d2} stroke={colorB} dot={false} strokeWidth={2} connectNulls isAnimationActive />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 6 }}>In/out laps filtered (laps &gt; 107% of driver median dropped).</div>
        </>
      ) : (
        <Unavailable label="Race pace" />
      )}
    </BattleCard>
  )
}

/* ================== 5. Sector deltas ================== */
function SectorDeltas({ d1, d2, colorA, colorB, state }: {
  d1: string; d2: string; colorA: string; colorB: string; state: LoadState<SectorBest[]>
}) {
  const built = useMemo(() => {
    if (state.status !== 'ready' || !state.data) return null
    const rowFor = (abbr: string) => state.data!.find(r => r.driver === abbr)
    const rA = rowFor(d1)
    const rB = rowFor(d2)
    if (!rA || !rB) return null
    const sectors: { sector: string; delta: number; a: number; b: number }[] = []
    ;([['best_s1', 'S1'], ['best_s2', 'S2'], ['best_s3', 'S3']] as const).forEach(([key, label]) => {
      const a = (rA as any)[key]
      const b = (rB as any)[key]
      if (typeof a === 'number' && typeof b === 'number') {
        // positive delta = driver A faster (B - A), so A better shows to the right
        sectors.push({ sector: label, delta: +(b - a).toFixed(3), a, b })
      }
    })
    return sectors.length ? sectors : null
  }, [state, d1, d2])

  return (
    <BattleCard icon={<Zap size={14} />} title="Sector Deltas" delay={0.2}>
      {state.status === 'loading' ? (
        <SectionSkeleton note />
      ) : built ? (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 6 }}>
            <span style={{ color: colorB, fontWeight: 700 }}>◄ {d2} faster</span>
            <span style={{ color: colorA, fontWeight: 700 }}>{d1} faster ►</span>
          </div>
          <div style={{ width: '100%', height: 180 }}>
            <ResponsiveContainer>
              <BarChart layout="vertical" data={built} margin={{ top: 4, right: 20, bottom: 4, left: 8 }}>
                <CartesianGrid stroke={GRID} horizontal={false} />
                <XAxis type="number" tick={AXIS} stroke={GRID} tickFormatter={(v: number) => `${v > 0 ? '+' : ''}${v.toFixed(2)}s`} />
                <YAxis type="category" dataKey="sector" tick={AXIS} stroke={GRID} width={34} />
                <ReferenceLine x={0} stroke="rgba(255,255,255,0.3)" />
                <Tooltip
                  contentStyle={tooltipStyle} itemStyle={tooltipItem} labelStyle={tooltipLabel}
                  formatter={(v) => { const n = Number(v); return [`${n > 0 ? '+' : ''}${n.toFixed(3)}s (${n > 0 ? d1 : d2} ahead)`, 'Delta'] }}
                />
                <Bar dataKey="delta" radius={[4, 4, 4, 4]} isAnimationActive>
                  {built.map((s, i) => <Cell key={i} fill={s.delta >= 0 ? colorA : colorB} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 6 }}>Best sector times per driver from the race session.</div>
        </>
      ) : (
        <Unavailable label="Sector deltas" />
      )}
    </BattleCard>
  )
}

/* ================== 6. Start performance dumbbell ================== */
function StartPerformance({ d1, d2, colorA, colorB, state }: {
  d1: string; d2: string; colorA: string; colorB: string; state: LoadState<SessionResult[]>
}) {
  const built = useMemo(() => {
    if (state.status !== 'ready' || !state.data) return null
    const rowFor = (abbr: string) => state.data!.find(r => (r.abbreviation || r.driver) === abbr)
    const make = (abbr: string, color: string) => {
      const r = rowFor(abbr)
      if (!r) return null
      const grid = r.grid_position ?? r.grid ?? null
      const finish = r.position ?? null
      if (grid == null || finish == null) return null
      return { abbr, color, grid, finish, gained: grid - finish }
    }
    const a = make(d1, colorA)
    const b = make(d2, colorB)
    if (!a && !b) return null
    return [a, b].filter(Boolean) as { abbr: string; color: string; grid: number; finish: number; gained: number }[]
  }, [state, d1, d2, colorA, colorB])

  // dumbbell scaled to grid range
  const maxPos = built ? Math.max(...built.flatMap(x => [x.grid, x.finish]), 20) : 20
  const pct = (p: number) => ((p - 1) / (maxPos - 1)) * 100

  return (
    <BattleCard icon={<Trophy size={14} />} title="Start Performance" delay={0.25}>
      {state.status === 'loading' ? (
        <SectionSkeleton note />
      ) : built ? (
        <div style={{ display: 'grid', gap: 20 }}>
          {built.map(x => (
            <div key={x.abbr}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 8 }}>
                <span style={{ fontWeight: 800, color: x.color }}>{x.abbr}</span>
                <span className="font-num" style={{ color: x.gained > 0 ? '#00D131' : x.gained < 0 ? '#E8002D' : '#9CA3AF', fontWeight: 700 }}>
                  {x.gained > 0 ? `+${x.gained}` : x.gained} places
                </span>
              </div>
              <svg viewBox="0 0 100 14" preserveAspectRatio="none" style={{ width: '100%', height: 34 }}>
                <line x1={pct(x.grid)} y1="7" x2={pct(x.finish)} y2="7" stroke={x.color} strokeWidth="0.8" opacity="0.5" />
                {/* grid marker (hollow) */}
                <circle cx={pct(x.grid)} cy="7" r="2.4" fill="#0A0A0A" stroke={x.color} strokeWidth="0.8" />
                {/* finish marker (filled) */}
                <circle cx={pct(x.finish)} cy="7" r="2.4" fill={x.color} />
              </svg>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#9CA3AF' }}>
                <span>Grid P{x.grid} <span style={{ opacity: 0.6 }}>(hollow)</span></span>
                <span>Finish P{x.finish} <span style={{ opacity: 0.6 }}>(filled)</span></span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <Unavailable label="Start performance" />
      )}
    </BattleCard>
  )
}
