'use client'

import { useState, useCallback, useMemo } from 'react'
import { motion } from 'framer-motion'
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine,
} from 'recharts'
import {
  Activity, Gauge, Timer, SlidersHorizontal, Users, Zap, TriangleAlert, RefreshCw, Waves, Info,
} from 'lucide-react'
import { TEAM_COLORS } from '@/lib/constants'
import { formatLapTime } from '@/lib/ist'
import { ApiError, useApi } from '@/lib/api/client'
import { useDrivers, useCalendar } from '@/lib/api/hooks'
import { roundOptionLabel } from '@/lib/weekend'
import type { TelemetrySample } from '@/lib/types'
import { deltaTrace, deltaSummary, fmtDelta } from '@/lib/telemetryDelta'
import { CHART_GRID as GRID } from '@/lib/chartTheme'

const TELEMETRY_CHANNELS = [
  { key: 'speed', label: 'Speed (km/h)', short: 'Speed', max: 380, color: 'var(--sector-green)', unit: 'km/h' },
  { key: 'throttle', label: 'Throttle %', short: 'Throttle', max: 100, color: 'var(--amber)', unit: '%' },
  { key: 'brake', label: 'Brake', short: 'Brake', max: 1, color: 'var(--accent)', unit: '', binary: true },
  { key: 'gear', label: 'Gear', short: 'Gear', max: 8, color: 'var(--muted)', unit: '' },
  { key: 'rpm', label: 'RPM', short: 'RPM', max: 18000, color: 'var(--sector-purple)', unit: 'rpm' },
  { key: 'aoa', label: 'AoA (Active Aero)', short: 'AoA', max: 1, color: 'var(--sector-yellow)', unit: '', binary: true },
] as const

type Channel = typeof TELEMETRY_CHANNELS[number]['key']
type ChannelDef = typeof TELEMETRY_CHANNELS[number]

/* ---------- chart chrome: tokens only ---------- */
const AXIS_TICK = { fill: 'var(--muted)', fontSize: 10 }
const CHART_RES = 400

/* ---------- tiny helpers ---------- */
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
/** brake/aoa arrive as bool or a numeric flag — same >0 rule the old sparkline used */
const flag = (v: unknown): number => (typeof v === 'boolean' ? (v ? 1 : 0) : typeof v === 'number' && v > 0 ? 1 : 0)
const tint = (color: string, pct: number) => `color-mix(in srgb, ${color} ${pct}%, transparent)`
const isBinary = (ch: ChannelDef) => 'binary' in ch && ch.binary === true

function fmtChannel(ch: ChannelDef, v: number | null): string {
  if (v == null) return '—'
  if (isBinary(ch)) return v > 0 ? 'ON' : 'OFF'
  if (ch.key === 'rpm') return Math.round(v).toLocaleString('en-US')
  if (ch.key === 'gear') return String(Math.round(v))
  if (ch.key === 'throttle') return `${Math.round(v)}%`
  return String(Math.round(v))
}

/* ---------- derived shapes ---------- */
type Point = { x: number } & Record<Channel, number | null>
interface Row { x: number; [key: string]: number | null }

interface DriverStats {
  samples: number
  lap: number | null
  distance: number | null
  topSpeed: number | null
  avgSpeed: number | null
  maxRpm: number | null
  maxGear: number | null
  wotPct: number | null
  brakePct: number | null
  aoaPct: number | null
  channel: Record<Channel, { max: number | null; avg: number | null; onPct: number | null }>
}

function computeStats(data: TelemetrySample[]): DriverStats | null {
  if (!data.length) return null
  const acc: Record<string, { max: number | null; sum: number; n: number; on: number }> = {}
  TELEMETRY_CHANNELS.forEach(ch => { acc[ch.key] = { max: null, sum: 0, n: 0, on: 0 } })

  for (const s of data) {
    for (const ch of TELEMETRY_CHANNELS) {
      const raw = isBinary(ch) ? flag(s[ch.key]) : num(s[ch.key])
      if (raw == null) continue
      const a = acc[ch.key]
      a.max = a.max == null ? raw : Math.max(a.max, raw)
      a.sum += raw
      a.n += 1
      if (raw > 0) a.on += 1
    }
  }

  const channel = {} as DriverStats['channel']
  TELEMETRY_CHANNELS.forEach(ch => {
    const a = acc[ch.key]
    channel[ch.key] = {
      max: a.max,
      avg: a.n ? a.sum / a.n : null,
      onPct: a.n ? (a.on / a.n) * 100 : null,
    }
  })

  const t0 = num(data[0].time_s)
  const tN = num(data[data.length - 1].time_s)
  const lap = t0 != null && tN != null && tN > t0 ? tN - t0 : null
  const dEnd = num(data[data.length - 1].distance)
  const dStart = num(data[0].distance)
  const distance = dEnd != null && dStart != null && dEnd > dStart ? dEnd - dStart : dEnd

  // throttle counts as "full" from 97% up — matches how teams read a WOT trace
  let wot = 0, wotN = 0
  for (const s of data) {
    const t = num(s.throttle)
    if (t == null) continue
    wotN += 1
    if (t >= 97) wot += 1
  }

  return {
    samples: data.length,
    lap,
    distance,
    topSpeed: channel.speed.max,
    avgSpeed: channel.speed.avg,
    maxRpm: channel.rpm.max,
    maxGear: channel.gear.max,
    wotPct: wotN ? (wot / wotN) * 100 : null,
    brakePct: channel.brake.onPct,
    aoaPct: channel.aoa.onPct,
    channel,
  }
}

function toPoints(data: TelemetrySample[], useDistance: boolean): Point[] {
  const span = Math.max(1, data.length - 1)
  return data.map((d, i) => ({
    x: useDistance ? (num(d.distance) ?? 0) : (i / span) * 100,
    speed: num(d.speed),
    throttle: num(d.throttle),
    brake: flag(d.brake),
    gear: num(d.gear),
    rpm: num(d.rpm),
    aoa: flag(d.aoa),
  }))
}

