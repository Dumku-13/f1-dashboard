'use client'

/**
 * Analysis hub — race pace, consistency, head-to-head and pit-lane analysis,
 * all backed by `/api/analysis/*`.
 *
 * One page with tabs rather than four routes: the controls (season, round,
 * drivers) are shared, and switching views shouldn't refetch the season scan.
 */

import { useState, useMemo, useEffect } from 'react'
import dynamic from 'next/dynamic'
import { motion } from 'framer-motion'
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, BarChart, Bar, Cell,
} from 'recharts'
import { Gauge, Activity, Swords, Timer, Info, ChartColumnBig, CircleDot, Trophy, Fingerprint, Wrench } from 'lucide-react'
import { useApi } from '@/lib/api/client'
import { useCalendar, useStandings, useLatestCompletedRound, useRaceLaps, SEASON } from '@/lib/api/hooks'
import { useSeason } from '@/lib/season'
import { formatLapTime } from '@/lib/ist'
import type { BoxRow } from '@/components/charts/BoxPlot'
import { type AnalyticsTab } from '@/components/analysis/AnalyticsHub'
import { CHART_GRID as GRID } from '@/lib/chartTheme'
import RoundFlag from '@/components/shared/RoundFlag'

/**
 * The strategy/simulation half and Track DNA load on demand. Folding
 * /analytics in here doubled the tab count, and shipping all nine views in the
 * first chunk would have made the merged page heavier than the two separate
 * routes it replaced. Charts are already ssr:false throughout — recharts reads
 * layout on mount, so server rendering it buys nothing.
 */
const AnalyticsHub = dynamic(() => import('@/components/analysis/AnalyticsHub'), {
  ssr: false,
  loading: () => <div className="shimmer" style={{ height: 460, borderRadius: 2 }} />,
})
const TrackDNA = dynamic(() => import('@/components/analysis/TrackDNA'), {
  ssr: false,
  loading: () => <div className="shimmer" style={{ height: 460, borderRadius: 2 }} />,
})

const BoxPlot = dynamic(() => import('@/components/charts/BoxPlot'), {
  ssr: false,
  loading: () => <div className="shimmer" style={{ height: 300, borderRadius: 2 }} />,
})

const AXIS = { fill: 'var(--muted)', fontSize: 11 }
const hexish = (c?: string) => (!c ? 'var(--muted)' : c.startsWith('#') ? c : `#${c}`)


function Panel({ title, accent, children, note }: {
  title: string; accent?: string; children: React.ReactNode; note?: string
}) {
  return (
    <div className="glass-card" style={{ padding: 18 }}>
      <h2 className="section-title" style={{ marginBottom: 14, ['--bar' as string]: accent || 'var(--accent)' }}>
        {title}
      </h2>
      {children}
      {note && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 10 }}>{note}</div>}
    </div>
  )
}

/* ------------------------------- Race pace ------------------------------- */

