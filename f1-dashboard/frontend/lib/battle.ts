/**
 * Battle maths for Follow Along — who a driver is racing, and which way the
 * gap is going.
 *
 * Kept out of `components/live/BattleView.tsx` and free of JSX so the awkward
 * cases are testable without a browser: the leader's blank gap, a lapped rival,
 * a trend that hasn't matured, a history gone stale while the tab was hidden.
 * `node scripts/battle-gaps.test.mjs` imports this file directly.
 */

// Relative, not `@/lib/live`: the test scripts load this file through jiti,
// which doesn't resolve the tsconfig path alias. It happens to work for a
// type-only import, which is exactly the trap — keep it relative so adding a
// value import later doesn't break the tests.
import type { TowerRow } from './live'

/** Cars shown either side of the pinned driver. */
export const EACH_SIDE = 2
/** How far back the trend looks. */
export const WINDOW_MS = 30_000
/** Below this span, two readings are a coincidence rather than a direction. */
export const MIN_SPAN_MS = 8_000
/** Below this the trend is noise, not a direction. */
export const TREND_DEADBAND_S = 0.15
/** A gap this close is inside undercut range. */
export const STRIKE_RANGE_S = 2.5
/** Tyre-age difference worth calling out. */
export const TYRE_EDGE_L = 3

export interface Sample { t: number; v: number }

export interface Neighbour {
  row: TowerRow
  isMe: boolean
  /** Seconds to the pinned driver — positive is behind them on the road. */
  gap: number | null
  rawGap: number | string | null
  /**
   * Best-lap difference to the pinned driver, positive = slower than them.
   *
   * This is what the fight looks like in qualifying, where the feed sends no
   * `GapToLeader` and no interval at all — only a position and a best lap.
   * A track gap is a race concept; nobody is racing anybody on the road.
   */
  lapDelta: number | null
}

/** True when the feed is giving track gaps — i.e. this is a race, not qualifying. */
export function hasTrackGaps(neighbours: Neighbour[]): boolean {
  return neighbours.some(n => !n.isMe && n.gap != null)
}

/** How a car reads on the track map. `plain` is the unfocused `/live` map. */
export type MapEmphasis = 'plain' | 'focus' | 'fight' | 'background'

/**
 * Emphasis for one car on a driver-focused track map.
 *
 * Pure because it can't be checked in a browser on demand — car positions only
 * exist while cars are on track, so without this the dimming and paint order
 * are only verifiable during a live session.
 */
export function mapEmphasis(
  abbr: string,
  focus: string | null | undefined,
  highlight: readonly string[] | undefined,
): MapEmphasis {
  if (!focus) return 'plain'
  if (abbr === focus) return 'focus'
  return highlight?.includes(abbr) ? 'fight' : 'background'
}

/**
 * Paint order. SVG draws in document order, so the focused car must go last or
 * it ends up buried under whoever happens to be alongside it.
 */
export function mapPaintRank(emphasis: MapEmphasis): number {
  return emphasis === 'focus' ? 2 : emphasis === 'fight' ? 1 : 0
}

/** `gapToLeader` carries strings — "IN PIT", "+1 LAP", "" for the leader. */
export function seconds(v: number | string | null): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v !== 'string') return null
  const trimmed = v.replace(/^\+/, '').trim()
  if (!trimmed) return null
  const n = Number(trimmed)
  return Number.isFinite(n) ? n : null
}

/**
 * The cars either side of the pinned driver, with the gap between them.
 *
 * Derived from gap-to-leader rather than the interval chain: an interval is
 * only to the car directly ahead, so summing it across a car that's in the pits
 * or a lap down compounds nonsense. The leader's own gap-to-leader arrives
 * blank rather than 0, and anything else non-numeric means there is no
 * comparable figure — those keep a null gap so the raw feed string can be shown
 * instead of a fabricated number.
 */
export function battleNeighbours(
  rows: TowerRow[],
  following: string | null,
  eachSide: number = EACH_SIDE,
): Neighbour[] {
  if (!following) return []
  const me = rows.find(r => r.driver.name_acronym === following)
  if (!me?.position) return []
  const toLeader = (r: TowerRow) => seconds(r.gapToLeader) ?? (r.position === 1 ? 0 : null)
  const mine = toLeader(me)
  return rows
    .filter(r => r.position != null && Math.abs(r.position - me.position!) <= eachSide)
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    .map(r => {
      const theirs = toLeader(r)
      const isMe = r.driver.name_acronym === following
      const bothLaps =
        typeof r.bestLapDuration === 'number' && typeof me.bestLapDuration === 'number'
      return {
        row: r,
        isMe,
        gap: isMe ? 0 : mine != null && theirs != null ? theirs - mine : null,
        rawGap: r.interval,
        lapDelta: isMe ? 0 : bothLaps ? r.bestLapDuration! - me.bestLapDuration! : null,
      }
    })
}

/**
 * Fold one gap reading into a driver's history and report the trend over it.
 *
 * Readings older than the window are dropped down to the newest one, so a
 * history that went stale (a hidden tab, a feed stall) reports no trend rather
 * than a change measured across the hole in time.
 */
export function trendFrom(
  prev: Sample[],
  now: number,
  v: number,
): { samples: Sample[]; trend: number | null; spanMs: number } {
  const samples = [...prev, { t: now, v }]
  while (samples.length > 1 && now - samples[0].t > WINDOW_MS) samples.shift()
  const spanMs = now - samples[0].t
  return { samples, trend: spanMs >= MIN_SPAN_MS ? v - samples[0].v : null, spanMs }
}
