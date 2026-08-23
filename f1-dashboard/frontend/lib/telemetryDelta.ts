/**
 * Time delta between two laps — the number a speed trace can't tell you.
 *
 * The telemetry page already compares speed at each point of the lap, but speed
 * alone doesn't say who is ahead: a driver can be slower through a corner and
 * still up on the lap because of where they carried the previous straight. The
 * delta is cumulative *time*, and it is the chart every F1 broadcast shows.
 *
 * Computed here rather than on the backend. `/api/telemetry/.../compare` has a
 * `delta_time()` helper, but it is never returned — dead code — and its
 * fallback substitutes the sample index for a timestamp, which would render as
 * seconds and be wrong by orders of magnitude. Both drivers' `time_s` and
 * `distance` are already on the page, so this needs no extra request.
 *
 * Sign convention: **positive means A is behind** (A took longer to reach that
 * point of the lap). That matches how a delta is read on television.
 *
 * Pure and JSX-free so it can be tested: `node scripts/telemetry-delta.test.mjs`.
 */

export interface DeltaSample { distance?: number | null; time_s?: number | null }
export interface DeltaPoint { distance: number; delta: number }

/**
 * Elapsed lap time at a distance, linearly interpolated.
 *
 * Telemetry is sampled on time, not distance, so the two drivers' samples never
 * line up — interpolation onto a shared distance axis is what makes them
 * comparable at all.
 */
export function timeAtDistance(samples: readonly DeltaSample[], d: number): number | null {
  const pts = samples
    .filter(s => typeof s.distance === 'number' && typeof s.time_s === 'number')
    .map(s => ({ d: s.distance as number, t: s.time_s as number }))
  if (pts.length < 2) return null
  if (d <= pts[0].d) return pts[0].t
  if (d >= pts[pts.length - 1].d) return pts[pts.length - 1].t

  let lo = 0
  let hi = pts.length - 1
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1
    if (pts[mid].d <= d) lo = mid
    else hi = mid
  }
  const span = pts[hi].d - pts[lo].d
  if (span <= 0) return pts[lo].t
  const frac = (d - pts[lo].d) / span
  return pts[lo].t + frac * (pts[hi].t - pts[lo].t)
}

/**
 * Delta across the lap, on a shared distance axis.
 *
 * The axis stops at the **shorter** of the two laps: past that point one driver
 * has no data and the "delta" would just be their own clamped final time
 * drifting away from the other's, which reads as a huge gap opening up at the
 * finish line that never happened.
 */
export function deltaTrace(
  a: readonly DeltaSample[],
  b: readonly DeltaSample[],
  steps = 400,
): DeltaPoint[] {
  const end = (s: readonly DeltaSample[]) => {
    const ds = s.map(x => x.distance).filter((x): x is number => typeof x === 'number')
    return ds.length ? Math.max(...ds) : 0
  }
  const maxD = Math.min(end(a), end(b))
  if (!(maxD > 0)) return []

  const out: DeltaPoint[] = []
  for (let i = 0; i < steps; i++) {
    const d = (maxD * i) / (steps - 1)
    const ta = timeAtDistance(a, d)
    const tb = timeAtDistance(b, d)
    if (ta == null || tb == null) continue
    out.push({ distance: d, delta: ta - tb })
  }
  return out
}

export interface DeltaSummary {
  /** Delta at the end of the shared distance — who won the lap, and by how much. */
  final: number | null
  /** Where A was furthest ahead (most negative). */
  bestFor: DeltaPoint | null
  /** Where A was furthest behind (most positive). */
  worstFor: DeltaPoint | null
  /** Distance over which A gained the most in one continuous stretch. */
  swing: number | null
}

export function deltaSummary(trace: readonly DeltaPoint[]): DeltaSummary {
  if (!trace.length) return { final: null, bestFor: null, worstFor: null, swing: null }
  let best = trace[0]
  let worst = trace[0]
  for (const p of trace) {
    if (p.delta < best.delta) best = p
    if (p.delta > worst.delta) worst = p
  }
  return {
    final: trace[trace.length - 1].delta,
    bestFor: best,
    worstFor: worst,
    // Total spread between the best and worst point of the lap: how much the
    // advantage moved around, as opposed to the net result.
    swing: worst.delta - best.delta,
  }
}

/** "+0.204s" / "−0.113s" — always signed, because an unsigned delta is unreadable. */
export function fmtDelta(v: number | null, dp = 3): string {
  if (v == null || !Number.isFinite(v)) return '—'
  const sign = v > 0 ? '+' : v < 0 ? '−' : ''
  return `${sign}${Math.abs(v).toFixed(dp)}s`
}