function RacePace({ round }: { round: number | null }) {
  const [year] = useSeason()
  const { data, isLoading } = useApi<any>(round ? `/api/analysis/race-pace/${year}/${round}` : null)

  if (!round || (isLoading && !data)) return <div className="shimmer" style={{ height: 460, borderRadius: 2 }} />
  if (!data?.drivers?.length) {
    return <Panel title="Race Pace"><div style={{ color: 'var(--muted)', fontSize: 12 }}>No lap data for this round yet.</div></Panel>
  }

  const boxRows: BoxRow[] = data.drivers
  const positionSeries: any[] = data.positions || []

  // Reshape position data into one row per lap for recharts.
  const maxLap = Math.max(0, ...positionSeries.flatMap((s: any) => s.points.map((p: any) => p.lap)))
  const posChart = Array.from({ length: maxLap }, (_, i) => {
    const row: Record<string, number | string> = { lap: i + 1 }
    positionSeries.forEach((s: any) => {
      const hit = s.points.find((p: any) => p.lap === i + 1)
      if (hit) row[s.abbr] = hit.pos
    })
    return row
  })
  const topSeries = positionSeries.slice(0, 10)

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(280px, 1fr)', gap: 16, alignItems: 'start' }} className="live-grid">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <Panel
          title="Race Pace Distribution"
          note={`Clean laps only (within ${((data.cutoff - 1) * 100).toFixed(0)}% of the fastest). Session best ${formatLapTime(data.best_lap_s)}.`}
        >
          <BoxPlot rows={boxRows} invert format={v => formatLapTime(v) || ''} />
        </Panel>

        <Panel title="Position Evolution" accent="var(--amber)" note="Top 10 finishers, lap by lap.">
          <div style={{ width: '100%', height: 320 }}>
            <ResponsiveContainer>
              <LineChart data={posChart} margin={{ top: 6, right: 16, bottom: 4, left: -14 }}>
                <CartesianGrid stroke={GRID} />
                <XAxis dataKey="lap" tick={AXIS} stroke={GRID} />
                <YAxis reversed domain={[1, 22]} allowDecimals={false} tick={AXIS} stroke={GRID} tickFormatter={(v: number) => `P${v}`} />
                <Tooltip
                  contentStyle={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 2, fontSize: 11 }}
                  labelFormatter={(l) => `Lap ${l}`}
                  formatter={(v: any, n: any) => [`P${v}`, n]}
                />
                {topSeries.map((s: any) => (
                  <Line key={s.abbr} type="stepAfter" dataKey={s.abbr} stroke={hexish(s.team_color)}
                        strokeWidth={1.8} dot={false} isAnimationActive={false} connectNulls />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      </div>

      <Panel title="Top 20 Fastest Laps" accent="var(--sector-purple)">
        <div style={{ overflowX: 'auto' }}>
          <table className="f1-table">
            <thead><tr><th>#</th><th>DRIVER</th><th style={{ textAlign: 'center' }}>LAP</th><th style={{ textAlign: 'right' }}>TIME</th></tr></thead>
            <tbody>
              {data.fastest.map((f: any, i: number) => (
                <tr key={`${f.abbr}-${f.lap}`} style={{ background: i === 0 ? 'rgba(191,0,255,0.10)' : 'transparent' }}>
                  <td className="font-num" style={{ color: 'var(--muted)', fontSize: 11 }}>{i + 1}</td>
                  <td className="font-display" style={{ fontWeight: 700, fontSize: 12 }}>{f.abbr}</td>
                  <td className="font-num" style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 11 }}>{f.lap}</td>
                  <td className="font-num" style={{ textAlign: 'right', fontSize: 12, color: i === 0 ? 'var(--sector-purple)' : 'var(--foreground)' }}>
                    {formatLapTime(f.secs)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  )
}

/* ------------------------------ Consistency ------------------------------ */

function Consistency() {
  const [year] = useSeason()
  const [excludeDnf, setExcludeDnf] = useState(false)
  const { data, isLoading } = useApi<any>(`/api/analysis/consistency/${year}?exclude_dnf=${excludeDnf}`)

  if (isLoading && !data) return <div className="shimmer" style={{ height: 520, borderRadius: 2 }} />

  const views: { key: string; title: string; accent: string }[] = [
    { key: 'race', title: 'Race Finishing Positions', accent: 'var(--accent)' },
    { key: 'quali', title: 'Qualifying Positions', accent: 'var(--sector-purple)' },
    { key: 'sprint', title: 'Sprint Finishing Positions', accent: 'var(--amber)' },
    { key: 'sprint_quali', title: 'Sprint Qualifying Positions', accent: 'var(--sector-green)' },
  ]

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
        <button
          onClick={() => setExcludeDnf(v => !v)}
          className="font-display"
          style={{
            padding: '7px 14px', borderRadius: 2, cursor: 'pointer',
            border: `1px solid ${excludeDnf ? 'var(--accent)' : 'var(--border)'}`,
            background: excludeDnf ? 'var(--accent)' : 'transparent',
            color: excludeDnf ? '#fff' : 'var(--muted)',
            fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase',
          }}
        >
          {excludeDnf ? 'Excluding DNFs' : 'Including DNFs'}
        </button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(420px, 100%), 1fr))', gap: 16 }}>
        {views.map(v => {
          const rows: BoxRow[] = data?.[v.key] || []
          if (!rows.length) return null
          return (
            <Panel key={v.key} title={v.title} accent={v.accent}>
              <BoxPlot rows={rows} invert format={n => `P${n.toFixed(0)}`} />
            </Panel>
          )
        })}
      </div>
    </>
  )
}

/* ------------------------------ Head to head ----------------------------- */