/** Nearest-neighbour resampler — never invents values for gear/brake/AoA. */
function makeSampler(pts: Point[]) {
  let i = 0
  const lo = pts.length ? pts[0].x : 0
  const hi = pts.length ? pts[pts.length - 1].x : 0
  return (x: number): Point | null => {
    if (!pts.length || x < lo - 1e-6 || x > hi + 1e-6) return null
    while (i < pts.length - 1 && pts[i + 1].x <= x) i++
    const cur = pts[i]
    const nxt = pts[Math.min(i + 1, pts.length - 1)]
    return Math.abs(cur.x - x) <= Math.abs(nxt.x - x) ? cur : nxt
  }
}

/* ================= presentational bits ================= */

function HeaderStat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div style={{
      minWidth: 84, padding: '9px 13px', background: 'var(--surface)',
      border: '1px solid var(--border)', borderRadius: 2, borderTop: `2px solid ${accent || 'var(--border)'}`,
    }}>
      <div style={{ fontSize: 9, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--muted)' }}>{label}</div>
      <div className="stat-num" style={{ fontSize: 16, marginTop: 3, color: accent || 'var(--foreground)' }}>{value}</div>
    </div>
  )
}

function KpiTile({ label, value, sub, accent, index }: {
  label: string; value: string; sub?: string; accent?: string; index: number
}) {
  return (
    <motion.div
      className="glass-card"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: Math.min(index * 0.04, 0.3) }}
      style={{ padding: '13px 15px 14px', overflow: 'hidden' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 8 }}>
        <span style={{ width: 7, height: 7, background: accent || 'var(--accent)', flexShrink: 0 }} />
        <span style={{ fontSize: 9.5, letterSpacing: '0.15em', textTransform: 'uppercase', color: 'var(--muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {label}
        </span>
      </div>
      <div className="stat-num" style={{ fontSize: 'clamp(19px, 2vw, 25px)', lineHeight: 1, color: accent || 'var(--foreground)' }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 6 }}>{sub}</div>}
    </motion.div>
  )
}

function RailPanel({ title, icon, accent, children }: {
  title: string; icon: React.ReactNode; accent?: string; children: React.ReactNode
}) {
  return (
    <div className="glass-card" style={{ padding: 16 }}>
      <h2 className="section-title" style={{ marginBottom: 13, ...(accent ? { ['--bar' as string]: accent } : {}) }}>
        <span style={{ display: 'inline-flex', color: accent || 'var(--accent)' }}>{icon}</span>
        {title}
      </h2>
      {children}
    </div>
  )
}

/* One line of the crosshair readout. Returns three bare siblings so the parent
   `display: grid` keeps its channel / driver-1 / driver-2 columns aligned. */
function ReadoutRow({ name, a, b, color }: { name: string; a: string; b: string; color: string }) {
  return (
    <>
      <span style={{ fontSize: 10.5, color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ width: 6, height: 6, background: color, flexShrink: 0 }} />
        {name}
      </span>
      <span style={{ fontSize: 11.5, color: 'var(--foreground)', textAlign: 'right' }}>{a}</span>
      <span style={{ fontSize: 11.5, color: 'var(--foreground)', textAlign: 'right' }}>{b}</span>
    </>
  )
}

function MiniBar({ pct, color }: { pct: number; color: string }) {
  return (
    <div style={{ height: 5, background: 'var(--surface)', border: '1px solid var(--hairline)', overflow: 'hidden' }}>
      <motion.div
        initial={{ width: 0 }} animate={{ width: `${Math.max(0, Math.min(100, pct))}%` }}
        transition={{ duration: 0.5, ease: 'easeOut' }}
        style={{ height: '100%', background: color }}
      />
    </div>
  )
}

/* ================= page ================= */

