'use client'

/**
 * Track DNA — what a circuit actually demands, measured from the fastest lap's
 * car telemetry via `/api/analysis/track-dna/{year}/{round}`.
 *
 * Everything on this panel is a measurement. There is no "tyre stress" or
 * "downforce level" gauge because those aren't in the data; inventing a score
 * and styling it like a reading would be worse than leaving it out. Where a
 * channel carries no signal — DRS on 2026 sessions, which the regulations
 * abolished — the backend returns null and this says so rather than showing 0.
 */

import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell } from 'recharts'
import { Flag, Gauge, CornerUpRight, Timer } from 'lucide-react'
import { useApi } from '@/lib/api/client'
import { SEASON } from '@/lib/api/hooks'
import { formatLapTime } from '@/lib/ist'
import { CHART_GRID as GRID } from '@/lib/chartTheme'

const AXIS = { fill: 'var(--muted)', fontSize: 11 }

interface CornerMix {
  slow: number
  medium: number
  fast: number
  apex_speeds: number[]
  avg_apex_kmh: number | null
}

interface TrackDnaData {
  available: boolean
  name: string
  session: string
  driver: string
  team: string
  lap_time_s: number | null
  lap_distance_m: number | null
  top_speed_kmh: number
  avg_speed_kmh: number
  min_speed_kmh: number
  corner_count: number
  braking_events: number
  /** null when the channel carries no signal — see the file header */
  drs_zones: number | null
  gears: { gear: number; pct: number }[]
  corner_mix: CornerMix
  full_throttle_pct: number
  braking_pct: number
  coasting_pct: number
  note: string
}

function Panel({ title, accent, children, note }: {
  title: string; accent?: string; children: React.ReactNode; note?: string
}) {
  return (
    <div className="glass-card" style={{ padding: 18 }}>
      <h2 className="section-title" style={{ marginBottom: 14, ['--bar' as string]: accent || 'var(--accent)' }}>
        {title}
      </h2>
      {children}
      {note && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 10, lineHeight: 1.5 }}>{note}</div>}
    </div>
  )
}