function HeadToHead() {
  const [year] = useSeason()
  const { data: standings } = useStandings()
  const drivers = standings?.drivers || []
  const [d1, setD1] = useState('')
  const [d2, setD2] = useState('')

  useEffect(() => {
    if (!d1 && drivers.length >= 2) { setD1(drivers[0].abbreviation); setD2(drivers[1].abbreviation) }
  }, [drivers, d1])

  const { data } = useApi<any>(d1 && d2 && d1 !== d2 ? `/api/analysis/h2h/${year}?d1=${d1}&d2=${d2}` : null)
  const { data: mates } = useApi<any>(`/api/analysis/teammates/${year}`)

  const a = data?.drivers?.[0]
  const b = data?.drivers?.[1]

  const METRICS: { key: string; label: string }[] = [
    { key: 'points', label: 'Points' }, { key: 'wins', label: 'Wins' },
    { key: 'podiums', label: 'Podiums' }, { key: 'points_finishes', label: 'Points Finishes' },
    { key: 'poles', label: 'Poles' }, { key: 'q3', label: 'Q3 Appearances' },
  ]

  const select = (val: string, set: (v: string) => void, label: string) => (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <span style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</span>
      <select
        value={val} onChange={e => set(e.target.value)}
        style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--foreground)', padding: '8px 11px', borderRadius: 2, fontSize: 13 }}
      >
        {drivers.map(d => <option key={d.abbreviation} value={d.abbreviation}>{d.abbreviation} — {d.name}</option>)}
      </select>
    </label>
  )

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.6fr) minmax(300px, 1fr)', gap: 16, alignItems: 'start' }} className="live-grid">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div className="glass-card" style={{ padding: 18, display: 'flex', gap: 14, flexWrap: 'wrap' }}>
          {select(d1, setD1, 'Driver 1')}
          {select(d2, setD2, 'Driver 2')}
        </div>

        {a && b && (
          <Panel title={`${a.abbr} vs ${b.abbr}`}>
            {/* Direct head-to-head counts */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginBottom: 18 }}>
              {[
                { label: 'Race H2H', v1: data.race_h2h.d1, v2: data.race_h2h.d2 },
                { label: 'Qualifying H2H', v1: data.quali_h2h.d1, v2: data.quali_h2h.d2 },
              ].map(x => (
                <div key={x.label} style={{ background: 'var(--surface)', border: '1px solid var(--border)', padding: '12px 14px', borderRadius: 2 }}>
                  <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>{x.label}</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span className="stat-num" style={{ fontSize: 26, color: x.v1 >= x.v2 ? 'var(--foreground)' : 'var(--muted)' }}>{x.v1}</span>
                    <span style={{ color: 'var(--muted)', fontSize: 12 }}>—</span>
                    <span className="stat-num" style={{ fontSize: 26, color: x.v2 > x.v1 ? 'var(--foreground)' : 'var(--muted)' }}>{x.v2}</span>
                  </div>
                </div>
              ))}
            </div>

            {METRICS.map(m => {
              const v1 = Number(a[m.key] || 0)
              const v2 = Number(b[m.key] || 0)
              const total = v1 + v2 || 1
              const p1 = (v1 / total) * 100
              return (
                <div key={m.key} style={{ marginBottom: 13 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 5 }}>
                    <span className="font-num" style={{ fontWeight: 700 }}>{v1}</span>
                    <span style={{ color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{m.label}</span>
                    <span className="font-num" style={{ fontWeight: 700 }}>{v2}</span>
                  </div>
                  <div style={{ display: 'flex', height: 8, background: 'var(--surface)', border: '1px solid var(--border)' }}>
                    <div style={{ width: `${p1}%`, background: hexish(a.team_color) }} />
                    <div style={{ width: `${100 - p1}%`, background: hexish(b.team_color) }} />
                  </div>
                </div>
              )
            })}
          </Panel>
        )}
      </div>

      <Panel title="Teammate Battles" accent="var(--amber)" note="Season-long qualifying head-to-head between teammates.">
        {(mates?.quali || []).map((p: any) => {
          const total = p.a_wins + p.b_wins || 1
          return (
            <div key={p.team + p.a} style={{ marginBottom: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 4 }}>
                <span className="font-display" style={{ fontWeight: 700 }}>{p.a}</span>
                <span style={{ color: 'var(--muted)', fontSize: 10 }}>{p.team}</span>
                <span className="font-display" style={{ fontWeight: 700 }}>{p.b}</span>
              </div>
              <div style={{ display: 'flex', height: 20, border: '1px solid var(--border)' }}>
                <div style={{
                  width: `${(p.a_wins / total) * 100}%`, background: hexish(p.team_color),
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 10, fontWeight: 800, color: '#000',
                }}>{p.a_wins || ''}</div>
                <div style={{
                  width: `${(p.b_wins / total) * 100}%`, background: 'var(--surface)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 10, fontWeight: 800, color: 'var(--foreground)',
                }}>{p.b_wins || ''}</div>
              </div>
            </div>
          )
        })}
      </Panel>
    </div>
  )
}

