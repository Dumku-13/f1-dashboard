'use client'

/**
 * Championship evolution charts.
 *
 * Everything here is derived from data the standings endpoint ALREADY returns —
 * `rounds` (the round list) plus each competitor's `rounds` map of
 * `{ race?, sprint? }` points. No extra requests.
 *
 * This module is heavy (recharts), so `app/standings/page.tsx` pulls it in with
 * `next/dynamic({ ssr: false })` to keep it out of the main bundle.
 */

import { useMemo, useState } from 'react'
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  BarChart, Bar, Legend,
} from 'recharts'
import { TEAM_COLORS } from '@/lib/constants'
import { hexColor } from '@/lib/utils'
import type { Standings, DriverStanding, ConstructorStanding, RoundInfo } from '@/lib/types'
import { CHART_GRID as GRID } from '@/lib/chartTheme'

const AXIS = { fill: 'var(--muted)', fontSize: 11 }

type Competitor = {
  key: string
  label: string
  colour: string
  rounds: Record<number, { race?: number; sprint?: number }>
}

function toCompetitors(standings: Standings, mode: 'drivers' | 'constructors'): Competitor[] {
  if (mode === 'drivers') {
    return standings.drivers.map((d: DriverStanding) => ({
      key: d.abbreviation,
      label: d.abbreviation,
      colour: hexColor(d.team_color) || TEAM_COLORS[d.team] || '#8C939E',
      rounds: d.rounds || {},
    }))
  }
  return standings.constructors.map((c: ConstructorStanding) => ({
    key: c.id,
    label: c.name,
    colour: hexColor(c.color) || TEAM_COLORS[c.name] || '#8C939E',
    rounds: c.rounds || {},
  }))
}

/** Points scored in one round (race + sprint). */
function roundPoints(r: { race?: number; sprint?: number } | undefined): number {
  return (r?.race || 0) + (r?.sprint || 0)
}

/** Shared tooltip: the whole field, ranked, at the hovered round. */
function FieldTooltip({ active, payload, label, suffix = '' }: any) {
  if (!active || !payload?.length) return null
  const ranked = [...payload]
    .filter((p: any) => p.value != null)
    .sort((a: any, b: any) => (b.value as number) - (a.value as number))
    .slice(0, 11)
  return (
    <div style={{
      background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 2,
      padding: '10px 12px', fontSize: 11, minWidth: 160,
    }}>
      <div className="font-display" style={{ fontWeight: 700, marginBottom: 7, letterSpacing: '0.06em' }}>
        ROUND {label}
      </div>
      {ranked.map((p: any, i: number) => (
        <div key={p.dataKey} style={{ display: 'flex', justifyContent: 'space-between', gap: 14, lineHeight: 1.7 }}>
          <span style={{ color: p.color }}>
            <span className="font-num" style={{ color: 'var(--muted)', marginRight: 6 }}>{i + 1}</span>
            {p.dataKey}
          </span>
          <span className="font-num" style={{ fontWeight: 700 }}>{p.value}{suffix}</span>
        </div>
      ))}
    </div>
  )
}