function Kpi({ label, value, sub, accent }: {
  label: string; value: string; sub?: string; accent?: string
}) {
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 2, padding: '12px 14px' }}>
      <div
        className="font-display"
        style={{ fontSize: 9, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--muted)' }}
      >
        {label}
      </div>
      <div className="stat-num" style={{ fontSize: 22, marginTop: 4, color: accent || 'var(--foreground)' }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

/**
 * Horizontal stacked bar.
 *
 * `total` matters: the corner mix is a set of counts that genuinely add up to
 * the whole, so it normalises against its own sum. The lap split is already in
 * percent of lap time and does NOT add to 100 — the balance is partial
 * throttle. Normalising that against its own sum would inflate every segment
 * and print percentages that contradict the legend, so the caller passes
 * total={100} and supplies the remainder as its own segment.
 */
function SplitBar({ parts, total: fixedTotal, unit = '' }: {
  parts: { label: string; value: number; color: string }[]
  total?: number
  unit?: string
}) {
  const total = fixedTotal ?? parts.reduce((s, p) => s + p.value, 0)
  if (total <= 0) return <div style={{ fontSize: 12, color: 'var(--muted)' }}>No data.</div>
  return (
    <>
      <div style={{ display: 'flex', height: 26, border: '1px solid var(--border)', overflow: 'hidden' }}>
        {parts.filter(p => p.value > 0).map(p => (
          <div
            key={p.label}
            title={`${p.label} — ${p.value}`}
            style={{
              width: `${(p.value / total) * 100}%`,
              background: p.color,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            {(p.value / total) > 0.11 && (
              <span className="font-num" style={{ fontSize: 11, fontWeight: 700, color: '#0B0C0E' }}>
                {Math.round((p.value / total) * 100)}%
              </span>
            )}
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 10 }}>
        {parts.map(p => (
          <span key={p.label} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--muted)' }}>
            <span style={{ width: 9, height: 9, background: p.color, display: 'block' }} />
            {p.label}
            <span className="font-num" style={{ color: 'var(--foreground)', fontWeight: 700 }}>{p.value}{unit}</span>
          </span>
        ))}
      </div>
    </>
  )
}

export default function TrackDNA({ round }: { round: number | null }) {
  const { data, isLoading } = useApi<TrackDnaData>(
    round ? `/api/analysis/track-dna/${SEASON}/${round}` : null,
  )

  if (!round || (isLoading && !data)) {
    return <div className="shimmer" style={{ height: 460, borderRadius: 2 }} />
  }

  if (!data?.available) {
    return (
      <Panel title="Track DNA">
        <div style={{ color: 'var(--muted)', fontSize: 12 }}>
          No car telemetry for this round yet — the fingerprint is built from the fastest
          qualifying lap, so it appears once that session has run and been published.
        </div>
      </Panel>
    )
  }

  const mix = data.corner_mix
  const lapKm = data.lap_distance_m != null ? (data.lap_distance_m / 1000).toFixed(3) : '—'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
        <Kpi label="Top Speed" value={`${Math.round(data.top_speed_kmh)}`} sub="km/h" accent="var(--sector-purple)" />
        <Kpi label="Average Speed" value={`${Math.round(data.avg_speed_kmh)}`} sub="km/h over the lap" />
        <Kpi label="Slowest Point" value={`${Math.round(data.min_speed_kmh)}`} sub="km/h at the tightest apex" />
        <Kpi label="Full Throttle" value={`${data.full_throttle_pct}%`} sub="of lap time" accent="var(--sector-green)" />
        <Kpi label="Corners" value={`${data.corner_count}`} sub={mix.avg_apex_kmh != null ? `${mix.avg_apex_kmh} km/h avg apex` : undefined} />
        <Kpi label="Braking Zones" value={`${data.braking_events}`} sub="separate applications" accent="var(--accent)" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(420px, 100%), 1fr))', gap: 16 }}>
        <Panel
          title="Lap Split"
          accent="var(--sector-green)"
          note="Time-weighted, not sample-counted — the telemetry channels aren't evenly spaced."
        >
          <SplitBar
            total={100}
            unit="%"
            parts={[
              { label: 'Full throttle', value: data.full_throttle_pct, color: 'var(--sector-green)' },
              { label: 'Braking', value: data.braking_pct, color: 'var(--accent)' },
              { label: 'Coasting', value: data.coasting_pct, color: 'var(--muted)' },
              {
                label: 'Partial throttle',
                value: Math.max(0, Math.round(
                  (100 - data.full_throttle_pct - data.braking_pct - data.coasting_pct) * 10,
                ) / 10),
                color: 'var(--amber)',
              },
            ]}
          />
        </Panel>

        <Panel
          title="Corner Mix"
          accent="var(--amber)"
          note="Classified by the minimum speed reached at each marked corner: slow under 130 km/h, fast over 200 km/h."
        >
          <SplitBar
            parts={[
              { label: 'Slow', value: mix.slow, color: 'var(--accent)' },
              { label: 'Medium', value: mix.medium, color: 'var(--amber)' },
              { label: 'Fast', value: mix.fast, color: 'var(--sector-green)' },
            ]}
          />
        </Panel>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(420px, 100%), 1fr))', gap: 16 }}>
        <Panel title="Gear Usage" accent="var(--sector-purple)" note="Share of the lap spent in each gear.">
          <div style={{ height: 240 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.gears} margin={{ top: 4, right: 8, left: -18, bottom: 4 }}>
                <CartesianGrid stroke={GRID} vertical={false} />
                <XAxis dataKey="gear" tick={AXIS} tickLine={false} axisLine={false} tickFormatter={g => `G${g}`} />
                <YAxis tick={AXIS} tickLine={false} axisLine={false} unit="%" />
                <Tooltip
                  cursor={{ fill: 'rgba(255,255,255,0.04)' }}
                  contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 2 }}
                  formatter={(v) => [`${v}%`, 'Share of lap']}
                  labelFormatter={g => `Gear ${g}`}
                />
                <Bar dataKey="pct" radius={[2, 2, 0, 0]}>
                  {data.gears.map(g => (
                    <Cell key={g.gear} fill={g.gear >= 7 ? 'var(--sector-green)' : g.gear <= 2 ? 'var(--accent)' : 'var(--sector-purple)'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel title="Reference Lap" accent="var(--accent)" note={data.note}>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {[
              { icon: Flag, label: 'Circuit', value: data.name || '—' },
              { icon: Timer, label: 'Lap time', value: data.lap_time_s != null ? formatLapTime(data.lap_time_s) : '—' },
              { icon: Gauge, label: 'Set by', value: data.driver ? `${data.driver}${data.team ? ` · ${data.team}` : ''}` : '—' },
              { icon: CornerUpRight, label: 'Session', value: data.session === 'Q' ? 'Qualifying' : data.session === 'R' ? 'Race' : data.session },
              { icon: Flag, label: 'Lap distance', value: `${lapKm} km` },
              {
                icon: Gauge,
                label: 'DRS zones',
                // null means the channel is flat — DRS was abolished for 2026.
                value: data.drs_zones == null ? 'Not in this season’s data' : String(data.drs_zones),
                dim: data.drs_zones == null,
              },
            ].map(row => {
              const RIcon = row.icon
              return (
                <div
                  key={row.label}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
                    padding: '9px 0', borderBottom: '1px solid var(--hairline)',
                  }}
                >
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--muted)' }}>
                    <RIcon size={13} /> {row.label}
                  </span>
                  <span
                    className="font-num"
                    style={{ fontSize: 12, fontWeight: 700, textAlign: 'right', color: row.dim ? 'var(--muted)' : 'var(--foreground)' }}
                  >
                    {row.value}
                  </span>
                </div>
              )
            })}
          </div>
        </Panel>
      </div>
    </div>
  )
}
