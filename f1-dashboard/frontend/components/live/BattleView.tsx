'use client'

/**
 * Battle view — the fight around one driver.
 *
 * This is what replaced the full 22-row tower on `/follow`. The tower answers
 * "what is the session doing", which is `/live`'s job and doesn't change when
 * you pin a different driver. This answers "who is your driver actually racing,
 * and is that gap coming to them or getting away", which is only answerable
 * once somebody is pinned.
 *
 * Two things here are not on the timing screen at all:
 *   - **Gap trend.** A gap of 1.4s means nothing on its own; 1.4s and shrinking
 *     by 0.8s every half-minute is the whole story. Sampled from the same
 *     delayed snapshots the tower renders, so it never runs ahead of the feed.
 *   - **Tyre delta.** A rival within pit-window range on materially newer tyres
 *     is an undercut threat; on older tyres they're the opportunity. That's a
 *     comparison between two specific cars, so the tower has nowhere to put it.
 *
 * The gap and trend maths live in `lib/battle.ts` — free of JSX so the awkward
 * cases (the leader's blank gap, a lapped rival, an immature trend, a history
 * gone stale while the tab was hidden) can be tested without a browser:
 * `node scripts/battle-gaps.test.mjs`.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import type { TowerRow } from '@/lib/live'
import { COMPOUND_COLORS } from '@/lib/constants'
import { fmtLap } from '@/lib/live'
import {
  battleNeighbours, trendFrom, hasTrackGaps, EACH_SIDE,
  TREND_DEADBAND_S, STRIKE_RANGE_S, TYRE_EDGE_L,
  type Sample,
} from '@/lib/battle'

const GRID = '34px minmax(64px, 1fr) 80px minmax(96px, 1.1fr) 84px'

function fmtSigned(s: number, dp = 1): string {
  return `${s < 0 ? '−' : '+'}${Math.abs(s).toFixed(dp)}s`
}

export default function BattleView({
  rows,
  following,
  live,
}: {
  rows: TowerRow[]
  following: string | null
  /** Gaps only move while a session is running — off-session there is no trend
   *  to wait for, and saying "measuring…" forever is a lie. */
  live: boolean
}) {
  const me = useMemo(
    () => rows.find(r => r.driver.name_acronym === following) || null,
    [rows, following],
  )

  const neighbours = useMemo(
    () => battleNeighbours(rows, following),
    [rows, following],
  )

  const gapKey = useMemo(
    () => neighbours.map(n => `${n.row.driver.name_acronym}:${n.gap ?? 'x'}`).join('|'),
    [neighbours],
  )

  const hist = useRef(new Map<string, Sample[]>())
  const [trends, setTrends] = useState<Record<string, { trend: number | null; spanMs: number }>>({})

  // A new driver is a new set of battles; carrying the old samples over would
  // print a trend for a gap that was never measured.
  useEffect(() => { hist.current.clear(); setTrends({}) }, [following])

  useEffect(() => {
    const now = Date.now()
    const next: Record<string, { trend: number | null; spanMs: number }> = {}
    const seen = new Set<string>()
    for (const n of neighbours) {
      const abbr = n.row.driver.name_acronym
      seen.add(abbr)
      if (n.isMe || n.gap == null) { hist.current.delete(abbr); continue }
      const { samples, trend, spanMs } = trendFrom(hist.current.get(abbr) ?? [], now, n.gap)
      hist.current.set(abbr, samples)
      next[abbr] = { trend, spanMs }
    }
    for (const k of [...hist.current.keys()]) if (!seen.has(k)) hist.current.delete(k)
    setTrends(next)
  }, [gapKey]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!following) {
    return (
      <div style={{ padding: 26, fontSize: 12, color: 'var(--muted)', lineHeight: 1.6 }}>
        Pin a driver above and this becomes the cars they&apos;re actually up against — the
        gap and which way it&apos;s moving in a race, lap-time deltas in qualifying, and who
        has the tyre advantage.
      </div>
    )
  }

  if (!me) {
    return (
      <div style={{ padding: 26, fontSize: 12, color: 'var(--muted)' }}>
        No live data for {following} in this session yet.
      </div>
    )
  }

  // Qualifying sends no GapToLeader and no interval — only a position and a
  // best lap. Nobody is racing anybody on the road, so the fight is measured in
  // lap time instead. Deciding from the data rather than the session name means
  // a race whose gaps haven't arrived yet degrades the same way.
  const raceMode = hasTrackGaps(neighbours)

  return (
    <div>
      <div
        className="font-display"
        style={{
          display: 'grid', gridTemplateColumns: GRID, gap: 8,
          padding: '8px 14px', borderBottom: '1px solid rgba(255,255,255,0.09)',
          fontSize: 9, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--muted)',
        }}
      >
        <span>Pos</span>
        <span>Driver</span>
        <span style={{ textAlign: 'right' }}>{raceMode ? 'Gap' : 'Best lap'}</span>
        <span>{raceMode ? 'Trend' : 'Δ to you'}</span>
        <span style={{ textAlign: 'right' }}>Tyre</span>
      </div>

      {neighbours.map(n => {
        const r = n.row
        const abbr = r.driver.name_acronym
        const colour = r.driver.team_colour ? `#${r.driver.team_colour.replace('#', '')}` : '#555'
        const compound = r.compound ? COMPOUND_COLORS[r.compound.toUpperCase()] || '#6E7681' : null
        const entry = trends[abbr]
        const trend = entry?.trend ?? null
        const ahead = n.gap != null && n.gap < 0

        // Read from the pinned driver's point of view: a gap closing to the car
        // ahead is good news, the same number closing from behind is not.
        const closing = trend != null && trend < -TREND_DEADBAND_S
        const opening = trend != null && trend > TREND_DEADBAND_S
        const good = closing ? ahead : opening ? !ahead : null

        const tyreDelta =
          !n.isMe && r.tyreAge != null && me.tyreAge != null ? me.tyreAge - r.tyreAge : null
        const inRange = n.gap != null && Math.abs(n.gap) <= STRIKE_RANGE_S
        const threat = inRange && tyreDelta != null && tyreDelta >= TYRE_EDGE_L
        const chance = inRange && tyreDelta != null && tyreDelta <= -TYRE_EDGE_L

        return (
          <div
            key={r.driver.driver_number}
            style={{
              display: 'grid',
              gridTemplateColumns: GRID,
              alignItems: 'center', gap: 8,
              padding: n.isMe ? '13px 14px' : '10px 14px',
              borderBottom: '1px solid var(--hairline)',
              borderLeft: `3px solid ${n.isMe ? colour : 'transparent'}`,
              background: n.isMe ? `color-mix(in srgb, ${colour} 13%, transparent)` : 'transparent',
            }}
          >
            <span className="font-num" style={{ fontSize: n.isMe ? 17 : 14, fontWeight: 800 }}>
              {r.position ?? '—'}
            </span>

            <span style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
              <span style={{ width: 3, height: 14, background: colour, flexShrink: 0 }} />
              <span
                className="font-display"
                style={{ fontSize: n.isMe ? 14 : 12, fontWeight: 700, letterSpacing: '0.04em', overflow: 'hidden', textOverflow: 'ellipsis' }}
              >
                {abbr}
              </span>
            </span>

            <span className="font-num" style={{ fontSize: 12, fontWeight: 700, textAlign: 'right', color: n.isMe && raceMode ? 'var(--muted)' : 'var(--foreground)' }}>
              {raceMode
                ? (n.isMe ? '—' : n.gap != null ? fmtSigned(n.gap) : (typeof n.rawGap === 'string' && n.rawGap ? n.rawGap : '—'))
                : fmtLap(r.bestLapDuration)}
            </span>

            <span style={{ display: 'flex', justifyContent: 'flex-start' }}>
              {!raceMode ? (
                n.isMe || n.lapDelta == null ? null : (
                  <span
                    className="font-num"
                    title={`${abbr}'s best lap is ${fmtSigned(n.lapDelta, 3)} against yours`}
                    style={{
                      fontSize: 10, fontWeight: 700, padding: '3px 7px', borderRadius: 2,
                      // In qualifying a quicker rival is the one beating you, so
                      // a negative delta is the bad one — the opposite of a gap.
                      background: n.lapDelta < 0 ? 'rgba(232,0,45,0.14)' : 'rgba(0,209,49,0.14)',
                      color: n.lapDelta < 0 ? '#FF6B7F' : 'var(--sector-green)',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {fmtSigned(n.lapDelta, 3)}
                  </span>
                )
              ) : n.isMe || n.gap == null ? null : trend == null ? (
                <span style={{ fontSize: 10, color: 'var(--muted)' }}>
                  {live ? 'measuring…' : '—'}
                </span>
              ) : (
                <span
                  className="font-num"
                  title={`Gap changed by ${fmtSigned(trend)} over the last ${Math.round((entry?.spanMs ?? 0) / 1000)}s`}
                  style={{
                    fontSize: 10, fontWeight: 700, padding: '3px 7px', borderRadius: 2,
                    background: good == null ? 'rgba(255,255,255,0.05)'
                      : good ? 'rgba(0,209,49,0.14)' : 'rgba(232,0,45,0.14)',
                    color: good == null ? 'var(--muted)' : good ? 'var(--sector-green)' : '#FF6B7F',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {closing ? '▼ closing' : opening ? '▲ opening' : '— holding'} {fmtSigned(trend)}
                </span>
              )}
            </span>

            <span style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'flex-end' }}>
              {compound && (
                <span
                  className="font-num"
                  title={`${r.compound}${r.tyreAge != null ? ` · ${r.tyreAge} laps old` : ''}`}
                  style={{
                    fontSize: 10, fontWeight: 800, padding: '2px 6px', borderRadius: 2,
                    background: compound, color: '#0B0C0E', whiteSpace: 'nowrap',
                  }}
                >
                  {r.compound![0].toUpperCase()}{r.tyreAge != null ? ` ${r.tyreAge}` : ''}
                </span>
              )}
              {(threat || chance) && (
                <span
                  title={threat
                    ? `${abbr} is within ${STRIKE_RANGE_S}s on tyres ${Math.abs(tyreDelta!)} laps newer`
                    : `${abbr} is within ${STRIKE_RANGE_S}s on tyres ${Math.abs(tyreDelta!)} laps older`}
                  className="font-display"
                  style={{
                    fontSize: 9, fontWeight: 800, letterSpacing: '0.08em', padding: '2px 5px',
                    borderRadius: 2, whiteSpace: 'nowrap',
                    background: threat ? 'rgba(232,0,45,0.16)' : 'rgba(0,209,49,0.16)',
                    color: threat ? '#FF6B7F' : 'var(--sector-green)',
                  }}
                >
                  {threat ? 'THREAT' : 'CHANCE'}
                </span>
              )}
            </span>
          </div>
        )
      })}

      {neighbours.length <= 1 && (
        <div style={{ padding: 18, fontSize: 11, color: 'var(--muted)' }}>
          Nobody within {EACH_SIDE} places yet.
        </div>
      )}
    </div>
  )
}