export default function StandingsEvolution({
  standings,
  mode,
}: {
  standings: Standings
  mode: 'drivers' | 'constructors'
}) {
  const [view, setView] = useState<'points' | 'ranking' | 'byRace'>('points')

  const competitors = useMemo(() => toCompetitors(standings, mode), [standings, mode])
  const completed = useMemo(
    () => (standings.rounds || []).filter((r: RoundInfo) => r.status === 'complete'),
    [standings.rounds],
  )

  /** Cumulative points per competitor at each completed round. */
  const cumulative = useMemo(() => {
    const running: Record<string, number> = {}
    competitors.forEach(c => { running[c.key] = 0 })
    return completed.map(r => {
      const row: Record<string, number | string> = { round: r.round }
      competitors.forEach(c => {
        running[c.key] += roundPoints(c.rounds[r.round])
        row[c.label] = running[c.key]
      })
      return row
    })
  }, [competitors, completed])

  /** Championship position at each round, derived from the cumulative table. */
  const ranking = useMemo(() => {
    return cumulative.map(row => {
      const scores = competitors
        .map(c => ({ label: c.label, pts: Number(row[c.label] ?? 0) }))
        .sort((a, b) => b.pts - a.pts)
      const out: Record<string, number | string> = { round: row.round }
      scores.forEach((s, i) => { out[s.label] = i + 1 })
      return out
    })
  }, [cumulative, competitors])

  /** Points scored per round (not cumulative) — stacked. */
  const perRound = useMemo(() => {
    return completed.map(r => {
      const row: Record<string, number | string> = { round: `R${r.round}` }
      competitors.forEach(c => { row[c.label] = roundPoints(c.rounds[r.round]) })
      return row
    })
  }, [competitors, completed])

  if (completed.length === 0) {
    return (
      <div className="glass-card" style={{ padding: 32, textAlign: 'center', color: 'var(--muted)', fontSize: 12 }}>
        Evolution charts appear once the first round has been scored.
      </div>
    )
  }

  // Too many lines is unreadable — the tail of the field is flat anyway.
  const shown = competitors.slice(0, mode === 'drivers' ? 10 : 11)

  const tabs: { id: typeof view; label: string }[] = [
    { id: 'points', label: 'Points Evolution' },
    { id: 'ranking', label: 'Ranking Evolution' },
    { id: 'byRace', label: 'Points by Race' },
  ]

  return (
    <div className="glass-card" style={{ padding: 18 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 14, flexWrap: 'wrap', marginBottom: 16 }}>
        <h2 className="section-title" style={{ ['--bar' as string]: 'var(--amber)' }}>
          {mode === 'drivers' ? 'Driver' : 'Constructor'} Championship Evolution
        </h2>
        <div style={{ display: 'inline-flex', gap: 3, padding: 3, background: 'var(--surface)', border: '1px solid var(--border)' }}>
          {tabs.map(t => (
            <button
              key={t.id}
              onClick={() => setView(t.id)}
              className="font-display"
              style={{
                padding: '6px 13px', border: 'none', cursor: 'pointer', borderRadius: 2,
                fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase',
                background: view === t.id ? 'var(--accent)' : 'transparent',
                color: view === t.id ? '#fff' : 'var(--muted)',
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ width: '100%', height: 380 }}>
        <ResponsiveContainer>
          {view === 'byRace' ? (
            <BarChart data={perRound} margin={{ top: 6, right: 18, bottom: 4, left: -8 }}>
              <CartesianGrid stroke={GRID} vertical={false} />
              <XAxis dataKey="round" tick={AXIS} stroke={GRID} />
              <YAxis tick={AXIS} stroke={GRID} />
              <Tooltip content={<FieldTooltip suffix=" pts" />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
              {shown.map(c => (
                <Bar key={c.key} dataKey={c.label} stackId="pts" fill={c.colour} />
              ))}
            </BarChart>
          ) : (
            <LineChart
              data={view === 'points' ? cumulative : ranking}
              margin={{ top: 6, right: 18, bottom: 4, left: -8 }}
            >
              <CartesianGrid stroke={GRID} />
              <XAxis
                dataKey="round" tick={AXIS} stroke={GRID}
                tickFormatter={(v: number) => `R${v}`}
              />
              <YAxis
                tick={AXIS} stroke={GRID}
                // Ranking: P1 at the top, so the axis runs backwards.
                reversed={view === 'ranking'}
                domain={view === 'ranking' ? [1, shown.length] : ['auto', 'auto']}
                allowDecimals={false}
                tickFormatter={(v: number) => (view === 'ranking' ? `P${v}` : String(v))}
              />
              <Tooltip content={<FieldTooltip suffix={view === 'points' ? ' pts' : ''} />} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              {shown.map(c => (
                <Line
                  key={c.key}
                  type={view === 'ranking' ? 'stepAfter' : 'monotone'}
                  dataKey={c.label}
                  stroke={c.colour}
                  strokeWidth={2}
                  dot={{ r: 2 }}
                  activeDot={{ r: 4 }}
                  isAnimationActive={false}
                />
              ))}
            </LineChart>
          )}
        </ResponsiveContainer>
      </div>

      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 10 }}>
        {view === 'points' && `Cumulative points after each of the ${completed.length} completed rounds. Sprint points included.`}
        {view === 'ranking' && 'Championship position after each round — crossing lines are position changes.'}
        {view === 'byRace' && 'Points scored in each individual round, stacked across the field.'}
      </div>
    </div>
  )
}