export default function TelemetryPage() {
  const { data: drivers } = useDrivers(2026)
  const [driver1, setDriver1] = useState('')
  const [driver2, setDriver2] = useState('')
  const [year] = useState(2026)
  const [round, setRound] = useState(1)
  // Typing a round number meant knowing which Grand Prix number eight was.
  const { data: calendar } = useCalendar(year)
  const [sessionType] = useState('Qualifying')
  const [channels, setChannels] = useState<Set<Channel>>(new Set(['speed', 'throttle', 'brake', 'aoa']))

  // "Load Telemetry" captures the current driver/round selection at click time —
  // changing the selectors afterwards doesn't silently refetch until Load is
  // pressed again (same pattern as the analytics pace/degradation loaders).
  const [armed, setArmed] = useState<{ driver1: string; driver2: string; round: number } | null>(null)
  const enc = encodeURIComponent(sessionType)
  const req1 = useApi<{ car_data?: TelemetrySample[]; lap_time_s?: number | null }>(
    armed?.driver1 ? `/api/telemetry/${year}/${armed.round}/${enc}/${armed.driver1}/fastest-lap` : null,
  )
  const req2 = useApi<{ car_data?: TelemetrySample[]; lap_time_s?: number | null }>(
    armed?.driver2 ? `/api/telemetry/${year}/${armed.round}/${enc}/${armed.driver2}/fastest-lap` : null,
  )
  const data1 = req1.data?.car_data ?? []
  const data2 = req2.data?.car_data ?? []
  const loading = (!!armed?.driver1 && req1.isLoading) || (!!armed?.driver2 && req2.isLoading)
  const loadError = !armed
    ? ''
    : req1.error instanceof ApiError
      ? `No telemetry for ${armed.driver1} in round ${armed.round} ${sessionType} (${req1.error.status})`
      : req2.error instanceof ApiError
        ? `No telemetry for ${armed.driver2} in round ${armed.round} ${sessionType} (${req2.error.status})`
        : !loading && data1.length === 0 && data2.length === 0
          ? 'No car data returned for that lap — try another round or session.'
          : ''

  const loadTelemetry = useCallback(() => {
    if (!driver1 && !driver2) return
    setArmed({ driver1, driver2, round })
    // Force a fresh fetch even if this exact driver/round combo is already cached.
    req1.mutate()
    req2.mutate()
  }, [driver1, driver2, round]) // eslint-disable-line react-hooks/exhaustive-deps

  const toggleChannel = (ch: Channel) => {
    setChannels(prev => {
      const next = new Set(prev)
      if (next.has(ch)) next.delete(ch)
      else next.add(ch)
      return next
    })
  }

  const d1Color = driver1 ? TEAM_COLORS[drivers.find(d => d.abbreviation === driver1)?.team || ''] || '#00D131' : '#00D131'
  const d2Color = driver2 ? TEAM_COLORS[drivers.find(d => d.abbreviation === driver2)?.team || ''] || '#E10600' : '#E10600'

  const d1Meta = drivers.find(d => d.abbreviation === driver1)
  const d2Meta = drivers.find(d => d.abbreviation === driver2)

  /* ---------- derived: per-driver headline numbers ---------- */
  const statsA = useMemo(() => computeStats(data1), [data1])
  const statsB = useMemo(() => computeStats(data2), [data2])

  /**
   * Cumulative time delta — the one thing the speed traces can't tell you.
   *
   * A driver can be slower through a corner and still ahead on the lap, so
   * comparing speed point-by-point never answers "who is winning this lap".
   * Computed from `time_s` and `distance`, both already on the page; the
   * backend's compare endpoint has a `delta_time()` helper but never returns it.
   */
  const delta = useMemo(() => {
    const trace = deltaTrace(data1, data2)
    return { trace, summary: deltaSummary(trace) }
  }, [data1, data2])

  /**
   * The real lap gap, from the two lap times — deliberately not the end of the
   * delta trace. Telemetry stops at the last distance both cars have samples
   * for, which is not the timing line, so the trace's final value can even name
   * the wrong winner.
   */
  const lapGap = useMemo(() => {
    const a = req1.data?.lap_time_s
    const b = req2.data?.lap_time_s
    return typeof a === 'number' && typeof b === 'number' ? a - b : null
  }, [req1.data?.lap_time_s, req2.data?.lap_time_s])

  /* ---------- derived: overlaid, resampled chart rows ---------- */
  const chart = useMemo(() => {
    if (!data1.length && !data2.length) return null

    const hasDist = (d: TelemetrySample[]) => {
      if (d.length < 2) return false
      const end = num(d[d.length - 1].distance)
      return end != null && end > 0
    }
    const useDistance = (!data1.length || hasDist(data1)) && (!data2.length || hasDist(data2))

    const ptsA = toPoints(data1, useDistance)
    const ptsB = toPoints(data2, useDistance)
    const ends = [ptsA, ptsB].filter(p => p.length)
    if (!ends.length) return null

    const minX = Math.min(...ends.map(p => p[0].x))
    const maxX = Math.max(...ends.map(p => p[p.length - 1].x))
    const step = maxX > minX ? (maxX - minX) / (CHART_RES - 1) : 0

    const sa = makeSampler(ptsA)
    const sb = makeSampler(ptsB)
    const rows: Row[] = []
    for (let i = 0; i < CHART_RES; i++) {
      const x = step ? minX + step * i : minX
      const pa = sa(x)
      const pb = sb(x)
      const row: Row = { x }
      for (const ch of TELEMETRY_CHANNELS) {
        row[`a_${ch.key}`] = pa ? pa[ch.key] : null
        row[`b_${ch.key}`] = pb ? pb[ch.key] : null
      }
      row.dspeed = pa && pb && pa.speed != null && pb.speed != null ? pa.speed - pb.speed : null
      rows.push(row)
      if (!step) break
    }

    // per-channel y domain, snapped up so the trace never touches the frame
    const domains = {} as Record<Channel, [number, number]>
    for (const ch of TELEMETRY_CHANNELS) {
      if (isBinary(ch)) { domains[ch.key] = [0, 1]; continue }
      let top = 0
      for (const r of rows) {
        const a = r[`a_${ch.key}`]
        const b = r[`b_${ch.key}`]
        if (a != null) top = Math.max(top, a)
        if (b != null) top = Math.max(top, b)
      }
      if (top <= 0) top = ch.max
      const grain = ch.key === 'rpm' ? 1000 : ch.key === 'gear' ? 1 : ch.key === 'throttle' ? 20 : 20
      domains[ch.key] = [0, Math.min(ch.max * 1.2, Math.ceil((top * 1.04) / grain) * grain)]
    }

    return { rows, minX, maxX, step, useDistance, domains }
  }, [data1, data2])

  /* ---------- derived: speed dominance ---------- */
  const dominance = useMemo(() => {
    if (!chart) return null
    const valid = chart.rows.filter(r => typeof r.dspeed === 'number') as (Row & { dspeed: number })[]
    if (valid.length < 12) return null
    const aAhead = valid.filter(r => r.dspeed > 0).length
    const aPct = (aAhead / valid.length) * 100
    const peak = valid.reduce((m, r) => (Math.abs(r.dspeed) > Math.abs(m.dspeed) ? r : m), valid[0])
    const segments = [0, 1, 2].map(k => {
      const slice = valid.slice(Math.floor((valid.length * k) / 3), Math.floor((valid.length * (k + 1)) / 3))
      const share = slice.length ? (slice.filter(r => r.dspeed > 0).length / slice.length) * 100 : 50
      const mean = slice.length ? slice.reduce((s, r) => s + r.dspeed, 0) / slice.length : 0
      return { label: `Sector ${k + 1}`, share, mean }
    })
    const mean = valid.reduce((s, r) => s + r.dspeed, 0) / valid.length
    return { aPct, bPct: 100 - aPct, peak: peak.dspeed, peakAt: peak.x, mean, segments }
  }, [chart])

  const activeChannels = TELEMETRY_CHANNELS.filter(ch => channels.has(ch.key))
  const hasData = data1.length > 0 || data2.length > 0
  const bothLoaded = data1.length > 0 && data2.length > 0
  const lapDelta = statsA?.lap != null && statsB?.lap != null ? statsA.lap - statsB.lap : null
  const speedDelta = statsA?.topSpeed != null && statsB?.topSpeed != null ? statsA.topSpeed - statsB.topSpeed : null

  const xLabel = chart?.useDistance ? 'Lap distance' : 'Lap progress'
  const fmtX = useCallback(
    (v: number) => (chart?.useDistance ? `${Math.round(v)}m` : `${Math.round(v)}%`),
    [chart?.useDistance],
  )

  /* ---------- KPI tiles ---------- */
  const tiles: { label: string; value: string; sub?: string; accent?: string }[] = []
  if (statsA) tiles.push({ label: `${driver1 || 'Driver 1'} lap`, value: formatLapTime(statsA.lap), sub: 'fastest lap window', accent: d1Color })
  if (statsB) tiles.push({ label: `${driver2 || 'Driver 2'} lap`, value: formatLapTime(statsB.lap), sub: 'fastest lap window', accent: d2Color })
  if (lapDelta != null) {
    tiles.push({
      label: 'Lap delta',
      value: `${lapDelta > 0 ? '+' : ''}${lapDelta.toFixed(3)}s`,
      sub: lapDelta === 0 ? 'dead heat' : `${lapDelta < 0 ? driver1 : driver2} ahead`,
      accent: lapDelta === 0 ? 'var(--muted)' : lapDelta < 0 ? d1Color : d2Color,
    })
  }
  if (statsA?.topSpeed != null) tiles.push({ label: `${driver1} top speed`, value: `${Math.round(statsA.topSpeed)}`, sub: `km/h · avg ${statsA.avgSpeed != null ? Math.round(statsA.avgSpeed) : '—'}`, accent: d1Color })
  if (statsB?.topSpeed != null) tiles.push({ label: `${driver2} top speed`, value: `${Math.round(statsB.topSpeed)}`, sub: `km/h · avg ${statsB.avgSpeed != null ? Math.round(statsB.avgSpeed) : '—'}`, accent: d2Color })
  if (speedDelta != null) {
    tiles.push({
      label: 'Top speed delta',
      value: `${speedDelta > 0 ? '+' : ''}${Math.round(speedDelta)}`,
      sub: `km/h · ${speedDelta === 0 ? 'level' : `${speedDelta > 0 ? driver1 : driver2} faster`}`,
      accent: speedDelta === 0 ? 'var(--muted)' : speedDelta > 0 ? d1Color : d2Color,
    })
  } else if (statsA || statsB) {
    const s = statsA || statsB
    tiles.push({ label: 'Full throttle', value: s?.wotPct != null ? `${Math.round(s.wotPct)}%` : '—', sub: 'of the lap at ≥97%', accent: 'var(--amber)' })
  }
  if (hasData && tiles.length < 6) {
    const s = statsA || statsB
    if (s?.distance != null) tiles.push({ label: 'Lap length', value: `${(s.distance / 1000).toFixed(3)}`, sub: 'km from car data', accent: 'var(--muted)' })
  }

  /* ---------- shared crosshair readout ---------- */
  const readout = (label: string | number | undefined) => {
    if (!chart) return null
    const raw = Number(label)
    if (!Number.isFinite(raw)) return null
    const idx = chart.step ? Math.max(0, Math.min(chart.rows.length - 1, Math.round((raw - chart.minX) / chart.step))) : 0
    const row = chart.rows[idx]
    if (!row) return null
    return (
      <div className="font-num" style={{
        background: 'var(--background)', border: '1px solid var(--border)', borderTop: '2px solid var(--accent)',
        borderRadius: 2, padding: '10px 12px', minWidth: 210,
      }}>
        <div style={{ fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 8 }}>
          {xLabel} · {fmtX(row.x)}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: '5px 12px', alignItems: 'center' }}>
          <span />
          <span style={{ fontSize: 10, fontWeight: 700, color: d1Color, textAlign: 'right' }}>{driver1 || '—'}</span>
          <span style={{ fontSize: 10, fontWeight: 700, color: d2Color, textAlign: 'right' }}>{driver2 || '—'}</span>
          {activeChannels.map(ch => (
            <ReadoutRow key={ch.key}
              name={ch.short}
              a={data1.length ? fmtChannel(ch, row[`a_${ch.key}`]) : '—'}
              b={data2.length ? fmtChannel(ch, row[`b_${ch.key}`]) : '—'}
              color={ch.color}
            />
          ))}
        </div>
        {row.dspeed != null && (
          <div style={{ marginTop: 9, paddingTop: 8, borderTop: '1px solid var(--hairline)', fontSize: 11, color: 'var(--foreground)' }}>
            Δ speed{' '}
            <span style={{ color: row.dspeed > 0 ? d1Color : row.dspeed < 0 ? d2Color : 'var(--muted)', fontWeight: 700 }}>
              {row.dspeed > 0 ? '+' : ''}{Math.round(row.dspeed)} km/h
            </span>
          </div>
        )}
      </div>
    )
  }

  return (
    <div style={{ maxWidth: '1560px', margin: '0 auto', padding: '26px clamp(16px, 3vw, 34px) 40px', position: 'relative', zIndex: 1 }}>
      {/* ================= header ================= */}
      <motion.div
        initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 20, flexWrap: 'wrap', marginBottom: 22 }}
      >
        <div>
          <div className="kicker" style={{ marginBottom: 8 }}>Telemetry</div>
          <h1 className="display-title" style={{ fontSize: 'clamp(26px, 4.2vw, 44px)', margin: 0 }}>Overlay Comparison</h1>
          <p style={{ color: 'var(--muted)', fontSize: 13, margin: '7px 0 0', maxWidth: 620 }}>
            Two fastest laps, one set of axes. Channel traces overlaid on a shared distance axis with a synced crosshair readout.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <HeaderStat label="Season" value={String(year)} />
          <HeaderStat label="Round" value={String(round).padStart(2, '0')} />
          <HeaderStat label="Session" value="Quali" />
          <HeaderStat
            label="Samples"
            value={hasData ? String(Math.max(data1.length, data2.length)) : '—'}
            accent={hasData ? 'var(--amber)' : undefined}
          />
        </div>
      </motion.div>

      {/* ================= control bar ================= */}
      <motion.div
        initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.04 }}
        className="featured-card"
        style={{ padding: '18px 18px 16px', marginBottom: 18 }}
      >
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(180px, 100%), 1fr))', gap: 12, alignItems: 'end' }}>
          <div>
            <div style={{ fontSize: 9.5, color: 'var(--muted)', marginBottom: 7, textTransform: 'uppercase', letterSpacing: '0.16em' }}>Round</div>
            <select
              aria-label="Round"
              value={round}
              onChange={e => setRound(parseInt(e.target.value) || 1)}
              className="font-num"
              style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--foreground)', padding: '8px 11px', borderRadius: 2, width: '100%', fontSize: 13 }}
            >
              {/* Falls back to bare numbers if the calendar hasn't loaded, so
                  the control is never empty and never loses the current value. */}
              {calendar.length === 0
                ? <option value={round}>{`Round ${round}`}</option>
                : calendar.map(ev => (
                    <option key={ev.round} value={ev.round} style={{ background: '#141416' }}>
                      {roundOptionLabel(ev)}
                    </option>
                  ))}
            </select>
          </div>
          <div>
            <div style={{ fontSize: 9.5, color: driver1 ? d1Color : 'var(--muted)', marginBottom: 7, textTransform: 'uppercase', letterSpacing: '0.16em', fontWeight: 700 }}>
              Driver 1{driver1 ? ` · ${driver1}` : ''}
            </div>
            <select
              aria-label="Driver 1"
              value={driver1} onChange={e => setDriver1(e.target.value)}
              style={{ background: 'var(--surface)', border: `1px solid ${driver1 ? d1Color : 'var(--border)'}`, color: 'var(--foreground)', padding: '8px 11px', borderRadius: 2, width: '100%', fontSize: 13 }}
            >
              <option value="">Select driver</option>
              {drivers.map(d => <option key={d.abbreviation} value={d.abbreviation}>{d.abbreviation} — {d.full_name}</option>)}
            </select>
          </div>
          <div>
            <div style={{ fontSize: 9.5, color: driver2 ? d2Color : 'var(--muted)', marginBottom: 7, textTransform: 'uppercase', letterSpacing: '0.16em', fontWeight: 700 }}>
              Driver 2{driver2 ? ` · ${driver2}` : ''}
            </div>
            <select
              aria-label="Driver 2"
              value={driver2} onChange={e => setDriver2(e.target.value)}
              style={{ background: 'var(--surface)', border: `1px solid ${driver2 ? d2Color : 'var(--border)'}`, color: 'var(--foreground)', padding: '8px 11px', borderRadius: 2, width: '100%', fontSize: 13 }}
            >
              <option value="">Select driver</option>
              {drivers.map(d => <option key={d.abbreviation} value={d.abbreviation}>{d.abbreviation} — {d.full_name}</option>)}
            </select>
          </div>
          <button
            onClick={loadTelemetry}
            disabled={loading || (!driver1 && !driver2)}
            style={{
              padding: '10px 26px', background: 'var(--accent)', border: 'none', color: '#fff', borderRadius: 2,
              cursor: loading || (!driver1 && !driver2) ? 'default' : 'pointer',
              fontFamily: 'var(--font-display)', fontSize: 12, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase',
              opacity: loading || (!driver1 && !driver2) ? 0.45 : 1,
              display: 'inline-flex', alignItems: 'center', gap: 8, height: 36,
            }}
          >
            {loading ? <RefreshCw size={13} className="live-dot" /> : <Activity size={13} />}
            {loading ? 'Loading' : 'Load'}
          </button>
        </div>
      </motion.div>

      {/* ================= KPI tiles ================= */}
      {hasData && tiles.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 18 }}>
          {tiles.map((t, i) => <KpiTile key={`${t.label}-${i}`} index={i} {...t} />)}
        </div>
      )}

      {/* ================= main grid ================= */}
      <div
        className="live-grid"
        style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2.4fr) minmax(280px, 1fr)', gap: 16, alignItems: 'start' }}
      >
        {/* ---------- main column ---------- */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
          {loading ? (
            <>
              {[0, 1, 2].map(i => (
                <div key={i} className="glass-card" style={{ padding: 16 }}>
                  <div className="shimmer" style={{ height: 12, width: 140, marginBottom: 14 }} />
                  <div className="shimmer" style={{ height: 210 }} />
                </div>
              ))}
            </>
          ) : loadError && !hasData ? (
            <div className="glass-card" style={{ padding: '26px 22px', borderLeft: '2px solid var(--accent)' }}>
              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <TriangleAlert size={18} style={{ color: 'var(--accent)', flexShrink: 0, marginTop: 2 }} />
                <div>
                  <div className="font-display" style={{ fontSize: 15, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    Telemetry unavailable
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--muted)', margin: '7px 0 0', maxWidth: 520, lineHeight: 1.5 }}>{loadError}</div>
                  <button
                    onClick={loadTelemetry}
                    style={{
                      marginTop: 16, padding: '8px 18px', background: 'transparent', border: '1px solid var(--accent)',
                      color: 'var(--accent)', borderRadius: 2, cursor: 'pointer',
                      fontFamily: 'var(--font-display)', fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase',
                      display: 'inline-flex', alignItems: 'center', gap: 7,
                    }}
                  >
                    <RefreshCw size={12} /> Retry
                  </button>
                </div>
              </div>
            </div>
          ) : !hasData ? (
            <div className="glass-card" style={{ padding: '56px 28px', textAlign: 'center' }}>
              <Waves size={30} style={{ color: 'var(--accent)', opacity: 0.8 }} />
              <div className="font-display" style={{ fontSize: 17, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', marginTop: 16 }}>
                No lap loaded
              </div>
              <div style={{ fontSize: 13, color: 'var(--muted)', margin: '9px auto 0', maxWidth: 430, lineHeight: 1.55 }}>
                Pick a round and two drivers above, then hit Load. Traces come from each driver&apos;s fastest
                qualifying lap via FastF1 — the session has to be complete.
              </div>
              <div className="font-num" style={{ fontSize: 11, color: 'var(--muted)', marginTop: 18, letterSpacing: '0.1em' }}>
                {activeChannels.length} CHANNEL{activeChannels.length === 1 ? '' : 'S'} ARMED
              </div>
            </div>
          ) : activeChannels.length === 0 ? (
            <div className="glass-card" style={{ padding: '52px 28px', textAlign: 'center' }}>
              <SlidersHorizontal size={26} style={{ color: 'var(--amber)' }} />
              <div className="font-display" style={{ fontSize: 15, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', marginTop: 14 }}>
                All channels muted
              </div>
              <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 8 }}>
                Re-arm at least one channel in the Channels panel to draw the overlay.
              </div>
            </div>
          ) : (
            <>
              {/* speed delta trace */}
              {bothLoaded && chart && dominance && (
                <motion.div
                  className="glass-card"
                  initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}
                  style={{ padding: '15px 16px 10px', ...{ ['--bar' as string]: 'var(--amber)' } }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 14, flexWrap: 'wrap', marginBottom: 12 }}>
                    <h2 className="section-title" style={{ ['--bar' as string]: 'var(--amber)' }}>
                      <span style={{ display: 'inline-flex', color: 'var(--amber)' }}><Zap size={13} /></span>
                      Speed Delta
                    </h2>
                    <div className="font-num" style={{ fontSize: 10.5, color: 'var(--muted)', letterSpacing: '0.05em' }}>
                      above zero = <span style={{ color: d1Color, fontWeight: 700 }}>{driver1}</span> faster ·
                      {' '}below = <span style={{ color: d2Color, fontWeight: 700 }}>{driver2}</span> faster
                    </div>
                  </div>
                  <div className="font-num" style={{ width: '100%', height: 190 }}>
                    <ResponsiveContainer>
                      <LineChart data={chart.rows} syncId="telemetry" margin={{ top: 6, right: 10, bottom: 18, left: -4 }}>
                        <CartesianGrid stroke={GRID} strokeDasharray="2 4" />
                        <XAxis
                          dataKey="x" type="number" domain={['dataMin', 'dataMax']}
                          tick={AXIS_TICK} stroke={GRID} tickFormatter={fmtX} minTickGap={40}
                          label={{ value: xLabel, position: 'insideBottom', offset: -8, fill: 'var(--muted)', fontSize: 10 }}
                        />
                        <YAxis tick={AXIS_TICK} stroke={GRID} width={46} tickFormatter={(v: number) => `${v > 0 ? '+' : ''}${Math.round(v)}`} />
                        <ReferenceLine y={0} stroke="var(--muted)" strokeDasharray="3 3" />
                        <Tooltip cursor={{ stroke: 'var(--amber)', strokeWidth: 1 }} content={(p) => (p.active ? readout(p.label) : null)} />
                        <Line dataKey="dspeed" stroke="var(--amber)" dot={false} strokeWidth={1.4} type="monotone" connectNulls isAnimationActive={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                  <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', fontSize: 10.5, color: 'var(--muted)', padding: '4px 2px 4px' }}>
                    <span>Mean Δ <span className="font-num" style={{ color: 'var(--foreground)' }}>{dominance.mean > 0 ? '+' : ''}{dominance.mean.toFixed(1)} km/h</span></span>
                    <span>Peak Δ <span className="font-num" style={{ color: dominance.peak > 0 ? d1Color : d2Color }}>{dominance.peak > 0 ? '+' : ''}{Math.round(dominance.peak)} km/h</span> at {fmtX(dominance.peakAt)}</span>
                  </div>
                </motion.div>
              )}

              {/* ---- Time delta. Placed above the channel traces because it is
                   the only chart here that answers "who is winning this lap" —
                   speed alone doesn't, since a driver can be slower through a
                   corner and still ahead on cumulative time. ---- */}
              {delta.trace.length > 1 && (
                <motion.div
                  className="glass-card"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  style={{ padding: '16px 18px 10px', marginBottom: 14 }}
                >
                  <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
                    <h2 className="section-title" style={{ ['--bar' as string]: 'var(--sector-purple)' }}>
                      <span style={{ display: 'inline-flex', color: 'var(--sector-purple)' }}><Timer size={13} /></span>
                      Time Delta
                    </h2>
                    <div className="font-num" style={{ fontSize: 10.5, color: 'var(--muted)', letterSpacing: '0.05em' }}>
                      below zero = <span style={{ color: d1Color, fontWeight: 700 }}>{driver1}</span> ahead ·
                      {' '}above = <span style={{ color: d2Color, fontWeight: 700 }}>{driver2}</span> ahead
                    </div>
                  </div>
                  <div className="font-num" style={{ width: '100%', height: 190 }}>
                    <ResponsiveContainer>
                      <LineChart data={delta.trace} syncId="telemetry" margin={{ top: 6, right: 10, bottom: 18, left: -4 }}>
                        <CartesianGrid stroke={GRID} strokeDasharray="2 4" />
                        <XAxis
                          dataKey="distance" type="number" domain={['dataMin', 'dataMax']}
                          tick={AXIS_TICK} stroke={GRID} tickFormatter={fmtX} minTickGap={40}
                          label={{ value: xLabel, position: 'insideBottom', offset: -8, fill: 'var(--muted)', fontSize: 10 }}
                        />
                        <YAxis tick={AXIS_TICK} stroke={GRID} width={52} tickFormatter={(v: number) => `${v > 0 ? '+' : ''}${v.toFixed(2)}`} />
                        <ReferenceLine y={0} stroke="var(--muted)" strokeDasharray="3 3" />
                        <Tooltip
                          cursor={{ stroke: 'var(--sector-purple)', strokeWidth: 1 }}
                          contentStyle={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 2, fontSize: 11 }}
                          labelFormatter={(v) => fmtX(Number(v))}
                          formatter={(v) => [fmtDelta(typeof v === 'number' ? v : null), `${driver1} vs ${driver2}`]}
                        />
                        <Line dataKey="delta" stroke="var(--sector-purple)" dot={false} strokeWidth={1.6} type="monotone" isAnimationActive={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                  <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', fontSize: 10.5, color: 'var(--muted)', padding: '4px 2px' }}>
                    {/* The official gap comes from the two lap times, NOT from
                        the end of this trace. The trace stops at the last
                        distance both cars have telemetry for, which is not the
                        timing line — at 2026 R1 that read −0.004s (NOR ahead)
                        when the actual lap times were 79.475 vs 79.380, i.e.
                        NOR 0.095s *behind*. Reporting the trace end as the lap
                        gap names the wrong winner. */}
                    <span>
                      Lap gap{' '}
                      <span className="font-num" style={{ color: (lapGap ?? 0) < 0 ? d1Color : d2Color, fontWeight: 700 }}>
                        {fmtDelta(lapGap)}
                      </span>
                    </span>
                    {delta.summary.bestFor && (
                      <span>
                        {driver1} best{' '}
                        <span className="font-num" style={{ color: 'var(--foreground)' }}>{fmtDelta(delta.summary.bestFor.delta)}</span>
                        {' '}at {fmtX(delta.summary.bestFor.distance)}
                      </span>
                    )}
                    {delta.summary.swing != null && (
                      <span>
                        Swing across the lap{' '}
                        <span className="font-num" style={{ color: 'var(--foreground)' }}>{delta.summary.swing.toFixed(3)}s</span>
                      </span>
                    )}
                  </div>
                </motion.div>
              )}

              {/* one overlay chart per armed channel */}
              {activeChannels.map((ch, i) => {
                const domain = chart?.domains[ch.key] ?? [0, ch.max]
                const stepped = isBinary(ch) || ch.key === 'gear'
                return (
                  <motion.div
                    key={ch.key}
                    className="glass-card"
                    initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.4, delay: Math.min(0.05 + i * 0.04, 0.3) }}
                    style={{ padding: '15px 16px 10px', ...{ ['--bar' as string]: ch.color } }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 14, flexWrap: 'wrap', marginBottom: 12 }}>
                      <h2 className="section-title" style={{ ['--bar' as string]: ch.color }}>
                        {ch.label}
                      </h2>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        {([[driver1, statsA, d1Color], [driver2, statsB, d2Color]] as const).map(([abbr, st, col]) =>
                          st && abbr ? (
                            <span
                              key={abbr}
                              className="font-num"
                              style={{
                                fontSize: 10.5, padding: '3px 9px', border: `1px solid ${col}`,
                                background: tint(col, 12), color: col, borderRadius: 2, whiteSpace: 'nowrap',
                              }}
                            >
                              {abbr}{' '}
                              {isBinary(ch)
                                ? `${st.channel[ch.key].onPct != null ? Math.round(st.channel[ch.key].onPct as number) : '—'}% on`
                                : `max ${fmtChannel(ch, st.channel[ch.key].max)}${ch.unit ? ` ${ch.unit}` : ''}`}
                            </span>
                          ) : null,
                        )}
                      </div>
                    </div>

                    <div className="font-num" style={{ width: '100%', height: isBinary(ch) ? 150 : 240 }}>
                      <ResponsiveContainer>
                        <LineChart data={chart?.rows ?? []} syncId="telemetry" margin={{ top: 6, right: 10, bottom: 18, left: -4 }}>
                          <CartesianGrid stroke={GRID} strokeDasharray="2 4" />
                          <XAxis
                            dataKey="x" type="number" domain={['dataMin', 'dataMax']}
                            tick={AXIS_TICK} stroke={GRID} tickFormatter={fmtX} minTickGap={40}
                            label={{ value: xLabel, position: 'insideBottom', offset: -8, fill: 'var(--muted)', fontSize: 10 }}
                          />
                          <YAxis
                            tick={AXIS_TICK} stroke={GRID} width={46}
                            domain={domain}
                            allowDecimals={!isBinary(ch) && ch.key !== 'gear'}
                            ticks={isBinary(ch) ? [0, 1] : undefined}
                            tickFormatter={(v: number) => (isBinary(ch) ? (v > 0 ? 'ON' : 'OFF') : ch.key === 'rpm' ? `${Math.round(v / 1000)}k` : String(Math.round(v)))}
                          />
                          <Tooltip cursor={{ stroke: ch.color, strokeWidth: 1 }} content={(p) => (p.active ? readout(p.label) : null)} />
                          {data1.length > 0 && (
                            <Line dataKey={`a_${ch.key}`} name={driver1 || 'Driver 1'} stroke={d1Color} dot={false} strokeWidth={1.7} type={stepped ? 'stepAfter' : 'monotone'} connectNulls isAnimationActive={false} />
                          )}
                          {data2.length > 0 && (
                            <Line dataKey={`b_${ch.key}`} name={driver2 || 'Driver 2'} stroke={d2Color} dot={false} strokeWidth={1.7} type={stepped ? 'stepAfter' : 'monotone'} connectNulls isAnimationActive={false} />
                          )}
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </motion.div>
                )
              })}

              <div style={{ fontSize: 11, color: 'var(--muted)', padding: '0 2px' }}>
                Traces resampled to {CHART_RES} points on a shared {chart?.useDistance ? 'distance' : 'lap-progress'} axis
                (nearest-neighbour — gear, brake and AoA are never interpolated). Crosshair is synced across every chart.
              </div>
            </>
          )}
        </div>

        {/* ---------- rail ---------- */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
          {/* drivers legend */}
          <RailPanel title="Drivers" icon={<Users size={13} />} accent={d1Color}>
            {!driver1 && !driver2 ? (
              <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.5 }}>
                No drivers selected yet. Pick up to two from the control bar to overlay their laps.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {([[driver1, d1Meta, d1Color, statsA], [driver2, d2Meta, d2Color, statsB]] as const).map(([abbr, meta, col, st], i) =>
                  abbr ? (
                    <div key={`${abbr}-${i}`} style={{ display: 'flex', gap: 11, alignItems: 'flex-start', padding: '9px 10px', background: 'var(--surface)', border: '1px solid var(--hairline)', borderLeft: `2px solid ${col}` }}>
                      <span style={{ width: 18, height: 3, background: col, flexShrink: 0, marginTop: 7 }} />
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div className="font-display" style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.04em', color: col }}>{abbr}</div>
                        <div style={{ fontSize: 10.5, color: 'var(--muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {meta?.full_name || 'Driver'}{meta?.team ? ` · ${meta.team}` : ''}
                        </div>
                        {st && (
                          <div className="font-num" style={{ fontSize: 10.5, color: 'var(--foreground)', marginTop: 5, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                            <span>{formatLapTime(st.lap)}</span>
                            <span style={{ color: 'var(--muted)' }}>{st.topSpeed != null ? `${Math.round(st.topSpeed)} km/h` : '—'}</span>
                            <span style={{ color: 'var(--muted)' }}>{st.wotPct != null ? `${Math.round(st.wotPct)}% WOT` : '—'}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  ) : null,
                )}
              </div>
            )}
          </RailPanel>

          {/* channel toggles */}
          <RailPanel title="Channels" icon={<SlidersHorizontal size={13} />} accent="var(--amber)">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {TELEMETRY_CHANNELS.map(ch => {
                const on = channels.has(ch.key)
                return (
                  <button
                    key={ch.key}
                    onClick={() => toggleChannel(ch.key)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left',
                      padding: '8px 10px', borderRadius: 2, cursor: 'pointer',
                      background: on ? 'var(--surface)' : 'transparent',
                      border: `1px solid ${on ? ch.color : 'var(--border)'}`,
                      color: on ? 'var(--foreground)' : 'var(--muted)',
                      fontFamily: 'var(--font-display)', fontSize: 11.5, fontWeight: 600,
                      letterSpacing: '0.06em', textTransform: 'uppercase',
                    }}
                  >
                    <span style={{ width: 9, height: 9, flexShrink: 0, background: on ? ch.color : 'transparent', border: `1px solid ${on ? ch.color : 'var(--border)'}` }} />
                    <span style={{ flex: 1 }}>{ch.short}</span>
                    <span className="font-num" style={{ fontSize: 9.5, letterSpacing: '0.08em', color: on ? ch.color : 'var(--muted)' }}>
                      {ch.unit || (isBinary(ch) ? 'ON/OFF' : '—')}
                    </span>
                  </button>
                )
              })}
            </div>
            <div style={{ fontSize: 10.5, color: 'var(--muted)', marginTop: 11, lineHeight: 1.5 }}>
              {activeChannels.length} of {TELEMETRY_CHANNELS.length} armed. Every armed channel gets its own
              full-width chart with both drivers on the same axes.
            </div>
          </RailPanel>

          {/* dominance */}
          <RailPanel title="Dominance" icon={<Gauge size={13} />} accent="var(--sector-green)">
            {!dominance ? (
              <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.5 }}>
                Load two drivers to see where each one is carrying more speed around the lap.
              </div>
            ) : (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10.5, marginBottom: 7 }}>
                  <span style={{ color: d1Color, fontWeight: 700 }}>{driver1}</span>
                  <span style={{ color: 'var(--muted)', letterSpacing: '0.12em', textTransform: 'uppercase', fontSize: 9.5 }}>Faster share</span>
                  <span style={{ color: d2Color, fontWeight: 700 }}>{driver2}</span>
                </div>
                <div style={{ display: 'flex', height: 22, border: '1px solid var(--border)', overflow: 'hidden' }}>
                  <motion.div
                    initial={{ width: '50%' }} animate={{ width: `${dominance.aPct}%` }} transition={{ duration: 0.6, ease: 'easeOut' }}
                    style={{ background: d1Color, display: 'flex', alignItems: 'center', paddingLeft: 7 }}
                  >
                    <span className="font-num" style={{ fontSize: 10.5, fontWeight: 700, color: '#000' }}>{Math.round(dominance.aPct)}%</span>
                  </motion.div>
                  <div style={{ flex: 1, background: d2Color, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', paddingRight: 7 }}>
                    <span className="font-num" style={{ fontSize: 10.5, fontWeight: 700, color: '#000' }}>{Math.round(dominance.bPct)}%</span>
                  </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 15 }}>
                  {dominance.segments.map(seg => (
                    <div key={seg.label}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10.5, color: 'var(--muted)', marginBottom: 5 }}>
                        <span style={{ letterSpacing: '0.1em', textTransform: 'uppercase' }}>{seg.label}</span>
                        <span className="font-num" style={{ color: seg.mean > 0 ? d1Color : seg.mean < 0 ? d2Color : 'var(--muted)' }}>
                          {seg.mean > 0 ? '+' : ''}{seg.mean.toFixed(1)} km/h
                        </span>
                      </div>
                      <MiniBar pct={seg.share} color={seg.share >= 50 ? d1Color : d2Color} />
                    </div>
                  ))}
                </div>
                <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 12, lineHeight: 1.5 }}>
                  Lap split into equal thirds by {chart?.useDistance ? 'distance' : 'progress'} — an approximation of the
                  timing sectors, not the official split points.
                </div>
              </>
            )}
          </RailPanel>

          {/* AoA explainer */}
          <RailPanel title="Reading the trace" icon={<Info size={13} />} accent="var(--sector-yellow)">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 11, fontSize: 11.5, color: 'var(--muted)', lineHeight: 1.55 }}>
              <div>
                <span style={{ color: 'var(--sector-yellow)', fontWeight: 700 }}>AoA = Active Aerodynamic Override</span> — replaces DRS
                from 2026. Plotted as an on/off channel.
              </div>
              <div>Battery state of charge is not exposed in public F1 data. <span style={{ color: 'var(--sector-purple)', fontWeight: 700 }}>RPM</span> stands in as a deployment proxy.</div>
              <div><span style={{ color: 'var(--accent)', fontWeight: 700 }}>Brake</span> is a binary pedal flag, not pressure — step edges are real, not aliasing.</div>
              <div style={{ paddingTop: 10, borderTop: '1px solid var(--hairline)', display: 'flex', gap: 8, alignItems: 'center' }}>
                <Timer size={12} style={{ color: 'var(--muted)', flexShrink: 0 }} />
                <span>Lap times are measured across the telemetry window of each driver&apos;s fastest lap.</span>
              </div>
            </div>
          </RailPanel>
        </div>
      </div>
    </div>
  )
}