/* ------------------------------ Pit analysis ----------------------------- */

function PitAnalysis() {
  const [year] = useSeason()
  const { data, isLoading } = useApi<any>(`/api/analysis/pitstops/${year}`)
  if (isLoading && !data) return <div className="shimmer" style={{ height: 480, borderRadius: 2 }} />
  if (!data?.drivers?.length) return <Panel title="Pit Analysis"><div style={{ color: 'var(--muted)', fontSize: 12 }}>No pit data yet.</div></Panel>

  return (
    <>
      {/* The metric is NOT the ~2s stationary time — say so plainly. */}
      <div className="glass-card" style={{ padding: '13px 16px', marginBottom: 16, borderLeft: '2px solid var(--amber)', display: 'flex', gap: 11, alignItems: 'flex-start' }}>
        <Info size={15} style={{ color: 'var(--amber)', flexShrink: 0, marginTop: 1 }} />
        <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.6 }}>
          <strong style={{ color: 'var(--foreground)' }}>{data.metric_label}</strong> — {data.note}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.5fr) minmax(300px, 1fr)', gap: 16, alignItems: 'start' }} className="live-grid">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Panel title="Median Pit Lane Loss by Driver" note={`${data.total_stops} stops across the season.`}>
            <div style={{ width: '100%', height: Math.max(280, data.drivers.length * 21) }}>
              <ResponsiveContainer>
                <BarChart layout="vertical" data={data.drivers} margin={{ top: 4, right: 26, bottom: 4, left: 6 }}>
                  <CartesianGrid stroke={GRID} horizontal={false} />
                  <XAxis type="number" domain={['dataMin - 1', 'dataMax + 1']} tick={AXIS} stroke={GRID} tickFormatter={(v: number) => `${v.toFixed(1)}s`} />
                  <YAxis type="category" dataKey="abbr" tick={AXIS} stroke={GRID} width={40} />
                  <Tooltip
                    contentStyle={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 2, fontSize: 11 }}
                    formatter={(v: any) => [`${Number(v).toFixed(3)}s`, 'Median loss']}
                  />
                  <Bar dataKey="median" radius={[0, 2, 2, 0]}>
                    {data.drivers.map((d: any, i: number) => (
                      <Cell key={d.abbr} fill={i === 0 ? 'var(--sector-green)' : 'var(--accent)'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Panel>

          <Panel title="Consistency by Driver" accent="var(--sector-purple)">
            <BoxPlot rows={data.drivers} invert format={v => `${v.toFixed(1)}s`} />
          </Panel>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Panel title="Quickest Single Stops" accent="var(--sector-green)">
            <div style={{ overflowX: 'auto' }}>
              <table className="f1-table">
                <thead><tr><th>#</th><th>DRIVER</th><th>GP</th><th style={{ textAlign: 'right' }}>LOSS</th></tr></thead>
                <tbody>
                  {data.fastest.slice(0, 15).map((s: any, i: number) => (
                    <tr key={`${s.abbr}-${s.round}-${s.lap}`}>
                      <td className="font-num" style={{ color: 'var(--muted)', fontSize: 11 }}>{i + 1}</td>
                      <td className="font-display" style={{ fontWeight: 700, fontSize: 12 }}>{s.abbr}</td>
                      <td style={{ fontSize: 11, color: 'var(--muted)' }}>R{s.round}</td>
                      <td className="font-num" style={{ textAlign: 'right', fontSize: 12, color: i === 0 ? 'var(--sector-green)' : 'var(--foreground)' }}>
                        {s.loss_s.toFixed(2)}s
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>

          <Panel title="By Team" accent="var(--amber)">
            {data.teams.map((t: any) => (
              <div key={t.team} style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: '1px solid var(--hairline)' }}>
                <span style={{ fontSize: 12 }}>{t.team}</span>
                <span className="font-num" style={{ fontSize: 12, fontWeight: 700 }}>{t.median?.toFixed(2)}s</span>
              </div>
            ))}
          </Panel>
        </div>
      </div>
    </>
  )
}
/* --------------------------------- Page ---------------------------------- */

/**
 * Tab registry. `/analytics` used to be a separate route with its own four
 * tabs; both hubs now live here, grouped so the strip stays scannable at eight
 * items. `round: true` marks the views computed from a single race session —
 * those get the round picker, the season-wide ones do not.
 */
type TabId =
  | 'race-pace' | 'pace-ranking' | 'tyre-degradation'
  | 'head-to-head' | 'consistency' | 'pit-analysis'
  | 'race-engineering' | 'championship-sim' | 'track-dna'

type TabDef = {
  id: TabId
  label: string
  icon: typeof Gauge
  round: boolean
  /** when set, the view is rendered by AnalyticsHub under this tab name */
  hub?: AnalyticsTab
}

const TAB_GROUPS: { group: string; tabs: TabDef[] }[] = [
  {
    group: 'Performance',
    tabs: [
      { id: 'race-pace', label: 'Race Pace', icon: Gauge, round: true },
      { id: 'pace-ranking', label: 'Pace Ranking', icon: ChartColumnBig, round: true, hub: 'Pace Ranking' },
      { id: 'tyre-degradation', label: 'Tyre Deg', icon: CircleDot, round: true, hub: 'Tyre Degradation' },
      { id: 'track-dna', label: 'Track DNA', icon: Fingerprint, round: true },
    ],
  },
  {
    group: 'Comparison',
    tabs: [
      { id: 'head-to-head', label: 'Head to Head', icon: Swords, round: false },
      { id: 'consistency', label: 'Consistency', icon: Activity, round: false },
      { id: 'pit-analysis', label: 'Pit Analysis', icon: Timer, round: false },
    ],
  },
  {
    group: 'Simulation',
    tabs: [
      { id: 'race-engineering', label: 'Race Engineering', icon: Wrench, round: true },
      { id: 'championship-sim', label: 'Championship', icon: Trophy, round: false, hub: 'Championship Sim' },
    ],
  },
]

const ALL_TABS: TabDef[] = TAB_GROUPS.flatMap(g => g.tabs)
const isTabId = (v: string | null): v is TabId => !!v && ALL_TABS.some(t => t.id === v)

/** Remounted per season so the selected round belongs to the season on screen. */
function SeasonAnalysis({ year }: { year: number }) {
  const [tab, setTab] = useState<TabId>('race-pace')
  const { data: calendar } = useCalendar(year)
  const { round: latest } = useLatestCompletedRound(year)
  const [round, setRound] = useState<number | null>(null)

  // Deep link via ?tab=. Read from location rather than useSearchParams so the
  // page needs no Suspense boundary to prerender.
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('tab')
    if (isTabId(t)) setTab(t)
  }, [])

  const selectTab = (id: TabId) => {
    setTab(id)
    const url = new URL(window.location.href)
    url.searchParams.set('tab', id)
    window.history.replaceState(null, '', url)
  }

  useEffect(() => { if (round === null && latest) setRound(latest) }, [latest, round])
  const activeRound = round ?? latest

  const completed = useMemo(
    () => calendar.filter(ev => new Date(ev.event_date).getTime() < Date.now()),
    [calendar],
  )

  const { data: standings } = useStandings(SEASON)
  const [engineerDriver, setEngineerDriver] = useState<string | null>(null)
  useEffect(() => {
    if (!engineerDriver && standings?.drivers?.length) setEngineerDriver(standings.drivers[0].abbreviation)
  }, [standings, engineerDriver])
  const engineerLaps = useRaceLaps(activeRound, SEASON) ?? 57

  const active = ALL_TABS.find(t => t.id === tab) ?? ALL_TABS[0]

  return (
    <div style={{ maxWidth: '1560px', margin: '0 auto', padding: '26px clamp(16px, 3vw, 34px) 40px' }}>
      <motion.div
        initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}
        style={{ marginBottom: 18 }}
      >
        <div className="kicker" style={{ marginBottom: 8 }}>{year} Season</div>
        <h1 className="display-title" style={{ fontSize: 'clamp(26px, 4.2vw, 44px)', margin: 0 }}>Analysis</h1>
        <p style={{ color: 'var(--muted)', fontSize: 13, margin: '7px 0 0', maxWidth: 660, lineHeight: 1.55 }}>
          Pace, tyre degradation, driver duels, pit-lane performance and strategy maths — computed
          from every completed session of the season.
        </p>
      </motion.div>

      {/* Tabs — grouped so eight views stay readable */}
      <div
        role="tablist"
        aria-label="Analysis views"
        style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'stretch', marginBottom: 16 }}
      >
        {TAB_GROUPS.map(({ group, tabs }) => (
          <div key={group} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span
              className="font-display"
              style={{ fontSize: 9, letterSpacing: '0.2em', textTransform: 'uppercase', color: 'var(--muted)', paddingLeft: 4 }}
            >
              {group}
            </span>
            <div style={{ display: 'inline-flex', gap: 3, padding: 3, background: 'var(--surface)', border: '1px solid var(--border)', flexWrap: 'wrap', height: '100%' }}>
              {tabs.map(t => {
                const Icon = t.icon
                const on = tab === t.id
                return (
                  <button
                    key={t.id}
                    role="tab"
                    aria-selected={on}
                    onClick={() => selectTab(t.id)}
                    className="font-display"
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 7,
                      padding: '8px 14px', border: 'none', cursor: 'pointer', borderRadius: 2,
                      fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase',
                      background: on ? 'var(--accent)' : 'transparent',
                      color: on ? '#fff' : 'var(--muted)',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    <Icon size={13} /> {t.label}
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Round picker — only for views computed from a single race session */}
      {active.round && (
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 16, alignItems: 'center' }}>
          <span
            className="font-display"
            style={{ fontSize: 9, letterSpacing: '0.2em', textTransform: 'uppercase', color: 'var(--muted)', marginRight: 4 }}
          >
            Round
          </span>
          {completed.map(ev => (
            <button
              key={ev.round}
              onClick={() => setRound(ev.round)}
              title={ev.name}
              aria-label={`Round ${ev.round} — ${ev.name}`}
              aria-pressed={ev.round === activeRound}
              className="font-num"
              style={{
                padding: '6px 10px', borderRadius: 2, cursor: 'pointer', minWidth: 56, minHeight: 44,
                border: `1px solid ${ev.round === activeRound ? 'var(--accent)' : 'var(--border)'}`,
                background: ev.round === activeRound ? 'var(--accent)' : 'transparent',
                color: ev.round === activeRound ? '#fff' : 'var(--foreground)',
                fontSize: 11, fontWeight: 700,
              }}
            >
              <RoundFlag event={ev} active={ev.round === activeRound} />
            </button>
          ))}
        </div>
      )}

      {tab === 'race-pace' && <RacePace round={activeRound} />}
      {tab === 'consistency' && <Consistency />}
      {tab === 'head-to-head' && <HeadToHead />}
      {tab === 'pit-analysis' && <PitAnalysis />}
      {/* Track DNA is still pinned to the current season inside the component,
          so say which year it is showing rather than let the page heading imply
          it followed the season picker. */}
      {tab === 'track-dna' && (
        <>
          {year !== SEASON && (
            <div className="glass-card" style={{ padding: '10px 14px', marginBottom: 10, fontSize: 12, color: 'var(--muted)' }}>
              Track DNA is only available for the {SEASON} season — the figures below are {SEASON}, not {year}.
            </div>
          )}
          <TrackDNA round={activeRound} />
        </>
      )}

      {/* The four strategy/simulation views, from the old /analytics route.
          Deliberately NOT keyed by tab: the hub owns the loaded pace/degradation
          data and the sim inputs, and keying would throw them away every time
          you moved between its own four tabs — which the old page never did. */}
      {active.hub && <AnalyticsHub tab={active.hub} round={activeRound ?? 1} />}
    </div>
  )
}

export default function AnalysisPage() {
  const [season] = useSeason()
  return <SeasonAnalysis key={season} year={season} />
}
